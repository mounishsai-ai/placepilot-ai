"""
Onyx — the supervisor agent. Its tools don't touch the database directly the
way every other profile's do; they dispatch and read OTHER agent runs. This
is a real "agent whose tools are other agents" pattern, not decoration:
start_negotiation creates and runs a full negotiation AgentRun (the TPO's
scheduling agent arguing with the company's own agent — see
negotiation_tools.py) to its conclusion, and get_negotiation_outcome reads
back what actually happened, so Onyx reports to the TPO from real numbers,
not narration of its own.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AgentRun, InterviewRound, MatchScore


class OnyxContext:
    """Per-run scratch space. Onyx has no drive/roster data of its own —
    round_id is the one piece of state its tools need, set once at
    create_run time, same as the schedule/negotiation profiles."""

    def __init__(self, db: AsyncSession, drive_id: str, round_id: str | None):
        self.db = db
        self.drive_id = drive_id
        self.round_id = round_id


ONYX_TOOL_DECLARATIONS = [
    {
        "name": "start_negotiation",
        "description": (
            "Dispatch your two sub-agents — the TPO's scheduling agent and the hiring "
            "company's own agent — to negotiate an interview schedule for this round. Runs "
            "the full negotiation through to its conclusion (agreement, an unresolved "
            "objection, or the round limit) and returns once it's ready for your review. "
            "Call this first."
        ),
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "get_negotiation_outcome",
        "description": (
            "Read back what a negotiation run actually did — final status, how many slots "
            "and panels are in the agreed (or unresolved) proposal. Call this right after "
            "start_negotiation, with the run_id it returned, before reporting to the TPO."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "run_id": {"type": "STRING", "description": "The run_id returned by start_negotiation."},
            },
            "required": ["run_id"],
        },
    },
    {
        "name": "ask_human",
        "description": "Pause and hand your report to the TPO — a plain-English summary of what your sub-agents did and your recommendation.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "question": {"type": "STRING", "description": "Your report and question for the TPO."},
                "options": {
                    "type": "ARRAY", "items": {"type": "STRING"},
                    "description": "Suggested answer options, if applicable.",
                },
            },
            "required": ["question"],
        },
    },
]


async def _exec_start_negotiation(ctx: OnyxContext, args: dict) -> dict:
    from app.agents import orchestrator  # local import: orchestrator.py imports this module

    round_id = args.get("round_id") or ctx.round_id
    if not round_id:
        return {"error": "no round_id known for this run"}

    # Resolved from the round itself, not trusted from ctx.drive_id — the
    # sidebar chat (onyx_chat.py) reuses this executor without a drive_id
    # pinned up front, only a round_id the TPO names mid-conversation.
    round_result = await ctx.db.execute(select(InterviewRound).where(InterviewRound.id == round_id))
    round_ = round_result.scalar_one_or_none()
    if not round_:
        return {"error": f"no interview round {round_id}"}
    drive_id = round_.drive_id

    matches_result = await ctx.db.execute(
        select(MatchScore.student_id).where(
            MatchScore.drive_id == drive_id, MatchScore.shortlisted == True,
        )
    )
    if not matches_result.first():
        return {"error": "no shortlisted students for this drive — approve a shortlist before negotiating"}

    run = await orchestrator.create_run(ctx.db, drive_id, kind="negotiation", round_id=round_id)
    await orchestrator.execute_run(ctx.db, run.id, drive_id)
    await ctx.db.refresh(run)

    return {
        "run_id": run.id,
        "status": run.status.value,
        "question": run.pending_question,
    }


async def _exec_get_negotiation_outcome(ctx: OnyxContext, args: dict) -> dict:
    run_id = args.get("run_id")
    result = await ctx.db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        return {"error": f"no negotiation run {run_id}"}

    state = run.state_json or {}
    proposal = state.get("final_proposal") or []
    panels = {s.get("panel_id") for s in proposal if s.get("panel_id")}
    return {
        "status": run.status.value,
        "pending_question": run.pending_question,
        "proposed_slot_count": len(proposal),
        "panels_involved": len(panels),
    }


async def _exec_ask_human(ctx: OnyxContext, args: dict) -> dict:
    raise RuntimeError("ask_human must be intercepted by the orchestrator loop")


ONYX_TOOL_EXECUTORS = {
    "start_negotiation": _exec_start_negotiation,
    "get_negotiation_outcome": _exec_get_negotiation_outcome,
    "ask_human": _exec_ask_human,
}
