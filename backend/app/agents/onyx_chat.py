"""
Onyx chat — the free-text sidebar, reachable from anywhere in the TPO portal.

Unlike the per-round Onyx profile in orchestrator.py's _PROFILES["onyx"]
(which pauses on ask_human and persists to the agent_runs table), this never
pauses: the TPO is the human, live, in the chat itself, so there is nothing
to durably resume. Each message runs a short tool-calling loop to completion
and returns the final answer synchronously — same shape as analyst_agent's
/ask endpoint, but Onyx also carries two more tools so it can dispatch and
read a real negotiation, not just query the database. Conversation history
is kept client-side (Vertex's own `contents` shape, round-tripped through the
frontend) rather than a new DB table — consistent with this app's no-Alembic
constraint, and a chat sidebar has no reason to survive a container restart
the way a paused agent run does.
"""
import time
from typing import Any

from loguru import logger
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.analyst_agent import generate_sql, summarize_rows, validate_readonly_sql
from app.agents.onyx_tools import OnyxContext, _exec_start_negotiation, _exec_get_negotiation_outcome

MAX_CHAT_STEPS = 4

ONYX_CHAT_SYSTEM = """You are Onyx, the supervisor agent embedded across this placement platform's
TPO portal. A TPO is chatting with you live, right now — there is no ask_human tool here, because
they ARE the human, already present. Answer directly, in the same turn.

You have three tools:
- ask_analyst(question): answers any question about the placement data (students, drives,
  eligibility, shortlists, schedules, interview slots) by writing and running one read-only SQL
  query behind the scenes. Use it for anything data-shaped — counts, lookups, comparisons.
- start_negotiation(round_id): dispatches your two sub-agents — the TPO's scheduling agent and a
  company's own agent — to negotiate an interview schedule for one specific round, and runs it to
  completion. Only call this with a round_id the TPO actually gave you or that is visible earlier
  in this conversation — never invent one.
- get_negotiation_outcome(run_id): reads back what a negotiation run actually did.

Rules:
- Call a tool whenever the question needs real data or a real action — never guess a number or
  fabricate what a negotiation did.
- Once you have what you need, answer in two or three plain-English sentences, then stop.
- If nothing in your tools can answer the question, or a round_id/run_id is missing, say so
  plainly and ask for it instead of guessing.
"""

ONYX_CHAT_TOOLS = [
    {
        "name": "ask_analyst",
        "description": (
            "Answer a placement-data question (students, drives, eligibility, shortlists, "
            "schedules, interview slots) by querying the real database."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {"question": {"type": "STRING", "description": "The data question, in plain English."}},
            "required": ["question"],
        },
    },
    {
        "name": "start_negotiation",
        "description": "Dispatch the TPO scheduling agent and the company's agent to negotiate an interview schedule for a specific round.",
        "parameters": {
            "type": "OBJECT",
            "properties": {"round_id": {"type": "STRING", "description": "The interview round's id."}},
            "required": ["round_id"],
        },
    },
    {
        "name": "get_negotiation_outcome",
        "description": "Read back what a negotiation run actually did — final status, the agreed (or unresolved) proposal.",
        "parameters": {
            "type": "OBJECT",
            "properties": {"run_id": {"type": "STRING", "description": "The negotiation run's id."}},
            "required": ["run_id"],
        },
    },
]


async def _exec_ask_analyst(db: AsyncSession, args: dict) -> dict:
    question = args.get("question") or ""
    generated_sql = await generate_sql(question)
    safe_sql = validate_readonly_sql(generated_sql)
    if not safe_sql:
        retry_sql = await generate_sql(
            question,
            retry_hint=(
                f"Your previous answer was rejected: {generated_sql or '(empty)'}. Use only the "
                "exact tables and columns listed above, one plain SELECT, explicit JOINs, no "
                "CTEs, no SELECT *."
            ),
        )
        safe_sql = validate_readonly_sql(retry_sql)
        if not safe_sql:
            return {"error": "could not form a safe query for that question"}

    try:
        result = await db.execute(text(safe_sql))
        rows = [dict(row) for row in result.mappings().all()]
    except SQLAlchemyError:
        await db.rollback()
        return {"error": "query failed against the database"}

    answer = await summarize_rows(question, safe_sql, rows)
    return {"answer": answer, "row_count": len(rows)}


async def run_onyx_chat(db: AsyncSession, message: str, history: list[dict]) -> dict[str, Any]:
    """One turn of the sidebar chat. `history` is the prior turns' Vertex
    `contents` list (round-tripped by the frontend) so the sidebar holds a
    real conversation, not isolated one-shot questions."""
    from app.agents.orchestrator import _call_gemini, _strip_thought_signatures

    contents = list(history) + [{"role": "user", "parts": [{"text": message}]}]
    ctx = OnyxContext(db, "", None)
    trace: list[dict] = []

    for _step in range(MAX_CHAT_STEPS):
        t0 = time.time()
        try:
            response = await _call_gemini(contents, ONYX_CHAT_SYSTEM, ONYX_CHAT_TOOLS)
        except Exception as e:
            logger.error(f"onyx chat Gemini call failed: {e}")
            return {"answer": "Onyx is unavailable right now — try again in a moment.", "contents": history, "trace": trace}
        cost_ms = int((time.time() - t0) * 1000)

        candidates = response.get("candidates") or []
        if not candidates:
            return {"answer": "Onyx is unavailable right now — try again in a moment.", "contents": history, "trace": trace}

        model_turn = candidates[0]["content"]
        model_turn["parts"] = _strip_thought_signatures(model_turn.get("parts", []))
        contents.append(model_turn)

        parts = model_turn.get("parts", [])
        function_calls = [p["functionCall"] for p in parts if "functionCall" in p]
        thoughts = [p["text"] for p in parts if "text" in p and p["text"].strip()]

        if not function_calls:
            final_text = " ".join(thoughts) or "(no answer)"
            return {"answer": final_text, "contents": contents, "trace": trace}

        function_responses = []
        for call in function_calls:
            name = call["name"]
            args = call.get("args", {})
            t_tool = time.time()
            if name == "ask_analyst":
                result = await _exec_ask_analyst(db, args)
            elif name == "start_negotiation":
                result = await _exec_start_negotiation(ctx, args)
            elif name == "get_negotiation_outcome":
                result = await _exec_get_negotiation_outcome(ctx, args)
            else:
                result = {"error": f"unknown tool {name}"}
            trace.append({"tool": name, "args": args, "result": result, "cost_ms": int((time.time() - t_tool) * 1000)})
            function_responses.append({"functionResponse": {"name": name, "response": result}})

        contents.append({"role": "user", "parts": function_responses})

    return {
        "answer": "I looked into a few things but couldn't land on an answer — try asking more specifically.",
        "contents": contents,
        "trace": trace,
    }
