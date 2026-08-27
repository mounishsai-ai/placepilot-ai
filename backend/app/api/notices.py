"""
Notices API — a real, authored message from a specific company (HR) to the
placement office. Distinct from the auto-generated pipeline_started /
pipeline_error AgentEvents: those stay exactly as they are, this is the
actual communication surface between HR and the TPO.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional

from app.database import get_db
from app.models import Notice, Company, PlacementDrive, User, UserRole
from app.api.auth import require_role

router = APIRouter()


class SendNoticeRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=2000)
    drive_id: Optional[str] = None


async def _current_company(user: User, db: AsyncSession) -> Company:
    result = await db.execute(select(Company).where(Company.user_id == user.id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="No company profile for this account")
    return company


@router.post("")
async def send_notice(
    body: SendNoticeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.COMPANY)),
):
    company = await _current_company(current_user, db)

    if body.drive_id:
        drive_result = await db.execute(
            select(PlacementDrive).where(PlacementDrive.id == body.drive_id)
        )
        drive = drive_result.scalar_one_or_none()
        if not drive or drive.company_id != company.id:
            raise HTTPException(status_code=403, detail="Not your drive")

    notice = Notice(
        company_id=company.id,
        drive_id=body.drive_id,
        subject=body.subject,
        message=body.message,
    )
    db.add(notice)
    await db.commit()
    return {"message": "Notice sent to the placement office"}


@router.get("")
async def list_notices_for_tpo(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Every company's notices, newest first — there's one TPO office in this
    system, not per-user inboxes, so any TPO account sees all of them."""
    result = await db.execute(
        select(Notice)
        .options(selectinload(Notice.company), selectinload(Notice.drive))
        .order_by(Notice.created_at.desc())
        .limit(100)
    )
    notices = result.scalars().all()
    return [
        {
            "id": n.id,
            "company": n.company.name if n.company else None,
            "drive_id": n.drive_id,
            "drive_title": n.drive.title if n.drive else None,
            "subject": n.subject,
            "message": n.message,
            "created_at": n.created_at.isoformat(),
        }
        for n in notices
    ]


@router.get("/sent")
async def list_sent_notices(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.COMPANY)),
):
    """A company's own sent history."""
    company = await _current_company(current_user, db)
    result = await db.execute(
        select(Notice)
        .options(selectinload(Notice.drive))
        .where(Notice.company_id == company.id)
        .order_by(Notice.created_at.desc())
        .limit(100)
    )
    notices = result.scalars().all()
    return [
        {
            "id": n.id,
            "drive_id": n.drive_id,
            "drive_title": n.drive.title if n.drive else None,
            "subject": n.subject,
            "message": n.message,
            "created_at": n.created_at.isoformat(),
        }
        for n in notices
    ]
