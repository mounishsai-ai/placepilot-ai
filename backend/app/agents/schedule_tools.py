"""
Scheduling tool registry — the closed loop described in CLAUDE.md.

allocate_slots() already avoids conflicts *within* the batch of students it is
given, but it has no idea what else is already on the calendar — a panel or
room booked for a different drive's round at an overlapping time sails
straight through. validate_schedule() is the deterministic check that actually
looks across every other interview already committed, and commit_schedule()
refuses to run while validate_schedule's last result still has violations.
The model decides how to fix a violation (drop a specific panel/room from the
rotation, or extend the round's window); Python only ever reports what's
wrong, never how to fix it.
"""
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import (
    InterviewRound, InterviewSlot, PanelMember, Room, MatchScore, PlacementDrive,
    SlotStatus, DriveStatus,
)
from app.agents.scheduler_agent import allocate_slots, detect_all_conflicts
from loguru import logger


class ScheduleContext:
    """Per-run scratch space for the scheduling agent, not sent to the model."""

    def __init__(self, db: AsyncSession, drive_id: str, round_id: str):
        self.db = db
        self.drive_id = drive_id
        self.round_id = round_id
        self.round: InterviewRound | None = None
        self.student_ids: list[str] = []
        self.panels: list[dict] = []
        self.rooms: list[dict] = []
        self.proposed_slots: list[dict] = []
        self.unscheduled: list[dict] = []
        # None means "nothing proposed yet"; [] means "validated clean".
        # commit_schedule refuses to run on anything else, including a schedule
        # that was proposed but never (re-)validated after the last change.
        self.last_violations: list[dict] | None = None
        self.attempts: int = 0


async def _load_round(ctx: ScheduleContext) -> InterviewRound | None:
    if ctx.round is None:
        result = await ctx.db.execute(
            select(InterviewRound)
            .options(selectinload(InterviewRound.drive))
            .where(InterviewRound.id == ctx.round_id)
        )
        ctx.round = result.scalar_one_or_none()
    return ctx.round


SCHEDULE_TOOL_DECLARATIONS = [
    {
        "name": "get_schedule_context",
        "description": "Fetch the round's time window, mode, and duration, the shortlisted student count, and how many panels/rooms are available. Call this first.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "propose_schedule",
        "description": (
            "Generate a candidate interview schedule for every shortlisted student in this round. "
            "Optionally exclude specific panel or room IDs (e.g. ones a previous validate_schedule call "
            "flagged as double-booked elsewhere), or extend the round's end time to fit more students."
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
            "every other interview slot already committed, across every drive and round — not just "
            "this one. Always call this after propose_schedule, before committing."
        ),
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "commit_schedule",
        "description": "Write the proposed schedule as real interview slots. Only call this once validate_schedule has reported zero violations for the current proposal.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "ask_human",
        "description": "Pause and ask the TPO a question — use this if a clean schedule can't be reached after a few attempts, or some students have no available slot.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "question": {"type": "STRING", "description": "The question to ask the TPO."},
                "options": {
                    "type": "ARRAY", "items": {"type": "STRING"},
                    "description": "Suggested answer options, if applicable.",
                },
            },
            "required": ["question"],
        },
    },
]


async def _exec_get_schedule_context(ctx: ScheduleContext, args: dict) -> dict:
    round_ = await _load_round(ctx)
    if not round_:
        return {"error": f"round {ctx.round_id} not found"}

    matches_result = await ctx.db.execute(
        select(MatchScore.student_id).where(
            MatchScore.drive_id == ctx.drive_id, MatchScore.shortlisted == True,
        )
    )
    ctx.student_ids = [row[0] for row in matches_result.all()]

    drive_result = await ctx.db.execute(select(PlacementDrive).where(PlacementDrive.id == ctx.drive_id))
    drive = drive_result.scalar_one_or_none()
    company_id = drive.company_id if drive else None

    panels_query = select(PanelMember).where(PanelMember.company_id == company_id) if company_id else select(PanelMember)
    panels_result = await ctx.db.execute(panels_query)
    ctx.panels = [{"id": p.id, "name": p.name} for p in panels_result.scalars().all()]

    rooms_result = await ctx.db.execute(select(Room).where(Room.is_virtual == (round_.mode == "online")))
    ctx.rooms = [{"id": r.id, "name": r.name} for r in rooms_result.scalars().all()]

    return {
        "round_no": round_.round_no,
        "round_type": round_.round_type.value if hasattr(round_.round_type, "value") else round_.round_type,
        "start_datetime": round_.start_datetime.isoformat() if round_.start_datetime else None,
        "end_datetime": round_.end_datetime.isoformat() if round_.end_datetime else None,
        "mode": round_.mode,
        "slot_duration_min": round_.slot_duration_min,
        "shortlisted_count": len(ctx.student_ids),
        "panel_count": len(ctx.panels),
        "room_count": len(ctx.rooms),
    }


async def _exec_propose_schedule(ctx: ScheduleContext, args: dict) -> dict:
    round_ = await _load_round(ctx)
    if not round_:
        return {"error": f"round {ctx.round_id} not found"}
    if not ctx.student_ids:
        return {"error": "call get_schedule_context first — no shortlisted students loaded"}

    exclude_panels = set(args.get("exclude_panel_ids") or [])
    exclude_rooms = set(args.get("exclude_room_ids") or [])
    extend_minutes = int(args.get("extend_minutes") or 0)

    panels = [p for p in ctx.panels if p["id"] not in exclude_panels]
    rooms = [r for r in ctx.rooms if r["id"] not in exclude_rooms]
    if not panels:
        return {"error": "excluding those panels leaves none available — pick different ones, or extend time instead"}

    end_dt = round_.end_datetime + timedelta(minutes=extend_minutes) if extend_minutes else round_.end_datetime
    round_info = {
        "id": round_.id,
        "start_datetime": round_.start_datetime,
        "end_datetime": end_dt,
        "slot_duration_min": round_.slot_duration_min,
        "mode": round_.mode,
    }
    allocated, conflicts = allocate_slots(ctx.student_ids, round_info, panels, rooms, [])
    ctx.proposed_slots = allocated
    ctx.unscheduled = conflicts
    ctx.attempts += 1
    ctx.last_violations = None  # must call validate_schedule again before commit

    return {
        "attempt": ctx.attempts,
        "proposed_count": len(allocated),
        "unscheduled_count": len(conflicts),
        "panels_used": len(panels),
        "rooms_used": len(rooms),
        "end_time_extended_minutes": extend_minutes,
    }


async def _exec_validate_schedule(ctx: ScheduleContext, args: dict) -> dict:
    if not ctx.proposed_slots:
        return {"error": "call propose_schedule first — nothing to validate"}

    # Internal conflicts — defense in depth. allocate_slots already avoids
    # these within a single proposal, so this should always come back empty;
    # re-checking costs nothing and catches a bug in that assumption.
    internal = detect_all_conflicts([
        {**s, "id": f"proposed:{i}"} for i, s in enumerate(ctx.proposed_slots)
    ])

    # Cross-round / cross-drive conflicts — the check allocate_slots cannot do,
    # because it only ever sees the students being scheduled in THIS call.
    window_start = min(s["slot_start"] for s in ctx.proposed_slots)
    window_end = max(s["slot_end"] for s in ctx.proposed_slots)

    existing_result = await ctx.db.execute(
        select(InterviewSlot).where(
            InterviewSlot.round_id != ctx.round_id,
            InterviewSlot.slot_start < window_end,
            InterviewSlot.slot_end > window_start,
        )
    )
    existing = existing_result.scalars().all()

    violations: list[dict] = []
    for p in ctx.proposed_slots:
        for e in existing:
            overlap = not (p["slot_end"] <= e.slot_start or p["slot_start"] >= e.slot_end)
            if not overlap:
                continue
            if p.get("panel_id") and p["panel_id"] == e.panel_id:
                violations.append({
                    "type": "panel_conflict", "panel_id": p["panel_id"],
                    "student_id": p["student_id"], "conflicting_slot_id": e.id,
                    "at": p["slot_start"].isoformat(),
                })
            if p.get("room_id") and p["room_id"] == e.room_id:
                violations.append({
                    "type": "room_conflict", "room_id": p["room_id"],
                    "student_id": p["student_id"], "conflicting_slot_id": e.id,
                    "at": p["slot_start"].isoformat(),
                })
    for c in internal:
        violations.append({**c, "note": "conflict within this proposal itself"})

    ctx.last_violations = violations
    return {
        "clean": len(violations) == 0,
        "violation_count": len(violations),
        "violations": violations[:10],
        "unscheduled_count": len(ctx.unscheduled),
    }


async def _exec_commit_schedule(ctx: ScheduleContext, args: dict) -> dict:
    if not ctx.proposed_slots:
        return {"error": "call propose_schedule (and validate_schedule) first — nothing to commit"}
    if ctx.last_violations is None:
        return {"error": "call validate_schedule first — this proposal has not been checked"}
    if ctx.last_violations:
        return {
            "error": f"{len(ctx.last_violations)} unresolved violation(s) — fix them and call "
                     "validate_schedule again, do not commit a conflicted schedule",
        }

    round_ = await _load_round(ctx)
    for slot_data in ctx.proposed_slots:
        ctx.db.add(InterviewSlot(
            round_id=ctx.round_id,
            student_id=slot_data["student_id"],
            panel_id=slot_data.get("panel_id"),
            room_id=slot_data.get("room_id"),
            slot_start=slot_data["slot_start"],
            slot_end=slot_data["slot_end"],
            status=SlotStatus.SCHEDULED,
        ))
    if round_ and round_.drive:
        round_.drive.status = DriveStatus.SCHEDULE_PENDING
    await ctx.db.commit()

    logger.info(f"[{ctx.drive_id}] committed {len(ctx.proposed_slots)} slots for round {ctx.round_id}")
    return {
        "committed_count": len(ctx.proposed_slots),
        "unscheduled_count": len(ctx.unscheduled),
        "round_id": ctx.round_id,
    }


async def _exec_ask_human(ctx: ScheduleContext, args: dict) -> dict:
    # Intercepted by the orchestrator loop before dispatch — exists only so
    # ask_human appears in SCHEDULE_TOOL_EXECUTORS for validation.
    raise RuntimeError("ask_human must be intercepted by the orchestrator loop")


SCHEDULE_TOOL_EXECUTORS = {
    "get_schedule_context": _exec_get_schedule_context,
    "propose_schedule": _exec_propose_schedule,
    "validate_schedule": _exec_validate_schedule,
    "commit_schedule": _exec_commit_schedule,
    "ask_human": _exec_ask_human,
}
