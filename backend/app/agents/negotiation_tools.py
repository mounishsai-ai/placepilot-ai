"""
Negotiation tool registry — two agents, not one, working the same round.

The TPO's scheduling agent proposes; a separate Company agent evaluates that
proposal against its own panel's real signals (interviews already committed
elsewhere today, any stated availability) and either accepts or objects with
a named panel and reason. The TPO agent adjusts and re-proposes. This reuses
propose_schedule/validate_schedule from schedule_tools.py verbatim — the same
ScheduleContext, the same deterministic conflict check — but the tool set
below deliberately OMITS commit_schedule. That omission is the entire
isolation guarantee: nothing this loop does can write a real InterviewSlot.
Only a human clicking "commit" on the final proposal (a separate, explicit
endpoint) ever does that.
"""
import json
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import PanelMember, PanelAvailability, InterviewSlot, InterviewRound, PlacementDrive
from app.agents.schedule_tools import (
    ScheduleContext,
    _exec_get_schedule_context,
    _exec_propose_schedule,
    _exec_validate_schedule,
)
from app.agents.vertex_json import generate_json

NEGOTIATION_TOOL_DECLARATIONS = [
    {
        "name": "get_schedule_context",
        "description": "Fetch the round's time window, mode, and duration, the shortlisted student count, and how many panels/rooms are available. Call this first.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "propose_schedule",
        "description": (
            "Generate a candidate interview schedule for every shortlisted student in this round. "
            "Optionally exclude specific panel or room IDs (e.g. ones the company's agent objected to), "
            "or extend the round's end time to fit more students."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "exclude_panel_ids": {
                    "type": "ARRAY", "items": {"type": "STRING"},
                    "description": "Panel member IDs to leave out of this attempt.",
                },
                "exclude_room_ids": {
                    "type": "ARRAY", "items": {"type": "STRING"},
                    "description": "Room IDs to leave out of this attempt.",
                },
                "extend_minutes": {
                    "type": "INTEGER",
                    "description": "Minutes to extend the round's end time by, to fit students who didn't get a slot.",
                },
            },
        },
    },
    {
        "name": "validate_schedule",
        "description": (
            "Deterministically check the most recently proposed schedule for conflicts against "
            "every other interview slot already committed, across every drive and round. Always "
            "call this right after propose_schedule."
        ),
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "ask_human",
        "description": "Pause and hand the negotiated (or unresolved) proposal to the TPO for a final decision.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "question": {"type": "STRING", "description": "What to tell the TPO."},
                "options": {
                    "type": "ARRAY", "items": {"type": "STRING"},
                    "description": "Suggested answer options, if applicable.",
                },
            },
            "required": ["question"],
        },
    },
]


async def _exec_ask_human(ctx: ScheduleContext, args: dict) -> dict:
    raise RuntimeError("ask_human must be intercepted by the orchestrator loop")


NEGOTIATION_TOOL_EXECUTORS = {
    "get_schedule_context": _exec_get_schedule_context,
    "propose_schedule": _exec_propose_schedule,
    "validate_schedule": _exec_validate_schedule,
    "ask_human": _exec_ask_human,
}


async def load_company_signals(db: AsyncSession, drive_id: str, round_id: str) -> dict:
    """What the company's agent actually knows about its own panel's day —
    real committed interviews (any drive) on the round's date, plus any
    availability window a panel member has stated. No invented data: a panel
    member with nothing on record simply carries no signal either way."""
    round_result = await db.execute(select(InterviewRound).where(InterviewRound.id == round_id))
    round_ = round_result.scalar_one_or_none()
    if not round_ or not round_.start_datetime:
        return {"panels": []}
    the_date: date = round_.start_datetime.date()

    drive_result = await db.execute(select(PlacementDrive).where(PlacementDrive.id == drive_id))
    drive = drive_result.scalar_one_or_none()
    if not drive:
        return {"panels": []}

    panels_result = await db.execute(select(PanelMember).where(PanelMember.company_id == drive.company_id))
    panels = panels_result.scalars().all()

    signals = []
    for p in panels:
        slots_result = await db.execute(
            select(InterviewSlot).where(InterviewSlot.panel_id == p.id)
        )
        already_booked = sum(
            1 for s in slots_result.scalars().all() if s.slot_start and s.slot_start.date() == the_date
        )
        avail_result = await db.execute(
            select(PanelAvailability).where(
                PanelAvailability.panel_id == p.id,
                PanelAvailability.date >= round_.start_datetime.replace(hour=0, minute=0, second=0, microsecond=0),
            )
        )
        avail = avail_result.scalars().first()
        signals.append({
            "panel_id": p.id,
            "panel_name": p.name,
            "already_booked_today": already_booked,
            "stated_available_from": avail.available_from.isoformat() if avail and avail.available_from else None,
            "stated_available_until": avail.available_until.isoformat() if avail and avail.available_until else None,
        })
    return {"panels": signals}


def summarize_proposal(ctx: ScheduleContext) -> dict:
    """Aggregate the TPO agent's current proposal by panel, for the company
    agent to react to — it doesn't need every student, just the load shape."""
    by_panel: dict[str, dict[str, Any]] = {}
    for s in ctx.proposed_slots:
        pid = s.get("panel_id")
        if not pid:
            continue
        entry = by_panel.setdefault(pid, {"panel_id": pid, "slot_count": 0, "first_start": None, "last_end": None})
        entry["slot_count"] += 1
        if entry["first_start"] is None or s["slot_start"] < entry["first_start"]:
            entry["first_start"] = s["slot_start"]
        if entry["last_end"] is None or s["slot_end"] > entry["last_end"]:
            entry["last_end"] = s["slot_end"]
    panel_names = {p["id"]: p["name"] for p in ctx.panels}
    proposed = []
    for pid, entry in by_panel.items():
        proposed.append({
            "panel_id": pid,
            "panel_name": panel_names.get(pid, pid),
            "slot_count": entry["slot_count"],
            "window": f"{entry['first_start'].isoformat()} - {entry['last_end'].isoformat()}"
            if entry["first_start"] else None,
        })
    return {
        "proposed_count": len(ctx.proposed_slots),
        "unscheduled_count": len(ctx.unscheduled),
        "by_panel": proposed,
    }


COMPANY_AGENT_SYSTEM = """You represent the hiring company's own interests in a college placement
interview schedule negotiation. You are given the placement office's proposed schedule for your
panel members (how many interview slots each is assigned, and the time window), plus what is
actually known about each panel member's real day: interviews they already have booked elsewhere
today, and any availability window they've stated for this date.

Only object when the data you were given actually supports it — a panel member being pushed to a
noticeably higher load than others, already having several interviews booked that day, or a
proposed window falling outside a stated availability window. Do not invent a concern that isn't
backed by the numbers you were given. If the proposal looks workable, accept it.

Respond with JSON only:
{
  "verdict": "accept" | "counter",
  "objections": [{"panel_id": "...", "panel_name": "...", "reason": "short, specific, factual"}],
  "message": "one sentence a TPO would want to read, whichever verdict"
}"""


async def evaluate_proposal(proposal_summary: dict, company_signals: dict) -> dict:
    prompt = json.dumps({"proposal": proposal_summary, "panel_signals": company_signals["panels"]}, indent=2, default=str)
    result = await generate_json(COMPANY_AGENT_SYSTEM, prompt, caller="negotiation_company_agent")
    if not result or "verdict" not in result:
        return {"verdict": "accept", "objections": [], "message": "Company agent unavailable — proceeding without objection.", "degraded": True}
    result.setdefault("objections", [])
    result.setdefault("message", "")
    return result
