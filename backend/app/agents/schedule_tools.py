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

from sqlalchemy import select, delete
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


# ─── Deterministic scheduling ────────────────────────────────────────────────

# Ceilings, not tuning knobs. Each exists because the loop below can otherwise
# spin: excluding a conflicting resource frees the slot for the next student,
# who may conflict with something else, and extending a window that is already
# too short by hours converges very slowly.
_MAX_ATTEMPTS = 6
_EXTEND_STEP_MIN = 120
_MAX_EXTEND_MIN = 480


async def schedule_round(db: AsyncSession, drive_id: str, round_id: str) -> dict:
    """Propose, validate, re-plan and commit a round's schedule — no model.

    The model never allocated anything here. propose_schedule is first-come
    first-served Python, validate_schedule is a SQL overlap check, and
    commit_schedule writes rows; the model only chose what to retry after a
    failure. That choice is a short, closed set — drop the conflicting
    resource, or widen the window — so it is written out here instead, which
    removes a round trip per attempt and makes the outcome repeatable.

    What survives unchanged is the part that was always the real work:
    validate_schedule checks a proposal against every slot already committed
    across every other drive and round, which the allocator cannot do because
    it only ever sees the students in front of it.

    Commits a clean schedule, or commits nothing and reports why.
    """
    ctx = ScheduleContext(db, drive_id, round_id)

    context = await _exec_get_schedule_context(ctx, {})
    if "error" in context:
        return {"ok": False, "reason": context["error"]}

    # Guard the inputs before allocating. Each of these produces either an empty
    # schedule or a nonsensical one, and all are far clearer caught here than
    # inferred from a result of zero slots.
    round_ = ctx.round
    if not ctx.student_ids:
        return {"ok": False, "reason": "No shortlisted students for this drive. Approve a shortlist first."}
    if not ctx.panels:
        return {"ok": False, "reason": "No panel members are available for this company."}
    if not ctx.rooms:
        mode = round_.mode if round_ else "offline"
        return {"ok": False, "reason": f"No {'virtual' if mode == 'online' else 'physical'} rooms are available."}
    if not round_ or not round_.start_datetime or not round_.end_datetime:
        return {"ok": False, "reason": "This round has no interview window set."}
    if round_.end_datetime <= round_.start_datetime:
        return {"ok": False, "reason": "The round ends before it starts — check the date window."}
    if not round_.slot_duration_min or round_.slot_duration_min <= 0:
        return {"ok": False, "reason": "Slot duration must be greater than zero."}

    # Re-running a round replaces its schedule rather than adding a second one
    # alongside it. Without this a retry doubles every slot, and the validator
    # would not object: it deliberately ignores this round's own rows.
    await db.execute(delete(InterviewSlot).where(InterviewSlot.round_id == round_id))
    await db.commit()

    exclude_panels: set[str] = set()
    exclude_rooms: set[str] = set()
    extend_minutes = 0
    attempts: list[dict] = []

    for _ in range(_MAX_ATTEMPTS):
        proposal = await _exec_propose_schedule(ctx, {
            "exclude_panel_ids": list(exclude_panels),
            "exclude_room_ids": list(exclude_rooms),
            "extend_minutes": extend_minutes,
        })
        if "error" in proposal:
            return {"ok": False, "reason": proposal["error"], "attempts": attempts}

        check = await _exec_validate_schedule(ctx, {})
        attempts.append({
            "proposed": proposal["proposed_count"],
            "unscheduled": proposal["unscheduled_count"],
            "violations": check.get("violation_count", 0),
            "extended_minutes": extend_minutes,
        })

        if check.get("clean"):
            # Nothing conflicts. Widen the window if that would seat more
            # people, otherwise take this schedule.
            if ctx.unscheduled and extend_minutes < _MAX_EXTEND_MIN:
                extend_minutes = min(extend_minutes + _EXTEND_STEP_MIN, _MAX_EXTEND_MIN)
                continue
            break

        # Conflicts are always against another drive's committed slots, so the
        # fix is to stop using the contested resource. Drop every panel and room
        # named in the violations at once rather than one per attempt.
        before = (len(exclude_panels), len(exclude_rooms))
        for v in ctx.last_violations or []:
            if v.get("panel_id"):
                exclude_panels.add(v["panel_id"])
            if v.get("room_id"):
                exclude_rooms.add(v["room_id"])

        if (len(exclude_panels), len(exclude_rooms)) == before:
            # Violations that name no resource cannot be routed around.
            return {
                "ok": False,
                "reason": "The schedule conflicts with interviews on another drive and could not be re-planned.",
                "violations": (ctx.last_violations or [])[:5],
                "attempts": attempts,
            }
        if len(exclude_panels) >= len(ctx.panels) or len(exclude_rooms) >= len(ctx.rooms):
            return {
                "ok": False,
                "reason": "Every panel or room is already booked against another drive in this window. "
                          "Pick a different date, or free a panel up.",
                "attempts": attempts,
            }

    if not ctx.proposed_slots:
        return {"ok": False, "reason": "No slots could be allocated in this window.", "attempts": attempts}
    if ctx.last_violations:
        return {
            "ok": False,
            "reason": f"Still {len(ctx.last_violations)} conflict(s) after {len(attempts)} attempts. "
                      "Widen the window or free a panel up.",
            "violations": ctx.last_violations[:5],
            "attempts": attempts,
        }

    committed = await _exec_commit_schedule(ctx, {})
    if "error" in committed:
        return {"ok": False, "reason": committed["error"], "attempts": attempts}

    return {
        "ok": True,
        "scheduled": committed["committed_count"],
        "unscheduled": committed["unscheduled_count"],
        "total_students": len(ctx.student_ids),
        "extended_minutes": extend_minutes,
        "attempts": attempts,
    }
