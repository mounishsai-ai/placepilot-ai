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
import asyncio
import time
from typing import Any
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.models import AgentRun, AgentRunStatus, AgentTrace, PlacementDrive, DriveStatus
from app.agents.tools import ToolContext, TOOL_DECLARATIONS, TOOL_EXECUTORS
from app.agents.schedule_tools import (
    ScheduleContext, SCHEDULE_TOOL_DECLARATIONS, SCHEDULE_TOOL_EXECUTORS,
)
from app.agents.negotiation_tools import (
    NEGOTIATION_TOOL_DECLARATIONS, NEGOTIATION_TOOL_EXECUTORS,
    load_company_signals, summarize_proposal, evaluate_proposal,
)
from app.agents.onyx_tools import OnyxContext, ONYX_TOOL_DECLARATIONS, ONYX_TOOL_EXECUTORS
from app.agents.auditor_agent import audit_pipeline
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
- get_drive_context may report existing_jd_parsed / existing_eligible_count /
  existing_shortlist — this drive was already processed, either by an
  earlier run or by the older non-agentic pipeline the Company/HR side can
  trigger directly. That work is real and already saved; do not redo it.
  Skip straight to ask_human, summarizing existing_shortlist's ranked_count
  and top_candidates as your recommendation — do not call parse_jd,
  check_eligibility, or rank_candidates. Only fall through to the normal
  parse → check → rank sequence below when get_drive_context reports none
  of these.
- parse_jd must run before check_eligibility.
- check_eligibility must run before rank_candidates.
- Once you have ranked candidates, call ask_human with a clear recommendation
  and question — never finalize a shortlist without asking.
- Before each tool call, write one short sentence explaining why you're calling it.
- If a tool result looks wrong, incomplete, or returns an error, say so and
  decide what to do next yourself instead of proceeding blindly.
- Once ask_human's functionResponse comes back with the TPO's answer:
  - If they approved it (or said something equivalent to yes), reply with a
    short confirmation that the shortlist is final and ready for scheduling,
    and stop.
  - If they asked for a different number of candidates (e.g. "5 more", "top
    30"), call rank_candidates again with an adjusted top_k — this replaces
    the previous ranking — then call ask_human again with the new shortlist.
    Do not call get_drive_context, parse_jd, or check_eligibility again.
  - If they named specific students or gave a criterion to add — including
    students who did NOT pass check_eligibility (e.g. "approve anyone with
    99%+ attendance", "include Rahul Sharma", "add anyone within 0.5 CGPA of
    the cutoff") — call select_candidates once per distinct criterion with a
    structured field/op/value filter. This is exactly how a TPO overrides the
    automatic cutoff for a specific person; it is their call, not yours to
    refuse. Say plainly if a matched student failed the original eligibility
    check and why you're including them anyway. If select_candidates comes
    back "ambiguous" (a name matched more than one student), do not guess —
    call ask_human with one option per candidate, formatted "Name — Roll No",
    and a question like "I found N students matching X — which one?"; once
    the TPO answers, call select_candidates again with field="roll_no",
    op="eq" and the roll number from the option they picked. Once a name
    resolves to exactly one student (or matched only one to begin with), call
    ask_human again summarizing the updated total so the TPO can review and
    approve on the shortlist screen — never say a student is "approved";
    only the TPO's own approve action there is final.
  - If they asked for something select_candidates and rank_candidates truly
    cannot do (not a plain field comparison, or redefining what a field
    means), say so plainly, state what you understood, and stop.
"""

SCHEDULING_SYSTEM_PROMPT = """You are the logistics agent for a college placement drive.

A shortlist has been approved and an interview round already exists with a
fixed date/time window, mode, and duration — a human set those. Your job is
to build a conflict-free interview schedule inside that window and commit it.

Rules:
- Call get_schedule_context first if you don't already know the round, the
  shortlisted count, and the available panels/rooms.
- Call propose_schedule to generate a candidate schedule.
- Always call validate_schedule immediately after propose_schedule, before
  doing anything else — it is the deterministic source of truth on conflicts,
  never your own judgement, and it checks the whole calendar, not just this
  round.
- If validate_schedule reports violations, read them, decide a specific fix
  (exclude the exact conflicting panel_id or room_id it named, or extend the
  round's end time to make room), call propose_schedule again with that
  adjustment, and validate again.
- Never call commit_schedule unless the most recent validate_schedule for the
  current proposal reported zero violations.
- If you still can't reach a clean schedule after 3 proposal attempts, or some
  students have no available slot, call ask_human with a clear summary of the
  tradeoff and a specific question — never commit a schedule you know still
  has unresolved conflicts or unexplained gaps.
- Before each tool call, write one short sentence explaining why you're
  calling it, and state plainly what you traded off if you had to relax
  anything to get a clean result.
"""

NEGOTIATION_TPO_SYSTEM = """You are the TPO's scheduling agent, negotiating an interview schedule
with the hiring company's own agent before anything is committed. A human (the TPO) makes the
final call — your job is to reach a proposal worth putting in front of them, not to commit anything
yourself. There is no commit_schedule tool available to you here; that is deliberate.

Rules:
- Call get_schedule_context first if you don't already know the round and shortlisted count.
- Call propose_schedule, then always validate_schedule immediately after, before doing anything else.
- Once validate_schedule reports zero violations, stop your turn there — do not call ask_human yet.
  The company's agent reviews every clean proposal before you go back to the TPO.
- If a message tells you the company's agent OBJECTED, read the named panel(s) and their reasons,
  call propose_schedule again excluding those panel IDs (or extending the window if excluding them
  leaves nobody), then validate_schedule again.
- If a message tells you the company's agent ACCEPTED, call ask_human summarizing the agreed
  schedule (how many students, which panels, any accommodation you made) and ask the TPO to confirm.
- If a message tells you the negotiation reached its round limit with no agreement, call ask_human
  with the best proposal reached and the unresolved objection, and ask the TPO how to proceed.
- Before each tool call, write one short sentence explaining why.
"""

ONYX_SYSTEM_PROMPT = """You are Onyx, the supervisor agent for this placement drive's scheduling
round. Unlike every other agent here, your own tools don't touch the database directly — they
dispatch and read OTHER agents. Right now your job is to oversee a negotiation between two
sub-agents: the TPO's scheduling agent (proposing interview slots) and the hiring company's own
agent (reviewing them against real panel availability), and report the outcome to the TPO in
plain English.

Rules:
- Call start_negotiation first. It runs the whole negotiation through to its conclusion and
  returns — you don't need to poll it.
- Call get_negotiation_outcome with the run_id it gave you, to see the concrete numbers before
  you say anything to the TPO. Never guess at what your sub-agents did.
- Call ask_human with a short report: how many rounds the negotiation took, whether the two
  agents reached agreement or where they still disagree, and your recommendation. Speak as the
  supervisor reporting on sub-agents you dispatched, not as the negotiation itself.
- Before each tool call, write one short sentence explaining why you're calling it.
"""

_PROFILES = {
    "shortlist": {
        "system_prompt": ORCHESTRATOR_SYSTEM_PROMPT,
        "tools": TOOL_DECLARATIONS,
        "executors": TOOL_EXECUTORS,
    },
    "schedule": {
        "system_prompt": SCHEDULING_SYSTEM_PROMPT,
        "tools": SCHEDULE_TOOL_DECLARATIONS,
        "executors": SCHEDULE_TOOL_EXECUTORS,
    },
    "negotiation": {
        "system_prompt": NEGOTIATION_TPO_SYSTEM,
        "tools": NEGOTIATION_TOOL_DECLARATIONS,
        "executors": NEGOTIATION_TOOL_EXECUTORS,
    },
    "onyx": {
        "system_prompt": ONYX_SYSTEM_PROMPT,
        "tools": ONYX_TOOL_DECLARATIONS,
        "executors": ONYX_TOOL_EXECUTORS,
    },
}

MAX_STEPS = 15
MAX_NEGOTIATION_STEPS = 18
MAX_NEGOTIATION_ROUNDS = 3


# Vertex hands back 429 (quota) or 503 (overloaded) under real load — both are
# transient and worth a couple of retries rather than failing the whole run,
# which previously happened on the very first 429 seen during live testing.
_RETRY_DELAYS_S = [5, 15]


async def _call_gemini(contents: list[dict], system_prompt: str, tool_declarations: list[dict]) -> dict:
    token = get_vertex_access_token()
    url = VERTEX_GENERATE_URL.format(
        project=settings.GCP_PROJECT_ID, model=settings.VERTEX_ORCHESTRATOR_MODEL,
    )
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "tools": [{"functionDeclarations": tool_declarations}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        for attempt, delay in enumerate([*_RETRY_DELAYS_S, None]):
            resp = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=payload)
            if resp.status_code not in (429, 503) or delay is None:
                resp.raise_for_status()
                return resp.json()
            logger.warning(
                f"Vertex {resp.status_code}, retrying in {delay}s (attempt {attempt + 1}/{len(_RETRY_DELAYS_S)})"
            )
            await asyncio.sleep(delay)


async def _last_seq(db: AsyncSession, run_id: str) -> int:
    """Highest seq already logged for this run (0 if none)."""
    result = await db.execute(select(AgentTrace).where(AgentTrace.run_id == run_id))
    rows = result.scalars().all()
    return max((r.seq for r in rows), default=0)


_VIOLATION_LABELS = {"panel_conflict": "panel double-booking", "room_conflict": "room double-booking"}


def _humanize_result(name: str, result: dict) -> str:
    """The trace UI shows this text directly to a TPO, not a developer — a raw
    Python dict repr (single-quoted keys, nested violation lists) reads as
    gibberish there. Known tool results get a real English sentence; anything
    else falls back to plain `key: value` pairs instead of repr() quoting."""
    if not isinstance(result, dict):
        return f"{name} -> {result}"
    if "error" in result:
        return f"{name} failed: {result['error']}"

    if name == "validate_schedule":
        if result.get("clean"):
            return "Clean — no conflicts against the rest of the calendar."
        counts: dict[str, int] = {}
        for v in result.get("violations") or []:
            label = _VIOLATION_LABELS.get(v.get("type"), v.get("type", "conflict"))
            counts[label] = counts.get(label, 0) + 1
        parts = [f"{n} {label}{'s' if n != 1 else ''}" for label, n in counts.items()]
        unscheduled = result.get("unscheduled_count") or 0
        tail = f"; {unscheduled} students still unscheduled" if unscheduled else ""
        return f"{result.get('violation_count', 0)} conflict(s) found — {', '.join(parts) or 'see detail'}{tail}."

    if name == "propose_schedule":
        extended = result.get("end_time_extended_minutes")
        tail = f", window extended by {extended} min" if extended else ""
        return (
            f"Proposed {result.get('proposed_count', 0)} slots using "
            f"{result.get('panels_used', 0)} panel(s) and {result.get('rooms_used', 0)} room(s); "
            f"{result.get('unscheduled_count', 0)} students still unscheduled{tail}."
        )

    if name == "get_schedule_context":
        return (
            f"{result.get('shortlisted_count', '?')} shortlisted students, "
            f"{result.get('panel_count', '?')} panel(s) and {result.get('room_count', '?')} room(s) available."
        )

    if name == "commit_schedule":
        return f"Committed {result.get('committed_count', 0)} interview slots."

    if name == "start_negotiation":
        status = result.get("status")
        return "Negotiation failed to start." if status == "failed" else f"Negotiation dispatched — currently {status}."

    if name == "get_negotiation_outcome":
        return (
            f"Negotiation is {result.get('status', 'unknown')} — "
            f"{result.get('proposed_slot_count', 0)} slot(s) proposed across "
            f"{result.get('panels_involved', 0)} panel(s)."
        )

    # Generic fallback for every other tool (get_drive_context, parse_jd,
    # check_eligibility, rank_candidates, select_candidates, ask_analyst, ...):
    # readable `key: value` pairs, never repr()'s single-quoted dict syntax.
    parts = []
    for k, v in result.items():
        if isinstance(v, list):
            v = f"{len(v)} item(s)"
        elif isinstance(v, dict):
            v = "…"
        parts.append(f"{k.replace('_', ' ')}: {v}")
    return f"{name} — " + ("; ".join(parts) if parts else "done.")


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


async def create_run(
    db: AsyncSession, drive_id: str, kind: str = "shortlist", round_id: str | None = None,
) -> AgentRun:
    """Insert the AgentRun row synchronously so callers get a run_id back
    immediately, before the (slow) agent loop runs in the background.

    `kind` picks which system prompt/tool set this run (and any later
    resume) uses — stored in state_json rather than a new column, since
    AgentRun already exists in the deployed Cloud SQL schema and this app has
    no migration path beyond create_all's additive table creation."""
    if kind not in _PROFILES:
        raise ValueError(f"unknown agent run kind {kind!r}")
    state: dict[str, Any] = {"contents": [], "kind": kind}
    if round_id:
        state["round_id"] = round_id
    run = AgentRun(drive_id=drive_id, status=AgentRunStatus.RUNNING, state_json=state)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


def _build_ctx(db: AsyncSession, drive_id: str, kind: str, round_id: str | None):
    if kind in ("schedule", "negotiation"):
        if not round_id:
            raise ValueError(f"{kind} run has no round_id in state_json")
        return ScheduleContext(db, drive_id, round_id)
    if kind == "onyx":
        return OnyxContext(db, drive_id, round_id)
    return ToolContext(db, drive_id)


async def execute_run(db: AsyncSession, run_id: str, drive_id: str) -> AgentRun:
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise ValueError(f"agent run {run_id} not found")

    kind = (run.state_json or {}).get("kind", "shortlist")
    round_id = (run.state_json or {}).get("round_id")
    begin_text = (
        f"Begin negotiating the interview schedule for round {round_id} with the company's agent."
        if kind == "negotiation" else
        f"Begin building the interview schedule for round {round_id}."
        if kind == "schedule" else
        f"Oversee scheduling for round {round_id} of this drive: dispatch your sub-agents, "
        "review what they did, and report to the TPO."
        if kind == "onyx" else f"Begin processing drive {drive_id}."
    )
    contents = [{"role": "user", "parts": [{"text": begin_text}]}]
    ctx = _build_ctx(db, drive_id, kind, round_id)
    if kind == "negotiation":
        await _run_negotiation_loop(db, run, ctx, contents)
    else:
        await _run_loop(db, run, ctx, contents, kind)
    return run


async def resume_run(db: AsyncSession, run_id: str, human_answer: str) -> AgentRun:
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise ValueError(f"agent run {run_id} not found")
    if run.status != AgentRunStatus.PAUSED:
        raise ValueError(f"agent run {run_id} is {run.status.value}, not paused")

    kind = (run.state_json or {}).get("kind", "shortlist")
    round_id = (run.state_json or {}).get("round_id")

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

    ctx = _build_ctx(db, run.drive_id, kind, round_id)
    if kind == "negotiation":
        # Negotiation only ever pauses once its final proposal is ready for the
        # TPO — a resume here is the TPO's answer to that final question, not a
        # new round. Nothing left to negotiate; the answer itself is the record.
        run.status = AgentRunStatus.COMPLETED
        await db.commit()
    else:
        await _run_loop(db, run, ctx, contents, kind)
    return run


def _strip_thought_signatures(parts: list[dict]) -> list[dict]:
    """gemini-2.5-flash (a thinking model) attaches a thoughtSignature blob to
    parts. Round-tripping it through Postgres and replaying it in a request
    from a brand-new container is unverified and a plausible source of the
    model losing track of where it is in the conversation on resume — strip
    it before persisting so only plain text/functionCall parts get replayed."""
    return [{k: v for k, v in p.items() if k != "thoughtSignature"} for p in parts]


def _snapshot_state(run: AgentRun, contents: list[dict]) -> dict:
    """Preserve kind/round_id (set once at create_run) across every state_json
    write — a plain {"contents": ...} overwrite would silently erase them,
    and resume_run needs them to pick the right system prompt/tools again."""
    return {**(run.state_json or {}), "contents": list(contents)}


async def _run_loop(
    db: AsyncSession, run: AgentRun, ctx: ToolContext | ScheduleContext,
    contents: list[dict], kind: str = "shortlist",
) -> None:
    """Thin wrapper: every exception inside the loop must end in the run
    being marked FAILED, not silently abandoned. _call_gemini's own errors
    already do that, but anything else unhandled (a DB timeout on a state
    save, a tool executor raising outside its own try/except, ...) would
    otherwise leave the run stuck showing "running" forever — nothing else
    was ever going to resume it. Observed live 2026-08-27: a scheduling run's
    state-save hit a connection pool timeout mid-loop and the run just sat
    there, indistinguishable in the UI from the agent still thinking."""
    try:
        await _run_loop_inner(db, run, ctx, contents, kind)
    except Exception as e:
        logger.error(f"[{run.drive_id}] orchestrator loop crashed: {e}")
        try:
            run.status = AgentRunStatus.FAILED
            await db.commit()
        except Exception as commit_err:
            logger.error(f"[{run.drive_id}] could not even mark run failed: {commit_err}")


async def _run_loop_inner(
    db: AsyncSession, run: AgentRun, ctx: ToolContext | ScheduleContext,
    contents: list[dict], kind: str = "shortlist",
) -> None:
    profile = _PROFILES[kind]
    system_prompt = profile["system_prompt"]
    tool_declarations = profile["tools"]
    tool_executors = profile["executors"]

    seq = await _last_seq(db, run.id)

    for _step in range(MAX_STEPS):
        t0 = time.time()
        try:
            response = await _call_gemini(contents, system_prompt, tool_declarations)
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
        run.state_json = _snapshot_state(run, contents)
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
                # A second, independent model checks the pipeline's numbers —
                # not the orchestrator's narration of them — before a human
                # is asked to sign off. Only meaningful for the shortlist
                # profile: a resumed run's fresh ToolContext, or a model that
                # calls ask_human early (e.g. the JD had no text), would
                # otherwise hand the auditor an all-zero summary that trips
                # its own "nothing was filtered" checks for real reasons. The
                # scheduling profile's ScheduleContext has no match_results at
                # all — it audits itself via validate_schedule instead.
                if kind == "shortlist" and ctx.match_results:
                    audit_summary = {
                        "role": (ctx.jd_parsed or {}).get("role"),
                        "package_lpa": (ctx.jd_parsed or {}).get("package_lpa"),
                        "total_students": len(ctx.all_students),
                        "eligible_count": len(ctx.eligible_students),
                        "criteria_from": ctx.criteria_from,
                        "criteria_applied": ctx.criteria_applied,
                        "ranked_count": len(ctx.match_results),
                        "top_k_requested": ctx.top_k_requested,
                        "top_candidates": [
                            {"name": m["name"], "score": m["score"], "rank": m["rank"]}
                            for m in ctx.match_results[:5]
                        ],
                    }
                    t_audit = time.time()
                    try:
                        audit = await audit_pipeline(audit_summary)
                    except Exception as e:
                        logger.error(f"[{run.drive_id}] auditor call failed: {e}")
                        audit = {"verdict": "clear", "concerns": [], "note": "Audit failed to run.", "degraded": True}
                    audit_ms = int((time.time() - t_audit) * 1000)

                    seq += 1
                    await _log_trace(
                        db, run, seq, "auditor", "audit",
                        audit.get("note") or "Audit complete.",
                        detail={**audit_summary, "verdict": audit.get("verdict"), "concerns": audit.get("concerns")},
                        cost_ms=audit_ms,
                    )
                    args = {**args, "audit": audit}

                run.status = AgentRunStatus.PAUSED
                run.pending_question = args
                run.state_json = _snapshot_state(run, contents)
                # Only the shortlist profile owns DriveStatus this way — the
                # scheduling profile pausing to ask a question shouldn't
                # silently rewind the drive back to "awaiting shortlist".
                if kind == "shortlist" and getattr(ctx, "drive", None):
                    ctx.drive.status = DriveStatus.SHORTLIST_PENDING
                await db.commit()
                seq += 1
                await _log_trace(
                    db, run, seq, "orchestrator", "ask_human",
                    args.get("question", "(no question)"), detail=args,
                )
                paused = True
                break

            executor = tool_executors.get(name)
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
                _humanize_result(name, result), detail={"name": name, "result": result},
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
        run.state_json = _snapshot_state(run, contents)
        await db.commit()

    run.status = AgentRunStatus.FAILED
    await db.commit()
    seq += 1
    await _log_trace(db, run, seq, "orchestrator", "violation", f"exceeded {MAX_STEPS} steps without finishing")


# ─── Negotiation: two agents, not one ──────────────────────────────────────
#
# Structurally this is _run_loop_inner with one addition: right after a clean
# validate_schedule, the Company agent (a one-shot judgement call, not a full
# tool-calling loop of its own — see negotiation_tools.py) reviews the
# proposal against its own panel's real signals and either accepts or
# objects. Its verdict is injected back as a plain-text turn, exactly like a
# tool result would be, and the TPO agent reacts to it on its next step.
# commit_schedule is never in this loop's tool set — see negotiation_tools.py
# for why that alone is the whole isolation guarantee.

def _serialize_proposal(ctx: ScheduleContext) -> list[dict]:
    return [
        {
            "student_id": s["student_id"],
            "panel_id": s.get("panel_id"),
            "room_id": s.get("room_id"),
            "slot_start": s["slot_start"].isoformat() + "Z",
            "slot_end": s["slot_end"].isoformat() + "Z",
        }
        for s in ctx.proposed_slots
    ]


async def _run_negotiation_loop(db: AsyncSession, run: AgentRun, ctx: ScheduleContext, contents: list[dict]) -> None:
    try:
        await _run_negotiation_loop_inner(db, run, ctx, contents)
    except Exception as e:
        logger.error(f"[{run.drive_id}] negotiation loop crashed: {e}")
        try:
            run.status = AgentRunStatus.FAILED
            await db.commit()
        except Exception as commit_err:
            logger.error(f"[{run.drive_id}] could not even mark negotiation run failed: {commit_err}")


async def _run_negotiation_loop_inner(db: AsyncSession, run: AgentRun, ctx: ScheduleContext, contents: list[dict]) -> None:
    seq = await _last_seq(db, run.id)
    company_signals = await load_company_signals(db, ctx.drive_id, ctx.round_id)
    rounds_used = 0

    for _step in range(MAX_NEGOTIATION_STEPS):
        t0 = time.time()
        try:
            response = await _call_gemini(contents, NEGOTIATION_TPO_SYSTEM, NEGOTIATION_TOOL_DECLARATIONS)
        except Exception as e:
            logger.error(f"[{run.drive_id}] negotiation Gemini call failed: {e}")
            run.status = AgentRunStatus.FAILED
            await db.commit()
            seq += 1
            await _log_trace(db, run, seq, "orchestrator", "violation", f"Gemini call failed: {e}")
            return
        cost_ms = int((time.time() - t0) * 1000)

        candidates = response.get("candidates") or []
        if not candidates:
            run.status = AgentRunStatus.FAILED
            await db.commit()
            seq += 1
            await _log_trace(db, run, seq, "orchestrator", "violation", "Gemini returned no candidates")
            return

        model_turn = candidates[0]["content"]
        model_turn["parts"] = _strip_thought_signatures(model_turn.get("parts", []))
        contents.append(model_turn)
        run.state_json = _snapshot_state(run, contents)
        await db.commit()

        parts = model_turn.get("parts", [])
        function_calls = [p["functionCall"] for p in parts if "functionCall" in p]
        thoughts = [p["text"] for p in parts if "text" in p and p["text"].strip()]

        for i, t in enumerate(thoughts):
            seq += 1
            await _log_trace(
                db, run, seq, "orchestrator", "thought", t,
                cost_ms=cost_ms if i == 0 else None,
            )

        if not function_calls:
            # Negotiation must always conclude via ask_human. A bare text turn
            # here means the model thinks it's between rounds, not actually
            # done — nudge it forward instead of silently ending the run the
            # way the single-agent loop's "no function_calls" branch would.
            contents.append({
                "role": "user",
                "parts": [{"text": "Continue: call a tool, or ask_human if you're ready to hand this to the TPO."}],
            })
            run.state_json = _snapshot_state(run, contents)
            await db.commit()
            continue

        function_responses = []
        pending_update_text: str | None = None
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
                state = _snapshot_state(run, contents)
                state["final_proposal"] = _serialize_proposal(ctx)
                run.state_json = state
                await db.commit()
                seq += 1
                await _log_trace(
                    db, run, seq, "orchestrator", "ask_human",
                    args.get("question", "(no question)"), detail=args,
                )
                paused = True
                break

            executor = NEGOTIATION_TOOL_EXECUTORS.get(name)
            t_tool = time.time()
            if executor is None:
                result = {"error": f"unknown tool {name}"}
            else:
                try:
                    result = await executor(ctx, args)
                except Exception as e:
                    logger.error(f"[{run.drive_id}] negotiation tool {name} failed: {e}")
                    result = {"error": str(e)}
            tool_ms = int((time.time() - t_tool) * 1000)

            seq += 1
            await _log_trace(
                db, run, seq, "orchestrator", "observation",
                _humanize_result(name, result), detail={"name": name, "result": result},
                cost_ms=tool_ms,
            )
            function_responses.append({"functionResponse": {"name": name, "response": result}})

            if name == "validate_schedule" and isinstance(result, dict) and result.get("clean"):
                if rounds_used >= MAX_NEGOTIATION_ROUNDS:
                    pending_update_text = (
                        "NEGOTIATION UPDATE: You've reached the round limit with no full agreement. "
                        "Call ask_human now with the best proposal reached and the unresolved "
                        "objection, and ask the TPO how to proceed."
                    )
                else:
                    rounds_used += 1
                    proposal_summary = summarize_proposal(ctx)
                    try:
                        verdict = await evaluate_proposal(proposal_summary, company_signals)
                    except Exception as e:
                        logger.error(f"[{run.drive_id}] company agent call failed: {e}")
                        verdict = {
                            "verdict": "accept", "objections": [],
                            "message": "Company agent unavailable — proceeding without objection.",
                            "degraded": True,
                        }

                    seq += 1
                    accepted = verdict.get("verdict") == "accept"
                    await _log_trace(
                        db, run, seq, "company_agent", "decision" if accepted else "observation",
                        verdict.get("message") or ("Accepted." if accepted else "Objected."),
                        detail={**verdict, "round": rounds_used},
                    )
                    if accepted:
                        pending_update_text = (
                            f"NEGOTIATION UPDATE: The company's agent ACCEPTED your proposal "
                            f"(round {rounds_used}/{MAX_NEGOTIATION_ROUNDS}). {verdict.get('message', '')} "
                            "Call ask_human now to confirm with the TPO."
                        )
                    else:
                        objections = verdict.get("objections") or []
                        obj_text = "; ".join(
                            f"{o.get('panel_name', o.get('panel_id', 'a panel member'))}: {o.get('reason', '')}"
                            for o in objections
                        ) or "no specific reason given"
                        pending_update_text = (
                            f"NEGOTIATION UPDATE: The company's agent COUNTERED "
                            f"(round {rounds_used}/{MAX_NEGOTIATION_ROUNDS}) — {obj_text}. "
                            f"{verdict.get('message', '')} Adjust your proposal and try again."
                        )

        if paused:
            return

        # One user turn, not two — Vertex can reject a malformed content
        # sequence, and there's no reason to split a functionResponse batch
        # and its follow-up text across two consecutive same-role turns.
        turn_parts = list(function_responses)
        if pending_update_text:
            turn_parts.append({"text": pending_update_text})
        contents.append({"role": "user", "parts": turn_parts})
        run.state_json = _snapshot_state(run, contents)
        await db.commit()

    # Ran out of steps without the model itself calling ask_human -- still
    # hand the TPO something usable rather than a dead-end failure. If a
    # proposal exists (even an imperfect one), stash it as final_proposal so
    # "Commit this schedule" still works; the TPO decides, not a step count.
    has_proposal = bool(ctx.proposed_slots)
    violation_count = len(ctx.last_violations or [])
    if has_proposal and violation_count == 0:
        reason = "I have a clean proposal ready but never got a final answer from the company's agent in time."
    elif has_proposal:
        reason = f"The last proposal I had still has {violation_count} unresolved conflict(s) I couldn't clear in time."
    else:
        reason = "I couldn't produce a workable proposal at all -- most likely not enough panels or rooms for this many students in the given window."
    question = f"I ran out of negotiation steps before reaching full agreement. {reason} Please review and decide how to proceed."

    run.status = AgentRunStatus.PAUSED
    run.pending_question = {"question": question}
    state = _snapshot_state(run, contents)
    if has_proposal:
        state["final_proposal"] = _serialize_proposal(ctx)
    run.state_json = state
    await db.commit()
    seq += 1
    await _log_trace(
        db, run, seq, "orchestrator", "ask_human", question,
        detail={"reason": "step_budget_exhausted", "violation_count": violation_count, "has_proposal": has_proposal},
    )
