"""
Analytics API — dashboard, skill-gap, readiness, and placement trend data.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.orm import selectinload
from collections import defaultdict

from app.database import get_db
from app.models import (
    Student, PlacementDrive, MatchScore, EligibilityResult,
    InterviewSlot, StudentSkill, AgentEvent, DriveStatus, SlotStatus, UserRole
)
from app.api.auth import get_current_user, require_role

router = APIRouter()


@router.get("/dashboard")
async def get_tpo_dashboard(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    """Main TPO dashboard — all live KPIs and pending actions."""

    # Drive status counts
    drives_result = await db.execute(select(PlacementDrive))
    all_drives = drives_result.scalars().all()
    status_counts = defaultdict(int)
    for d in all_drives:
        status_counts[d.status.value] += 1

    # Total students
    students_result = await db.execute(select(func.count(Student.id)))
    total_students = students_result.scalar()

    # Placed students (slots with result = selected)
    placed_result = await db.execute(
        select(func.count(InterviewSlot.student_id.distinct()))
        .where(InterviewSlot.result == "selected")
    )
    placed_count = placed_result.scalar()

    # Pending human actions
    pending_shortlist = status_counts.get("shortlist_pending", 0)
    pending_schedule = status_counts.get("schedule_pending", 0)

    # Recent agent events
    events_result = await db.execute(
        select(AgentEvent)
        .order_by(AgentEvent.created_at.desc())
        .limit(10)
    )
    recent_events = [
        {
            "event_type": e.event_type,
            "agent_name": e.agent_name,
            "drive_id": e.drive_id,
            "created_at": e.created_at.isoformat(),
        }
        for e in events_result.scalars().all()
    ]

    # Placement rate by branch
    branch_result = await db.execute(
        select(Student.branch, func.count(Student.id)).group_by(Student.branch)
    )
    branch_totals = {row[0]: row[1] for row in branch_result.all()}

    # Avg package
    avg_pkg_result = await db.execute(
        select(func.avg(PlacementDrive.package_lpa))
        .where(PlacementDrive.status == DriveStatus.COMPLETED)
    )
    avg_package = round(avg_pkg_result.scalar() or 0, 2)

    return {
        "kpis": {
            "total_drives": len(all_drives),
            "active_drives": status_counts.get("ongoing", 0) + status_counts.get("scheduled", 0),
            "completed_drives": status_counts.get("completed", 0),
            "total_students": total_students,
            "placed_students": placed_count,
            "placement_rate_pct": round((placed_count / total_students * 100) if total_students else 0, 1),
            "avg_package_lpa": avg_package,
            "pending_approvals": pending_shortlist + pending_schedule,
        },
        "drive_pipeline": dict(status_counts),
        "pending_actions": {
            "shortlist_approvals": pending_shortlist,
            "schedule_approvals": pending_schedule,
        },
        "recent_agent_activity": recent_events,
        "students_by_branch": branch_totals,
    }


@router.get("/exceptions")
async def get_exceptions(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Borderline eligibility cases the AI flagged for human review.

    `EligibilityResult.is_edge_case` is computed by the eligibility agent for
    every near-boundary student (e.g. missed CGPA cutoff by <0.3, or exactly
    one backlog over the limit) but was never read by any endpoint before this
    one — required feature #7 ("pending actions and exceptions") had no data
    source. This is that data source.
    """
    result = await db.execute(
        select(EligibilityResult)
        .options(
            selectinload(EligibilityResult.student),
            selectinload(EligibilityResult.drive).selectinload(PlacementDrive.company),
        )
        .where(EligibilityResult.is_edge_case == True)  # noqa: E712
        .order_by(EligibilityResult.checked_at.desc())
        .limit(100)
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "drive_id": r.drive_id,
            "drive_title": r.drive.title if r.drive else None,
            "company": r.drive.company.name if r.drive and r.drive.company else None,
            "student_id": r.student_id,
            "student_name": r.student.name if r.student else None,
            "roll_no": r.student.roll_no if r.student else None,
            "eligible": r.eligible,
            "reasons": r.reason,
            "checked_at": r.checked_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/audit-trail")
async def get_audit_trail(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Cross-drive timeline of every agent decision AND every human decision,
    distinguished by `AgentEvent.actor` ("ai" vs "tpo" vs "system"). This data
    was already persisted for every pipeline run and every approval — this is
    the first endpoint that surfaces it as one readable trail rather than a
    per-drive scroll buried in an expandable card.
    """
    result = await db.execute(
        select(AgentEvent)
        .options(selectinload(AgentEvent.drive))
        .order_by(AgentEvent.created_at.desc())
        .limit(150)
    )
    events = result.scalars().all()
    return [
        {
            "id": e.id,
            "drive_id": e.drive_id,
            "drive_title": e.drive.title if e.drive else None,
            "event_type": e.event_type,
            "agent_name": e.agent_name,
            "actor": e.actor,
            "payload": e.payload,
            "created_at": e.created_at.isoformat(),
        }
        for e in events
    ]


@router.get("/skill-gap")
async def get_skill_gap(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    """Aggregate skill gap across all students vs. required skills in active drives."""

    # All required skills across active drives
    drives_result = await db.execute(
        select(PlacementDrive)
        .where(PlacementDrive.jd_parsed.isnot(None))
    )
    drives = drives_result.scalars().all()

    required_skill_freq: dict[str, int] = defaultdict(int)
    for d in drives:
        parsed = d.jd_parsed or {}
        for skill in parsed.get("required_skills", []):
            required_skill_freq[skill.lower()] += 1

    # All student skills
    skills_result = await db.execute(select(StudentSkill))
    student_skill_counts: dict[str, int] = defaultdict(int)
    for sk in skills_result.scalars().all():
        student_skill_counts[sk.skill.lower()] += 1

    # Compute gap
    total_students_result = await db.execute(select(func.count(Student.id)))
    total_students = total_students_result.scalar() or 1

    gaps = []
    for skill, demand in sorted(required_skill_freq.items(), key=lambda x: -x[1]):
        supply = student_skill_counts.get(skill, 0)
        coverage_pct = round(supply / total_students * 100, 1)
        gaps.append({
            "skill": skill,
            "demand_score": demand,            # how many drives need it
            "students_with_skill": supply,
            "coverage_pct": coverage_pct,
            "gap_severity": "high" if coverage_pct < 20 else "medium" if coverage_pct < 50 else "low",
        })

    return {"total_students": total_students, "skill_gaps": gaps[:30]}


@router.get("/readiness")
async def get_placement_readiness(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO, UserRole.COMPANY)),
):
    """Placement readiness distribution across all students."""
    result = await db.execute(
        select(
            Student.branch,
            Student.batch,
            func.avg(Student.placement_readiness_score).label("avg_score"),
            func.count(Student.id).label("count"),
        ).group_by(Student.branch, Student.batch)
    )
    rows = result.all()

    distribution = {
        "not_ready": 0,      # < 40
        "developing": 0,     # 40–60
        "ready": 0,          # 60–80
        "highly_ready": 0,   # 80+
    }
    by_branch = []
    for row in rows:
        score = float(row.avg_score or 0)
        by_branch.append({
            "branch": row.branch,
            "batch": row.batch,
            "avg_readiness": round(score, 1),
            "student_count": row.count,
        })

    # Per-student distribution
    students_result = await db.execute(
        select(Student.placement_readiness_score).where(
            Student.placement_readiness_score.isnot(None)
        )
    )
    for score_row in students_result.scalars().all():
        s = float(score_row)
        if s < 40:
            distribution["not_ready"] += 1
        elif s < 60:
            distribution["developing"] += 1
        elif s < 80:
            distribution["ready"] += 1
        else:
            distribution["highly_ready"] += 1

    return {"distribution": distribution, "by_branch": by_branch}


@router.get("/drives/{drive_id}")
async def get_drive_analytics(
    drive_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    """Per-drive analytics."""
    slots_result = await db.execute(
        select(InterviewSlot).where(InterviewSlot.round.has(drive_id=drive_id))
    )
    slots = slots_result.scalars().all()

    total = len(slots)
    selected = sum(1 for s in slots if s.result == "selected")
    rejected = sum(1 for s in slots if s.result == "rejected")
    pending = sum(1 for s in slots if s.result is None)
    no_show = sum(1 for s in slots if s.status == SlotStatus.NO_SHOW)

    return {
        "drive_id": drive_id,
        "total_interviews": total,
        "selected": selected,
        "rejected": rejected,
        "pending": pending,
        "no_show": no_show,
        "selection_rate_pct": round(selected / total * 100, 1) if total else 0,
    }
