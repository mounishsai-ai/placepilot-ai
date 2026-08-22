"""
Students API — CRUD, profile management, and skill tracking.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import os, uuid, aiofiles

from app.database import get_db
from app.models import Student, StudentSkill, InterviewSlot, MatchScore, UserRole, User
from app.api.auth import get_current_user, require_role
from app.config import settings

router = APIRouter()


# ─── Schemas ─────────────────────────────────────────────────────────────────

class SkillIn(BaseModel):
    skill: str
    proficiency: Optional[str] = "intermediate"
    years_experience: Optional[float] = 0

class CreateStudentRequest(BaseModel):
    roll_no: str
    name: str
    email: EmailStr
    phone: Optional[str] = None
    branch: str
    batch: int
    cgpa: float
    backlogs_active: int = 0
    backlogs_historical: int = 0
    attendance_pct: float = 100.0
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    skills: Optional[list[SkillIn]] = []

class UpdateStudentRequest(BaseModel):
    cgpa: Optional[float] = None
    backlogs_active: Optional[int] = None
    attendance_pct: Optional[float] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    skills: Optional[list[SkillIn]] = None


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_my_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the Student record linked to the currently logged-in user (by email)."""
    result = await db.execute(
        select(Student)
        .options(selectinload(Student.skills), selectinload(Student.interview_slots))
        .where(Student.email == current_user.email)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(
            status_code=404,
            detail="No student record found for your account. Please contact the TPO."
        )

    # Also fetch matches for this student
    matches_result = await db.execute(
        select(MatchScore)
        .options(selectinload(MatchScore.drive))
        .where(MatchScore.student_id == student.id)
        .order_by(MatchScore.score.desc())
        .limit(10)
    )
    matches = matches_result.scalars().all()

    return {
        "id": student.id,
        "roll_no": student.roll_no,
        "name": student.name,
        "email": student.email,
        "phone": student.phone,
        "branch": student.branch,
        "batch": student.batch,
        "cgpa": student.cgpa,
        "backlogs_active": student.backlogs_active,
        "backlogs_historical": student.backlogs_historical,
        "attendance_pct": student.attendance_pct,
        "resume_url": student.resume_url,
        "linkedin_url": student.linkedin_url,
        "github_url": student.github_url,
        "placement_readiness_score": student.placement_readiness_score,
        "skills_summary": student.skills_summary,
        "skills": [
            {"skill": sk.skill, "proficiency": sk.proficiency, "years": sk.years_experience}
            for sk in student.skills
        ],
        "matches": [
            {
                "drive_id": m.drive_id,
                "role": m.drive.jd_parsed.get("role") if m.drive and m.drive.jd_parsed else "Software Engineer",
                "company": m.drive.company.name if m.drive and hasattr(m.drive, 'company') and m.drive.company else m.drive.title if m.drive else "Company",
                "score": round(m.score * 100, 1) if m.score <= 1 else round(m.score, 1),
                "rank": m.rank,
                "shortlisted": m.shortlisted,
            }
            for m in matches
        ],
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_student(
    body: CreateStudentRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    existing = await db.execute(select(Student).where(Student.roll_no == body.roll_no))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Roll number already exists")

    student = Student(
        roll_no=body.roll_no, name=body.name, email=body.email,
        phone=body.phone, branch=body.branch, batch=body.batch,
        cgpa=body.cgpa, backlogs_active=body.backlogs_active,
        backlogs_historical=body.backlogs_historical,
        attendance_pct=body.attendance_pct,
        linkedin_url=body.linkedin_url, github_url=body.github_url,
    )
    db.add(student)
    await db.flush()

    for sk in (body.skills or []):
        db.add(StudentSkill(
            student_id=student.id, skill=sk.skill,
            proficiency=sk.proficiency, years_experience=sk.years_experience,
        ))

    await db.commit()
    await db.refresh(student)
    return {"id": student.id, "roll_no": student.roll_no}


@router.get("/")
async def list_students(
    branch: Optional[str] = None,
    batch: Optional[int] = None,
    min_cgpa: Optional[float] = None,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    query = select(Student).options(selectinload(Student.skills))
    if branch:
        query = query.where(Student.branch == branch)
    if batch:
        query = query.where(Student.batch == batch)
    if min_cgpa:
        query = query.where(Student.cgpa >= min_cgpa)

    result = await db.execute(query.order_by(Student.cgpa.desc()))
    students = result.scalars().all()
    return [
        {
            "id": s.id, "roll_no": s.roll_no, "name": s.name,
            "branch": s.branch, "batch": s.batch, "cgpa": s.cgpa,
            "backlogs_active": s.backlogs_active,
            "placement_readiness_score": s.placement_readiness_score,
            "skills": [sk.skill for sk in s.skills],
        }
        for s in students
    ]


@router.get("/{student_id}")
async def get_student(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    result = await db.execute(
        select(Student)
        .options(selectinload(Student.skills), selectinload(Student.interview_slots))
        .where(Student.id == student_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    return {
        "id": student.id, "roll_no": student.roll_no, "name": student.name,
        "email": student.email, "phone": student.phone,
        "branch": student.branch, "batch": student.batch, "cgpa": student.cgpa,
        "backlogs_active": student.backlogs_active,
        "backlogs_historical": student.backlogs_historical,
        "attendance_pct": student.attendance_pct,
        "resume_url": student.resume_url,
        "linkedin_url": student.linkedin_url, "github_url": student.github_url,
        "placement_readiness_score": student.placement_readiness_score,
        "skills_summary": student.skills_summary,
        "skills": [
            {"skill": sk.skill, "proficiency": sk.proficiency, "years": sk.years_experience}
            for sk in student.skills
        ],
    }


@router.put("/{student_id}")
async def update_student(
    student_id: str,
    body: UpdateStudentRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    if body.cgpa is not None:
        student.cgpa = body.cgpa
    if body.backlogs_active is not None:
        student.backlogs_active = body.backlogs_active
    if body.attendance_pct is not None:
        student.attendance_pct = body.attendance_pct
    if body.linkedin_url is not None:
        student.linkedin_url = body.linkedin_url
    if body.github_url is not None:
        student.github_url = body.github_url

    if body.skills is not None:
        # Remove existing skills
        existing_skills = await db.execute(
            select(StudentSkill).where(StudentSkill.student_id == student_id)
        )
        for sk in existing_skills.scalars().all():
            await db.delete(sk)
        # Add new skills
        for sk in body.skills:
            db.add(StudentSkill(
                student_id=student_id, skill=sk.skill,
                proficiency=sk.proficiency, years_experience=sk.years_experience,
            ))

    await db.commit()
    return {"message": "Updated successfully"}


@router.post("/{student_id}/upload-resume")
async def upload_resume(
    student_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    ext = os.path.splitext(file.filename)[-1].lower()
    filename = f"resume_{student_id}{ext}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)

    import aiofiles
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(await file.read())

    student.resume_url = f"/uploads/{filename}"
    await db.commit()
    return {"resume_url": student.resume_url}


@router.get("/{student_id}/schedule")
async def get_student_schedule(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    result = await db.execute(
        select(InterviewSlot)
        .options(
            selectinload(InterviewSlot.round),
            selectinload(InterviewSlot.room),
            selectinload(InterviewSlot.panel_member),
        )
        .where(InterviewSlot.student_id == student_id)
        .order_by(InterviewSlot.slot_start)
    )
    slots = result.scalars().all()
    return [
        {
            "id": s.id,
            "round_type": s.round.round_type.value if s.round else None,
            "slot_start": s.slot_start.isoformat(),
            "slot_end": s.slot_end.isoformat(),
            "status": s.status.value,
            "result": s.result,
            "venue": s.room.name if s.room else s.round.venue if s.round else None,
            "meet_link": s.round.meet_link if s.round else None,
            "panel_name": s.panel_member.name if s.panel_member else None,
        }
        for s in slots
    ]


@router.get("/{student_id}/matches")
async def get_student_matches(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    result = await db.execute(
        select(MatchScore)
        .options(selectinload(MatchScore.drive))
        .where(MatchScore.student_id == student_id)
        .order_by(MatchScore.score.desc())
    )
    matches = result.scalars().all()
    return [
        {
            "drive_id": m.drive_id,
            "company": m.drive.company_id if m.drive else None,
            "role": m.drive.jd_parsed.get("role") if m.drive and m.drive.jd_parsed else None,
            "score": m.score,
            "rank": m.rank,
            "shortlisted": m.shortlisted,
            "explanation": m.explanation,
        }
        for m in matches
    ]


@router.post("/me/resume")
async def upload_my_resume(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload or replace resume for the logged-in student."""
    result = await db.execute(
        select(Student).where(Student.email == current_user.email)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student record not found")

    # Save file
    ext = os.path.splitext(file.filename or "")[-1].lower() or ".pdf"
    filename = f"resume_{student.id}{ext}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    student.resume_url = f"/uploads/{filename}"
    await db.commit()
    return {"resume_url": student.resume_url, "filename": filename}
