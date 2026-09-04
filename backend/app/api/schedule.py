"""
Schedule API — interview rounds, slots, panel, and room management.
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db, async_session_factory
from app.models import (
    InterviewRound, InterviewSlot, Room, PanelMember,
    PanelAvailability, PlacementDrive, RoundType, UserRole,
    MatchScore, User, Student, SessionNote, Company,
    SlotStatus, DriveStatus, AgentRun, AgentRunStatus, AgentTrace,
)
from app.api.auth import get_current_user, require_role
from app.agents.scheduler_agent import detect_all_conflicts
from app.agents.panel_agent import generate_prep_brief, structure_debrief, polish_session_note
from app.agents import orchestrator
from loguru import logger

router = APIRouter()


def _as_naive(dt: datetime) -> datetime:
    """Postgres stores TIMESTAMP WITHOUT TIME ZONE. asyncpg crashes if we pass
    a timezone-aware value (e.g. the trailing Z from browser Date.toISOString()).
    Strip tz so the clock time is preserved."""
    if dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt


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
        start_datetime=_as_naive(body.start_datetime),
        end_datetime=_as_naive(body.end_datetime),
        mode=body.mode,
        venue=body.venue,
        meet_link=body.meet_link,
        slot_duration_min=body.slot_duration_min,
    )
    db.add(round_)
    await db.commit()
    await db.refresh(round_)
    return {"id": round_.id, "round_no": round_.round_no}


async def _run_schedule_agent_bg(run_id: str, drive_id: str):
    """Runs in background with its OWN DB session (request session will be closed)."""
    async with async_session_factory() as db:
        try:
            await orchestrator.execute_run(db, run_id, drive_id)
        except Exception as e:
            logger.error(f"Schedule agent run {run_id} failed for drive {drive_id}: {e}")


@router.post("/rounds/{round_id}/run-agent")
async def run_schedule_agent(
    round_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Start the scheduling agent for this round: it proposes a schedule,
    validates it against every other interview already on the calendar, and
    re-plans until clean (or asks the TPO) before committing — see CLAUDE.md.
    Runs in the background; progress shows up in the same live trace / agent
    dock as the shortlist agent, keyed off the same drive_id.

    Replaces the old auto-schedule endpoint, which wrote slots straight from
    allocate_slots() with no check against other rounds' bookings at all."""
    round_result = await db.execute(select(InterviewRound).where(InterviewRound.id == round_id))
    round_ = round_result.scalar_one_or_none()
    if not round_:
        raise HTTPException(status_code=404, detail="Round not found")

    matches_result = await db.execute(
        select(MatchScore.student_id)
        .where(MatchScore.drive_id == round_.drive_id, MatchScore.shortlisted == True)
    )
    if not matches_result.first():
        raise HTTPException(
            status_code=400,
            detail="No shortlisted students for this drive. Approve a shortlist first, then schedule.",
        )

    run = await orchestrator.create_run(db, round_.drive_id, kind="schedule", round_id=round_id)
    background_tasks.add_task(_run_schedule_agent_bg, run.id, round_.drive_id)
    return {
        "message": "Scheduling agent started",
        "drive_id": round_.drive_id,
        "round_id": round_id,
        "run_id": run.id,
    }


@router.get("/drives/{drive_id}/rounds")
async def list_rounds_for_drive(
    drive_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    """List interview rounds for a drive — was missing entirely; the TPO schedule
    page had no way to discover rounds that already existed for a drive."""
    result = await db.execute(
        select(InterviewRound)
        .where(InterviewRound.drive_id == drive_id)
        .order_by(InterviewRound.round_no)
    )
    rounds = result.scalars().all()
    return [
        {
            "id": r.id,
            "round_no": r.round_no,
            "round_type": r.round_type.value,
            "start_datetime": r.start_datetime.isoformat() + "Z" if r.start_datetime else None,
            "end_datetime": r.end_datetime.isoformat() + "Z" if r.end_datetime else None,
            "mode": r.mode,
            "venue": r.venue,
        }
        for r in rounds
    ]


@router.get("/slots")
async def list_all_slots(
    drive_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    """Flat overview of interview slots across drives — backs the TPO schedule
    page, which previously had no real data source at all (DEMO_SLOTS)."""
    query = (
        select(InterviewSlot)
        .options(
            selectinload(InterviewSlot.student),
            selectinload(InterviewSlot.panel_member),
            selectinload(InterviewSlot.room),
            selectinload(InterviewSlot.round).selectinload(InterviewRound.drive).selectinload(PlacementDrive.company),
        )
        .order_by(InterviewSlot.slot_start.desc())
        .limit(200)
    )
    if drive_id:
        query = query.join(InterviewRound).where(InterviewRound.drive_id == drive_id)
    result = await db.execute(query)
    slots = result.scalars().all()
    return [
        {
            "id": s.id,
            "drive_id": s.round.drive_id if s.round else None,
            "drive_title": (
                f"{s.round.drive.title} — {s.round.drive.company.name if s.round.drive.company else 'Unknown'}"
                if s.round and s.round.drive else None
            ),
            "student_name": s.student.name if s.student else None,
            "student_roll": s.student.roll_no if s.student else None,
            "round_type": s.round.round_type.value if s.round else None,
            "slot_start": s.slot_start.isoformat() + "Z",
            "slot_end": s.slot_end.isoformat() + "Z",
            "status": s.status.value,
            "result": s.result,
            "panel": s.panel_member.name if s.panel_member else None,
            "venue": s.room.name if s.room else (s.round.venue if s.round else None),
        }
        for s in slots
    ]


@router.get("/slots/mine")
async def get_my_slots(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PANEL)),
):
    """A panel member's own assigned slots. Previously the panel page had no
    per-panel query at all and always fell back to fabricated demo data."""
    panel_result = await db.execute(
        select(PanelMember).where(PanelMember.user_id == current_user.id)
    )
    panel = panel_result.scalar_one_or_none()
    if not panel:
        raise HTTPException(
            status_code=404,
            detail="No panel member record linked to your account. Contact the TPO.",
        )

    result = await db.execute(
        select(InterviewSlot)
        .options(
            selectinload(InterviewSlot.student),
            selectinload(InterviewSlot.room),
            selectinload(InterviewSlot.round),
        )
        .where(InterviewSlot.panel_id == panel.id)
        .order_by(InterviewSlot.slot_start)
    )
    slots = result.scalars().all()

    # Enrich with each student's match score for the relevant drive (0-2 extra
    # queries total, not per-slot).
    pairs = {(s.round.drive_id, s.student_id) for s in slots if s.round}
    match_map: dict[tuple[str, str], float] = {}
    if pairs:
        drive_ids = list({p[0] for p in pairs})
        student_ids = list({p[1] for p in pairs})
        ms_result = await db.execute(
            select(MatchScore).where(
                MatchScore.drive_id.in_(drive_ids),
                MatchScore.student_id.in_(student_ids),
            )
        )
        for ms in ms_result.scalars().all():
            match_map[(ms.drive_id, ms.student_id)] = ms.score

    output = []
    for s in slots:
        score = None
        if s.round:
            raw = match_map.get((s.round.drive_id, s.student_id))
            if raw is not None:
                score = round(raw * 100, 1) if raw <= 1 else round(raw, 1)
        output.append({
            "id": s.id,
            "student_name": s.student.name if s.student else None,
            "student_roll": s.student.roll_no if s.student else None,
            "branch": s.student.branch if s.student else None,
            "cgpa": s.student.cgpa if s.student else None,
            "match_score": score,
            "slot_start": s.slot_start.isoformat() + "Z",
            "slot_end": s.slot_end.isoformat() + "Z",
            "room": s.room.name if s.room else None,
            "round_type": s.round.round_type.value if s.round else None,
            "status": s.status.value,
            "result": s.result,
        })
    return output


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
            "slot_start": s.slot_start.isoformat() + "Z",
            "slot_end": s.slot_end.isoformat() + "Z",
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
    current_user: User = Depends(require_role(UserRole.PANEL, UserRole.TPO)),
):
    result = await db.execute(select(InterviewSlot).where(InterviewSlot.id == slot_id))
    slot = result.scalar_one_or_none()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")

    if current_user.role == UserRole.PANEL:
        panel_result = await db.execute(
            select(PanelMember).where(PanelMember.user_id == current_user.id)
        )
        panel = panel_result.scalar_one_or_none()
        if not panel or slot.panel_id != panel.id:
            raise HTTPException(status_code=403, detail="You can only record results for your own interview slots")

    slot.result = body.result
    slot.feedback = body.feedback
    slot.status = "completed"
    await db.commit()
    return {"message": "Result updated"}


# ─── Panel agent ─────────────────────────────────────────────────────────────

async def _own_slot_or_403(slot_id: str, current_user: User, db: AsyncSession) -> InterviewSlot:
    """Load a slot, refusing it unless this panel member is the one assigned.

    A briefing contains a named candidate's profile and a debrief writes a
    hiring verdict, so neither may be reachable by slot id alone. TPOs are let
    through — they own the schedule.
    """
    result = await db.execute(
        select(InterviewSlot)
        .options(
            selectinload(InterviewSlot.student).selectinload(Student.skills),
            selectinload(InterviewSlot.round).selectinload(InterviewRound.drive),
        )
        .where(InterviewSlot.id == slot_id)
    )
    slot = result.scalar_one_or_none()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")

    if current_user.role == UserRole.PANEL:
        panel_result = await db.execute(
            select(PanelMember).where(PanelMember.user_id == current_user.id)
        )
        panel = panel_result.scalar_one_or_none()
        if not panel or slot.panel_id != panel.id:
            raise HTTPException(
                status_code=403, detail="That interview is not on your schedule"
            )
    return slot


@router.post("/slots/{slot_id}/prep")
async def prep_brief(
    slot_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PANEL, UserRole.TPO)),
):
    """What the panel should know about the candidate they are about to meet.

    Generated on demand rather than precomputed for every slot: most scheduled
    interviews are never actually opened, and a brief written now reflects the
    profile as it stands now.
    """
    slot = await _own_slot_or_403(slot_id, current_user, db)
    s = slot.student
    if not s:
        raise HTTPException(status_code=404, detail="No candidate on that slot")

    drive = slot.round.drive if slot.round else None
    jd = drive.jd_parsed if drive else None

    profile = {
        "name": s.name,
        "branch": s.branch,
        "cgpa": s.cgpa,
        "batch": s.batch,
        "active_backlogs": s.backlogs_active,
        "readiness_score": s.placement_readiness_score,
        "summary": s.skills_summary,
        "skills": [
            {"skill": k.skill, "proficiency": k.proficiency, "years": k.years_experience}
            for k in (s.skills or [])
        ],
    }
    brief = await generate_prep_brief(
        profile, jd, (jd or {}).get("role") or (drive.title if drive else "this role")
    )
    return {
        "slot_id": slot.id,
        "candidate": {"name": s.name, "roll_no": s.roll_no, "branch": s.branch, "cgpa": s.cgpa},
        "role": (jd or {}).get("role") or (drive.title if drive else None),
        "brief": brief,
    }


async def _my_panel(current_user: User, db: AsyncSession) -> PanelMember:
    result = await db.execute(select(PanelMember).where(PanelMember.user_id == current_user.id))
    panel = result.scalar_one_or_none()
    if not panel:
        raise HTTPException(
            status_code=404,
            detail="No panel member record linked to your account. Contact the TPO.",
        )
    return panel


class SessionNoteRequest(BaseModel):
    notes: str


@router.post("/session-notes")
async def add_session_note(
    body: SessionNoteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PANEL)),
):
    """Notes on the day as a whole -- not tied to any one candidate's slot,
    so they never touch InterviewSlot.feedback or a hiring result. Often
    dictated by voice between interviews, so this runs the raw text through
    the same structuring model as debrief before saving -- just prose
    cleanup here, no scoring or recommendation, since there's no one
    candidate for either to attach to."""
    raw = (body.notes or "").strip()
    if len(raw) < 5:
        raise HTTPException(status_code=400, detail="Write a bit more first")
    polished = await polish_session_note(raw)
    panel = await _my_panel(current_user, db)
    note = SessionNote(panel_id=panel.id, notes=polished)
    db.add(note)
    await db.commit()
    return {"message": "Saved", "notes": polished}


@router.get("/session-notes")
async def list_session_notes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PANEL)),
):
    panel = await _my_panel(current_user, db)
    result = await db.execute(
        select(SessionNote)
        .where(SessionNote.panel_id == panel.id)
        .order_by(SessionNote.created_at.desc())
        .limit(10)
    )
    return [
        {"id": n.id, "notes": n.notes, "created_at": n.created_at.isoformat() + "Z"}
        for n in result.scalars().all()
    ]


@router.get("/session-notes/all")
async def list_all_session_notes(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Every panel member's session-level notes, across every interview day --
    the TPO side of the same feature panel members write into from their own
    schedule page."""
    result = await db.execute(
        select(SessionNote)
        .options(selectinload(SessionNote.panel))
        .order_by(SessionNote.created_at.desc())
        .limit(50)
    )
    return [
        {
            "id": n.id,
            "panel_name": n.panel.name if n.panel else None,
            "notes": n.notes,
            "created_at": n.created_at.isoformat() + "Z",
        }
        for n in result.scalars().all()
    ]


class DebriefRequest(BaseModel):
    notes: str


@router.post("/slots/{slot_id}/debrief")
async def debrief(
    slot_id: str,
    body: DebriefRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PANEL, UserRole.TPO)),
):
    """Rough post-interview notes → a structured scorecard.

    Deliberately does NOT write the result. The panel member reads the
    scorecard, and filing it stays a separate, explicit act through
    PATCH /slots/{id}/result — an agent should not record a hiring decision
    because someone typed a paragraph.
    """
    notes = (body.notes or "").strip()
    if len(notes) < 15:
        raise HTTPException(
            status_code=400, detail="Write a little more before the agent can structure it"
        )

    slot = await _own_slot_or_403(slot_id, current_user, db)
    drive = slot.round.drive if slot.round else None
    jd = drive.jd_parsed if drive else None
    card = await structure_debrief(
        notes, (jd or {}).get("role") or (drive.title if drive else "this role")
    )
    return {"slot_id": slot.id, "scorecard": card}


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
