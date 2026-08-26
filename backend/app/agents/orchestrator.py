"""
The orchestrator — a real agent loop over the tool registry in tools.py.

Unlike supervisor.py's hardcoded graph.add_edge() chain, nothing here decides
the next step in Python. Each iteration sends the running conversation to
Gemini (function calling, over Vertex AI — verified live: the model both
emits a functionCall and correctly consumes a functionResponse to continue)
and does whatever tool call the model returns. Two different drives can and
will produce two different execution traces — that's the whole point.

ask_human is a tool, not a hardcoded graph node: when the model calls it, the
loop suspends and persists to the agent_runs table (Postgres, survives Cloud
Run container recycling) instead of holding state in memory. Resuming means
loading that row, injecting the human's answer as a functionResponse, and
continuing the loop — verified by killing the container mid-pause, not just
assumed.
"""
import time
from typing import Any
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.models import AgentRun, AgentRunStatus, AgentTrace, PlacementDrive, DriveStatus
from app.agents.tools import ToolContext, TOOL_DECLARATIONS, TOOL_EXECUTORS
from app.agents.vertex_auth import get_vertex_access_token
from app.api.websocket import emit_agent_event
from loguru import logger

VERTEX_GENERATE_URL = (
    "https://aiplatform.googleapis.com/v1/projects/{project}"
    "/locations/global/publishers/google/models/{model}:generateContent"
)

ORCHESTRATOR_SYSTEM_PROMPT = """You are the orchestrator for a college placement drive.

Your job: take one placement drive from a raw job description through JD
parsing, eligibility checking, and candidate ranking, then ask the TPO (a
human placement officer) to approve the resulting shortlist before anything
is finalized.

Rules:
- Call get_drive_context first if you don't already know the drive's JD text and rules.
- parse_jd must run before check_eligibility.
- check_eligibility must run before rank_candidates.
- Once you have ranked candidates, call ask_human with a clear recommendation
  and question — never finalize a shortlist without asking.
- Before each tool call, write one short sentence explaining why you're calling it.
- If a tool result looks wrong, incomplete, or returns an error, say so and
  decide what to do next yourself instead of proceeding blindly.
- Once ask_human's functionResponse comes back with the TPO's answer, do not
  call get_drive_context or any other tool again — that answer is the final
  step. If approved, reply with a short confirmation that the shortlist is
  final and ready for scheduling, and stop. If rejected, reply with what you
  understood the TPO wants changed and stop (a future run will act on it).
"""

MAX_STEPS = 12


async def _call_gemini(contents: list[dict]) -> dict:
    token = get_vertex_access_token()
    url = VERTEX_GENERATE_URL.format(
        project=settings.GCP_PROJECT_ID, model=settings.VERTEX_ORCHESTRATOR_MODEL,
    )
    payload = {
        "systemInstruction": {"parts": [{"text": ORCHESTRATOR_SYSTEM_PROMPT}]},
        "contents": contents,
        "tools": [{"functionDeclarations": TOOL_DECLARATIONS}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=payload)
        resp.raise_for_status()
        return resp.json()


async def _last_seq(db: AsyncSession, run_id: str) -> int:
    """Highest seq already logged for this run (0 if none)."""
    result = await db.execute(select(AgentTrace).where(AgentTrace.run_id == run_id))
    rows = result.scalars().all()
    return max((r.seq for r in rows), default=0)


async def _log_trace(
    db: AsyncSession, run: AgentRun, seq: int, agent: str, kind: str,
    summary: str, detail: dict | None = None, cost_ms: int | None = None,
) -> None:
    entry = AgentTrace(
        run_id=run.id, drive_id=run.drive_id, seq=seq, agent=agent, kind=kind,
        summary=summary[:2000], detail=detail, cost_ms=cost_ms,
    )
    db.add(entry)
    await db.commit()
    await emit_agent_event(
        "agent_trace", {"seq": seq, "agent": agent, "kind": kind, "summary": summary},
        drive_id=run.drive_id, agent_name=agent,
    )


async def create_run(db: AsyncSession, drive_id: str) -> AgentRun:
    """Insert the AgentRun row synchronously so callers get a run_id back
    immediately, before the (slow) agent loop runs in the background."""
    run = AgentRun(drive_id=drive_id, status=AgentRunStatus.RUNNING, state_json={"contents": []})
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


async def execute_run(db: AsyncSession, run_id: str, drive_id: str) -> AgentRun:
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise ValueError(f"agent run {run_id} not found")

    contents = [
        {"role": "user", "parts": [{"text": f"Begin processing drive {drive_id}."}]}
    ]
    await _run_loop(db, run, ToolContext(db, drive_id), contents)
    return run


async def resume_run(db: AsyncSession, run_id: str, human_answer: str) -> AgentRun:
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise ValueError(f"agent run {run_id} not found")
    if run.status != AgentRunStatus.PAUSED:
        raise ValueError(f"agent run {run_id} is {run.status.value}, not paused")

    contents = run.state_json["contents"]
    # Load count is the durability canary: a resume that replays fewer turns than
    # the run persisted means state_json regressed (see the list() note below).
    logger.info(f"[{run.drive_id}] resume_run replaying {len(contents)} persisted turns")
    contents.append({
        "role": "user",
        "parts": [{"functionResponse": {"name": "ask_human", "response": {"answer": human_answer}}}],
    })
    run.status = AgentRunStatus.RUNNING
    run.pending_question = None
    await db.commit()

    seq = await _last_seq(db, run.id) + 1
    await _log_trace(db, run, seq, "orchestrator", "observation", f"TPO answered: {human_answer}")

    await _run_loop(db, run, ToolContext(db, run.drive_id), contents)
    return run


def _strip_thought_signatures(parts: list[dict]) -> list[dict]:
    """gemini-2.5-flash (a thinking model) attaches a thoughtSignature blob to
    parts. Round-tripping it through Postgres and replaying it in a request
    from a brand-new container is unverified and a plausible source of the
    model losing track of where it is in the conversation on resume — strip
    it before persisting so only plain text/functionCall parts get replayed."""
    return [{k: v for k, v in p.items() if k != "thoughtSignature"} for p in parts]


async def _run_loop(db: AsyncSession, run: AgentRun, ctx: ToolContext, contents: list[dict]) -> None:
    seq = await _last_seq(db, run.id)

    for _step in range(MAX_STEPS):
        t0 = time.time()
        try:
            response = await _call_gemini(contents)
        except Exception as e:
            logger.error(f"[{run.drive_id}] orchestrator Gemini call failed: {e}")
            run.status = AgentRunStatus.FAILED
            await db.commit()
            await _log_trace(db, run, seq, "orchestrator", "violation", f"Gemini call failed: {e}")
            return
        cost_ms = int((time.time() - t0) * 1000)

        candidates = response.get("candidates") or []
        if not candidates:
            run.status = AgentRunStatus.FAILED
            await db.commit()
            await _log_trace(db, run, seq, "orchestrator", "violation", "Gemini returned no candidates")
            return

        model_turn = candidates[0]["content"]
        model_turn["parts"] = _strip_thought_signatures(model_turn.get("parts", []))
        contents.append(model_turn)
        # list(contents) — not contents. Assigning the same list object each time
        # makes SQLAlchemy's dirty-check compare the tracked value against itself,
        # so every UPDATE after the first was silently dropped and a resumed run
        # replayed a 2-turn conversation. Snapshot it.
        run.state_json = {"contents": list(contents)}
        await db.commit()

        parts = model_turn.get("parts", [])
        function_calls = [p["functionCall"] for p in parts if "functionCall" in p]
        thoughts = [p["text"] for p in parts if "text" in p and p["text"].strip()]

        if not function_calls:
            # No tool call left to make — the model considers this done, and on
            # that last turn its thoughts ARE the final answer. Logging both
            # would put the same paragraph in the trace twice, once as a thought
            # and again as the decision.
            final_text = " ".join(thoughts) or "(no final message)"
            run.status = AgentRunStatus.COMPLETED
            await db.commit()
            seq += 1
            await _log_trace(db, run, seq, "orchestrator", "decision", final_text, cost_ms=cost_ms)
            return

        # cost_ms is the latency of the one _call_gemini above, so it belongs to
        # the turn, not to each row. Attaching it to every thought of a multi-
        # thought turn would render as two full-width bars — double the real time.
        for i, t in enumerate(thoughts):
            seq += 1
            await _log_trace(
                db, run, seq, "orchestrator", "thought", t,
                cost_ms=cost_ms if i == 0 else None,
            )

        function_responses = []
        paused = False
        for call in function_calls:
            name = call["name"]
            args = call.get("args", {})
            seq += 1
            await _log_trace(
                db, run, seq, "orchestrator", "tool_call",
                f"Calling {name}({args})", detail={"name": name, "args": args},
            )

            if name == "ask_human":
                run.status = AgentRunStatus.PAUSED
                run.pending_question = args
                run.state_json = {"contents": list(contents)}
                if ctx.drive:
                    ctx.drive.status = DriveStatus.SHORTLIST_PENDING
                await db.commit()
                seq += 1
                await _log_trace(
                    db, run, seq, "orchestrator", "ask_human",
                    args.get("question", "(no question)"), detail=args,
                )
                paused = True
                break

            executor = TOOL_EXECUTORS.get(name)
            t_tool = time.time()
            if executor is None:
                result = {"error": f"unknown tool {name}"}
            else:
                try:
                    result = await executor(ctx, args)
                except Exception as e:
                    logger.error(f"[{run.drive_id}] tool {name} failed: {e}")
                    result = {"error": str(e)}
            tool_ms = int((time.time() - t_tool) * 1000)

            seq += 1
            await _log_trace(
                db, run, seq, "orchestrator", "observation",
                f"{name} -> {result}", detail={"name": name, "result": result},
                cost_ms=tool_ms,
            )

            # Reflect key state changes into the existing DriveStatus so the
            # current dashboard (which reads drive.status, not the new trace)
            # still shows something sensible without any frontend change.
            if name == "check_eligibility" and ctx.drive:
                ctx.drive.status = DriveStatus.ELIGIBILITY_CHECKED
                await db.commit()
            if name == "rank_candidates" and ctx.drive:
                ctx.drive.status = DriveStatus.MATCHED
                await db.commit()

            function_responses.append({
                "functionResponse": {"name": name, "response": result}
            })

        if paused:
            return

        contents.append({"role": "user", "parts": function_responses})
        run.state_json = {"contents": list(contents)}
        await db.commit()

    run.status = AgentRunStatus.FAILED
    await db.commit()
    seq += 1
    await _log_trace(db, run, seq, "orchestrator", "violation", f"exceeded {MAX_STEPS} steps without finishing")
