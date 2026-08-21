"""
Schedule API — interview rounds, slots, panel, and room management.
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import (
    InterviewRound, InterviewSlot, Room, PanelMember,
    PanelAvailability, PlacementDrive, RoundType, UserRole
)
from app.api.auth import get_current_user, require_role
from app.agents.scheduler_agent import allocate_slots, detect_all_conflicts

router = APIRouter()


class CreateRoundRequest(BaseModel):
    drive_id: str
    round_no: int
    round_type: RoundType
    start_datetime: datetime
    end_datetime: datetime
    mode: str = "offline"
    venue: Optional[str] = None
    meet_link: Optional[str] = None
    slot_duration_min: int = 30


class SlotResultRequest(BaseModel):
    result: str   # selected / rejected / on_hold
    feedback: Optional[str] = None


@router.post("/rounds", status_code=status.HTTP_201_CREATED)
async def create_round(
    body: CreateRoundRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    round_ = InterviewRound(
        drive_id=body.drive_id,
        round_no=body.round_no,
        round_type=body.round_type,
        start_datetime=body.start_datetime,
        end_datetime=body.end_datetime,
        mode=body.mode,
        venue=body.venue,
        meet_link=body.meet_link,
        slot_duration_min=body.slot_duration_min,
    )
    db.add(round_)
    await db.commit()
    await db.refresh(round_)
    return {"id": round_.id, "round_no": round_.round_no}


@router.post("/rounds/{round_id}/auto-schedule")
async def auto_schedule_round(
    round_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Trigger the scheduler agent for a specific round."""
    round_result = await db.execute(
        select(InterviewRound)
        .options(selectinload(InterviewRound.drive))
        .where(InterviewRound.id == round_id)
    )
    round_ = round_result.scalar_one_or_none()
    if not round_:
        raise HTTPException(status_code=404, detail="Round not found")

    # Get shortlisted students for this drive
    from app.models import MatchScore
    matches_result = await db.execute(
        select(MatchScore.student_id)
        .where(MatchScore.drive_id == round_.drive_id, MatchScore.shortlisted == True)
    )
    student_ids = [row[0] for row in matches_result.all()]

    # Get panels and rooms
    panels_result = await db.execute(select(PanelMember))
    rooms_result = await db.execute(select(Room).where(Room.is_virtual == (round_.mode == "online")))
    panels = [{"id": p.id, "name": p.name} for p in panels_result.scalars().all()]
    rooms = [{"id": r.id, "name": r.name} for r in rooms_result.scalars().all()]

    round_info = {
        "id": round_.id,
        "round_no": round_.round_no,
        "round_type": round_.round_type.value,
        "start_datetime": round_.start_datetime,
        "end_datetime": round_.end_datetime,
        "slot_duration_min": round_.slot_duration_min,
        "mode": round_.mode,
    }

    allocated, conflicts = allocate_slots(student_ids, round_info, panels, rooms, [])

    # Persist slots
    for slot_data in allocated:
        slot = InterviewSlot(
            round_id=round_id,
            student_id=slot_data["student_id"],
            panel_id=slot_data.get("panel_id"),
            room_id=slot_data.get("room_id"),
            slot_start=slot_data["slot_start"],
            slot_end=slot_data["slot_end"],
            status="scheduled",
        )
        db.add(slot)

    await db.commit()
    return {
        "scheduled": len(allocated),
        "conflicts": conflicts,
        "round_id": round_id,
    }


@router.get("/rounds/{round_id}/slots")
async def get_round_slots(
    round_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    result = await db.execute(
        select(InterviewSlot)
        .options(
            selectinload(InterviewSlot.student),
            selectinload(InterviewSlot.panel_member),
            selectinload(InterviewSlot.room),
        )
        .where(InterviewSlot.round_id == round_id)
        .order_by(InterviewSlot.slot_start)
    )
    slots = result.scalars().all()
    return [
        {
            "id": s.id,
            "student_name": s.student.name if s.student else None,
            "student_roll": s.student.roll_no if s.student else None,
            "slot_start": s.slot_start.isoformat(),
            "slot_end": s.slot_end.isoformat(),
            "status": s.status.value,
            "result": s.result,
            "panel": s.panel_member.name if s.panel_member else None,
            "room": s.room.name if s.room else None,
        }
        for s in slots
    ]


@router.patch("/slots/{slot_id}/result")
async def update_slot_result(
    slot_id: str,
    body: SlotResultRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.PANEL, UserRole.TPO)),
):
    result = await db.execute(select(InterviewSlot).where(InterviewSlot.id == slot_id))
    slot = result.scalar_one_or_none()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    slot.result = body.result
    slot.feedback = body.feedback
    slot.status = "completed"
    await db.commit()
    return {"message": "Result updated"}


@router.get("/conflicts/{round_id}")
async def check_conflicts(
    round_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    result = await db.execute(
        select(InterviewSlot).where(InterviewSlot.round_id == round_id)
    )
    slots = [
        {
            "id": s.id, "panel_id": s.panel_id, "room_id": s.room_id,
            "slot_start": s.slot_start, "slot_end": s.slot_end,
        }
        for s in result.scalars().all()
    ]
    conflicts = detect_all_conflicts(slots)
    return {"conflicts": conflicts, "conflict_count": len(conflicts)}
