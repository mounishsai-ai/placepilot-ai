"""
Notifications API — delivery tracking and offline queue management.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.database import get_db
from app.models import Notification, Student, NotificationChannel, UserRole
from app.api.auth import get_current_user, require_role
from app.agents.notifier_agent import notify_student, bulk_notify

router = APIRouter()


class SendNotificationRequest(BaseModel):
    student_ids: list[str]
    template_id: str
    data: dict
    channels: Optional[list[str]] = ["email", "in_app"]


@router.post("/send")
async def send_notifications(
    body: SendNotificationRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    result = await db.execute(
        select(Student).where(Student.id.in_(body.student_ids))
    )
    students = result.scalars().all()
    students_dict = [
        {"id": s.id, "name": s.name, "email": s.email, "phone": s.phone}
        for s in students
    ]

    async def _send_and_persist():
        results = await bulk_notify(
            students_dict,
            body.template_id,
            lambda s: body.data,
            body.channels,
        )
        # Persist to DB
        for r in results:
            notif = Notification(
                student_id=r["student_id"],
                channel=NotificationChannel.EMAIL,
                message=str(body.data),
                status=r["status"],
            )
            db.add(notif)
        await db.commit()

    background_tasks.add_task(_send_and_persist)
    return {"message": f"Queued notifications for {len(students)} students"}


@router.get("/student/{student_id}")
async def get_student_notifications(
    student_id: str,
    unread_only: bool = False,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    query = select(Notification).where(Notification.student_id == student_id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    query = query.order_by(Notification.created_at.desc()).limit(50)

    result = await db.execute(query)
    notifs = result.scalars().all()
    return [
        {
            "id": n.id,
            "channel": n.channel.value,
            "subject": n.subject,
            "message": n.message,
            "status": n.status,
            "sent_at": n.sent_at.isoformat() if n.sent_at else None,
            "read_at": n.read_at.isoformat() if n.read_at else None,
            "created_at": n.created_at.isoformat(),
        }
        for n in notifs
    ]


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
):
    from datetime import datetime
    await db.execute(
        update(Notification)
        .where(Notification.id == notification_id)
        .values(read_at=datetime.utcnow())
    )
    await db.commit()
    return {"message": "Marked as read"}


@router.get("/offline-queue")
async def get_offline_queue(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Get all notifications in the offline queue (failed delivery)."""
    result = await db.execute(
        select(Notification).where(Notification.status == "offline_queued")
        .order_by(Notification.created_at.asc())
    )
    queued = result.scalars().all()
    return {
        "count": len(queued),
        "notifications": [
            {
                "id": n.id,
                "student_id": n.student_id,
                "channel": n.channel.value,
                "message": n.message,
                "retry_count": n.retry_count,
                "created_at": n.created_at.isoformat(),
            }
            for n in queued
        ],
    }


@router.post("/retry-offline")
async def retry_offline_queue(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """Retry all queued offline notifications (triggered when network is restored)."""
    result = await db.execute(
        select(Notification).where(Notification.status == "offline_queued")
        .limit(100)
    )
    queued = result.scalars().all()

    async def _retry():
        for notif in queued:
            student_result = await db.execute(
                select(Student).where(Student.id == notif.student_id)
            )
            student = student_result.scalar_one_or_none()
            if student:
                result = await notify_student(
                    {"id": student.id, "name": student.name, "email": student.email, "phone": student.phone},
                    "shortlisted",
                    {"message": notif.message},
                    [notif.channel.value],
                )
                if result.get("status") == "sent":
                    notif.status = "sent"
                    notif.retry_count += 1
        await db.commit()

    background_tasks.add_task(_retry)
    return {"message": f"Retrying {len(queued)} queued notifications"}
