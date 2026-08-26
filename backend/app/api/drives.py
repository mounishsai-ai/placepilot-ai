"""
Drives API — full lifecycle from JD upload through completion.
"""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.database import get_db, async_session_factory
from app.models import (
    PlacementDrive, DriveStatus, Company, EligibilityRule,
    EligibilityResult, MatchScore, Student, AgentEvent, UserRole, User,
    AgentRun, AgentRunStatus, AgentTrace,
)
from app.api.auth import get_current_user, require_role
from app.api.websocket import emit_agent_event
from app.agents.supervisor import run_placement_pipeline, resume_pipeline
from app.agents import orchestrator
from app.config import settings
from loguru import logger
import aiofiles
import os

router = APIRouter()


# ─── Schemas ─────────────────────────────────────────────────────────────────

class CreateDriveRequest(BaseModel):
    company_id: Optional[str] = None   # auto-resolved from JWT if COMPANY role
    title: str
    jd_text: Optional[str] = None
    deadline: Optional[str] = None


class ShortlistOverrideRequest(BaseModel):
    approved: bool
    shortlisted_student_ids: Optional[list[str]] = None
    notes: Optional[str] = None


class ScheduleApprovalRequest(BaseModel):
    approved: bool
    notes: Optional[str] = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_drive_or_404(drive_id: str, db: AsyncSession) -> PlacementDrive:
    result = await db.execute(
        select(PlacementDrive)
        .options(selectinload(PlacementDrive.company))
        .where(PlacementDrive.id == drive_id)
    )
    drive = result.scalar_one_or_none()
    if not drive:
        raise HTTPException(status_code=404, detail="Drive not found")
    return drive


async def _load_all_students(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(Student).options(selectinload(Student.skills))
    )
    students = result.scalars().all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "roll_no": s.roll_no,
            "email": s.email,
            "phone": s.phone,
            "branch": s.branch,
            "batch": s.batch,
            "cgpa": s.cgpa,
            "backlogs_active": s.backlogs_active,
            "backlogs_historical": s.backlogs_historical,
            "attendance_pct": s.attendance_pct,
            "skills_summary": s.skills_summary,
            "skills": [{"skill": sk.skill, "proficiency": sk.proficiency} for sk in s.skills],
        }
        for s in students
    ]


async def _load_rules(drive_id: str, db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(EligibilityRule).where(EligibilityRule.drive_id == drive_id)
    )
    rules = result.scalars().all()
    return [
        {"rule_type": r.rule_type, "rule_value": r.rule_value, "rule_json": r.rule_json}
        for r in rules
    ]


# ─── Background Pipeline ──────────────────────────────────────────────────────

async def _run_pipeline_bg(drive_id: str):
    """Runs in background with its OWN DB session (request session will be closed)."""
    from sqlalchemy import select
    async with async_session_factory() as db:
        try:
            drive = await _get_drive_or_404(drive_id, db)
            students = await _load_all_students(db)
            rules = await _load_rules(drive_id, db)

            # Emit start event
            db.add(AgentEvent(
                drive_id=drive_id, event_type="pipeline_started",
                agent_name="supervisor", payload={"drive": drive.title}
            ))
            await db.commit()
            await emit_agent_event(
                "pipeline_started", {"drive": drive.title},
                drive_id=drive_id, agent_name="supervisor",
            )

            state = await run_placement_pipeline(drive_id, drive.jd_text, students, rules)

            # Persist eligibility results
            for r in state.get("eligibility_results", []):
                er = EligibilityResult(
                    drive_id=drive_id,
                    student_id=r["student_id"],
                    eligible=r["eligible"],
                    is_edge_case=r.get("is_edge_case", False),
                    reason=r.get("reasons", []),
                )
                db.add(er)

            # Persist match scores
            for m in state.get("match_results", []):
                ms = MatchScore(
                    drive_id=drive_id,
                    student_id=m["student_id"],
                    score=m["score"],
                    rank=m["rank"],
                    explanation=m.get("explanation"),
                    shortlisted=m["student_id"] in state.get("shortlisted_student_ids", []),
                )
                db.add(ms)

            # Persist agent events
            for evt in state.get("agent_events", []):
                ae = AgentEvent(
                    drive_id=drive_id,
                    event_type=evt["event_type"],
                    agent_name=evt.get("agent_name"),
                    payload=evt.get("payload"),
                )
                db.add(ae)

            drive.status = DriveStatus.SHORTLIST_PENDING
            drive.jd_parsed = state.get("jd_parsed")
            await db.commit()
            logger.info(f"Pipeline complete for drive {drive_id}")

        except Exception as e:
            logger.error(f"Pipeline failed for drive {drive_id}: {e}")
            # Persist the error as an agent event so the dashboard shows it
            try:
                db.add(AgentEvent(
                    drive_id=drive_id, event_type="pipeline_error",
                    agent_name="supervisor", payload={"error": str(e)[:500]}
                ))
                await db.commit()
                await emit_agent_event(
                    "pipeline_error", {"error": str(e)[:500]},
                    drive_id=drive_id, agent_name="supervisor",
                )
            except Exception:
                pass


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_drive(
    body: CreateDriveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    company_id = body.company_id

    # Auto-resolve company from the logged-in user if not explicitly provided
    if not company_id:
        company_res = await db.execute(
            select(Company).where(Company.user_id == current_user.id)
        )
        company = company_res.scalar_one_or_none()
        if company:
            company_id = company.id
        else:
            # Find any company as fallback (demo mode)
            any_co = await db.execute(select(Company).limit(1))
            co = any_co.scalar_one_or_none()
            company_id = co.id if co else None

    drive = PlacementDrive(
        company_id=company_id,
        title=body.title,
        jd_text=body.jd_text,
    )
    db.add(drive)
    await db.commit()
    await db.refresh(drive)
    return {"id": drive.id, "status": drive.status.value}


@router.post("/{drive_id}/upload-jd")
async def upload_jd_file(
    drive_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    """Upload a PDF or DOCX job description."""
    drive = await _get_drive_or_404(drive_id, db)
    ext = os.path.splitext(file.filename)[-1].lower()

    filepath = os.path.join(settings.UPLOAD_DIR, f"jd_{drive_id}{ext}")
    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    # Extract text
    text = ""
    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(filepath)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    elif ext in [".docx", ".doc"]:
        from docx import Document
        doc = Document(filepath)
        text = "\n".join(p.text for p in doc.paragraphs)
    else:
        text = content.decode("utf-8", errors="ignore")

    drive.jd_text = text
    await db.commit()
    return {"drive_id": drive_id, "extracted_chars": len(text)}


@router.post("/{drive_id}/run-pipeline")
async def run_pipeline(
    drive_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    """Trigger the full AI pipeline for a drive (runs in background)."""
    drive = await _get_drive_or_404(drive_id, db)
    if not drive.jd_text:
        raise HTTPException(status_code=400, detail="JD text is required before running pipeline")

    background_tasks.add_task(_run_pipeline_bg, drive_id)  # fresh session inside
    drive.status = DriveStatus.JD_ANALYZED
    await db.commit()
    return {"message": "Pipeline started", "drive_id": drive_id}


# ─── Agentic orchestrator (new, parallel path — does not touch run-pipeline) ──
# Day-1 vertical slice: the model decides which tool to call and when, instead
# of a hardcoded graph. Kept behind separate endpoints so /run-pipeline above
# keeps working untouched while this gets proven out end-to-end.

async def _run_agent_bg(run_id: str, drive_id: str):
    """Runs in background with its OWN DB session (request session will be closed)."""
    async with async_session_factory() as db:
        try:
            await orchestrator.execute_run(db, run_id, drive_id)
        except Exception as e:
            logger.error(f"Agent run {run_id} failed for drive {drive_id}: {e}")


@router.post("/{drive_id}/run-agent")
async def run_agent(
    drive_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    """Start an agentic orchestrator run for a drive (runs in background)."""
    drive = await _get_drive_or_404(drive_id, db)
    if not drive.jd_text:
        raise HTTPException(status_code=400, detail="JD text is required before running the agent")

    run = await orchestrator.create_run(db, drive_id)
    background_tasks.add_task(_run_agent_bg, run.id, drive_id)
    return {"message": "Agent run started", "drive_id": drive_id, "run_id": run.id}


@router.get("/{drive_id}/agent-runs")
async def list_agent_runs(
    drive_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    """List agent runs for a drive, newest first — for finding a run_id to inspect/answer."""
    result = await db.execute(
        select(AgentRun).where(AgentRun.drive_id == drive_id).order_by(AgentRun.created_at.desc())
    )
    runs = result.scalars().all()
    return [
        {"id": r.id, "status": r.status.value, "pending_question": r.pending_question,
         "created_at": r.created_at.isoformat()}
        for r in runs
    ]


class AnswerRequest(BaseModel):
    answer: str


@router.post("/agent-runs/{run_id}/answer")
async def answer_agent_run(
    run_id: str,
    body: AnswerRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    """Answer a paused agent run's ask_human question and resume it."""
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="agent run not found")
    if run.status != AgentRunStatus.PAUSED:
        raise HTTPException(status_code=400, detail=f"agent run is {run.status.value}, not paused")

    async def _resume_bg():
        async with async_session_factory() as bg_db:
            try:
                await orchestrator.resume_run(bg_db, run_id, body.answer)
            except Exception as e:
                logger.error(f"Agent run resume failed for {run_id}: {e}")

    background_tasks.add_task(_resume_bg)
    return {"message": "Answer received, resuming", "run_id": run_id}


@router.get("/agent-runs/{run_id}")
async def get_agent_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    """Inspect an agent run's status and full trace — for testing/debugging."""
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="agent run not found")

    trace_result = await db.execute(
        select(AgentTrace).where(AgentTrace.run_id == run_id).order_by(AgentTrace.seq)
    )
    trace = trace_result.scalars().all()

    return {
        "id": run.id,
        "drive_id": run.drive_id,
        "status": run.status.value,
        "pending_question": run.pending_question,
        "created_at": run.created_at.isoformat(),
        "updated_at": run.updated_at.isoformat(),
        "trace": [
            {
                "seq": t.seq, "agent": t.agent, "kind": t.kind,
                "summary": t.summary, "detail": t.detail,
                "cost_ms": t.cost_ms, "created_at": t.created_at.isoformat(),
            }
            for t in trace
        ],
    }


@router.get("/{drive_id}")
async def get_drive(
    drive_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    drive = await _get_drive_or_404(drive_id, db)
    return {
        "id": drive.id,
        "title": drive.title,
        "company": drive.company.name if drive.company else None,
        "status": drive.status.value,
        "jd_parsed": drive.jd_parsed,
        "package_lpa": drive.package_lpa,
        "deadline": drive.deadline.isoformat() if drive.deadline else None,
        "created_at": drive.created_at.isoformat(),
    }


@router.get("/")
async def list_drives(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    query = select(PlacementDrive).options(selectinload(PlacementDrive.company))
    if status:
        query = query.where(PlacementDrive.status == status)
    result = await db.execute(query.order_by(PlacementDrive.created_at.desc()))
    drives = result.scalars().all()
    return [
        {
            "id": d.id,
            "title": d.title,
            "company": d.company.name if d.company else None,
            "status": d.status.value,
            "package_lpa": d.package_lpa,
            "deadline": d.deadline.isoformat() if d.deadline else None,
        }
        for d in drives
    ]


@router.get("/{drive_id}/shortlist")
async def get_shortlist(
    drive_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    if current_user.role == UserRole.COMPANY:
        drive = await _get_drive_or_404(drive_id, db)
        company_result = await db.execute(
            select(Company).where(Company.user_id == current_user.id)
        )
        company = company_result.scalar_one_or_none()
        if not company or drive.company_id != company.id:
            raise HTTPException(status_code=403, detail="You can only view your own company's shortlist")

    result = await db.execute(
        select(MatchScore)
        .options(selectinload(MatchScore.student))
        .where(MatchScore.drive_id == drive_id)
        .order_by(MatchScore.rank)
    )
    matches = result.scalars().all()
    return [
        {
            "student_id": m.student_id,
            "name": m.student.name if m.student else None,
            "roll_no": m.student.roll_no if m.student else None,
            "cgpa": m.student.cgpa if m.student else None,
            "branch": m.student.branch if m.student else None,
            "score": m.score,
            "rank": m.rank,
            "shortlisted": m.shortlisted,
            "explanation": m.explanation,
            "tpo_override": m.tpo_override,
        }
        for m in matches
    ]


@router.patch("/{drive_id}/shortlist")
async def approve_shortlist(
    drive_id: str,
    body: ShortlistOverrideRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """TPO approval gate #1 — approve or modify the AI shortlist."""
    drive = await _get_drive_or_404(drive_id, db)

    if body.shortlisted_student_ids is not None:
        # Reset all
        result = await db.execute(
            select(MatchScore).where(MatchScore.drive_id == drive_id)
        )
        for ms in result.scalars().all():
            ms.shortlisted = ms.student_id in body.shortlisted_student_ids
            ms.tpo_override = True
            ms.tpo_override_reason = body.notes
    
    drive.status = (
        DriveStatus.SHORTLIST_APPROVED if body.approved else DriveStatus.MATCHED
    )

    event_type = "shortlist_approved" if body.approved else "shortlist_rejected"
    ae = AgentEvent(
        drive_id=drive_id,
        event_type=event_type,
        agent_name="human_tpo",
        payload={"notes": body.notes},
        actor="tpo",
    )
    db.add(ae)
    await db.commit()
    await emit_agent_event(event_type, {"notes": body.notes}, drive_id=drive_id, agent_name="human_tpo")
    return {"message": "Shortlist updated", "status": drive.status.value}


@router.patch("/{drive_id}/schedule/approve")
async def approve_schedule(
    drive_id: str,
    body: ScheduleApprovalRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """TPO approval gate #2 — confirm interview schedule."""
    drive = await _get_drive_or_404(drive_id, db)
    drive.status = DriveStatus.SCHEDULED if body.approved else DriveStatus.SHORTLIST_APPROVED

    event_type = "schedule_approved" if body.approved else "schedule_rejected"
    ae = AgentEvent(
        drive_id=drive_id,
        event_type=event_type,
        agent_name="human_tpo",
        payload={"notes": body.notes},
        actor="tpo",
    )
    db.add(ae)
    await db.commit()
    await emit_agent_event(event_type, {"notes": body.notes}, drive_id=drive_id, agent_name="human_tpo")
    return {"message": "Schedule decision recorded", "status": drive.status.value}


@router.get("/{drive_id}/events")
async def get_drive_events(
    drive_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    result = await db.execute(
        select(AgentEvent)
        .where(AgentEvent.drive_id == drive_id)
        .order_by(AgentEvent.created_at.asc())
    )
    events = result.scalars().all()
    return [
        {
            "event_type": e.event_type,
            "agent_name": e.agent_name,
            "payload": e.payload,
            "actor": e.actor,
            "created_at": e.created_at.isoformat(),
        }
        for e in events
    ]


@router.patch("/{drive_id}/archive")
async def archive_drive(
    drive_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Soft-delete: mark a drive as cancelled so it disappears from active view."""
    result = await db.execute(select(PlacementDrive).where(PlacementDrive.id == drive_id))
    drive = result.scalar_one_or_none()
    if not drive:
        raise HTTPException(status_code=404, detail="Drive not found")
    drive.status = DriveStatus.CANCELLED
    await db.commit()
    return {"message": "Drive archived", "id": drive_id}


@router.patch("/{drive_id}/restore")
async def restore_drive(
    drive_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Restore a cancelled/archived drive back to draft status."""
    result = await db.execute(select(PlacementDrive).where(PlacementDrive.id == drive_id))
    drive = result.scalar_one_or_none()
    if not drive:
        raise HTTPException(status_code=404, detail="Drive not found")
    drive.status = DriveStatus.DRAFT
    await db.commit()
    return {"message": "Drive restored to draft", "id": drive_id}
