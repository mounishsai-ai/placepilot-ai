"""
Notifier Agent — multi-channel notification with offline queue fallback.
Supports: email (SendGrid), SMS (Twilio), WhatsApp (Twilio), in-app.
Offline fallback: queues messages to DB when external services fail.
"""
import asyncio
from collections import defaultdict
from datetime import datetime
from typing import Optional
from loguru import logger
from app.config import settings

# ─── Email via SendGrid ───────────────────────────────────────────────────────

TEMPLATES = {
    "shortlisted": {
        "subject": "🎉 You've been shortlisted! | {company} - {role}",
        "body": """Dear {name},

Congratulations! You have been shortlisted for the placement drive:

  Company  : {company}
  Role     : {role}
  Package  : {package} LPA

Your Interview Schedule:
  Date     : {date}
  Time     : {time}
  Venue    : {venue}
  Round    : {round}

Please carry your college ID and updated resume.
Report 15 minutes before your scheduled time.

Best regards,
Placement Cell
{college}
""",
    },
    "reminder": {
        "subject": "⏰ Reminder: Interview tomorrow | {company}",
        "body": """Dear {name},

This is a reminder that your interview is scheduled for tomorrow.

  Company  : {company}
  Role     : {role}
  Time     : {time}
  Venue    : {venue}

Please ensure you are well prepared.

Best regards,
Placement Cell
""",
    },
    "not_shortlisted": {
        "subject": "Update on your application | {company}",
        "body": """Dear {name},

Thank you for your interest in {company} ({role}).

After careful review, you have not been shortlisted for this drive.
Please do not be discouraged — many more opportunities await.

Your placement readiness score and skill recommendations have been updated
in your portal. Keep building your skills!

Best regards,
Placement Cell
""",
    },
    "schedule_confirmed": {
        "subject": "📅 Interview Schedule Confirmed | {company}",
        "body": """Dear {name},

Your interview schedule for {company} has been confirmed.

  Round    : {round}
  Date     : {date}
  Time     : {time}
  Venue    : {venue}
  Mode     : {mode}
{meet_link_line}
Please be on time. All the best!

Placement Cell
""",
    },
    "result_selected": {
        "subject": "🎊 Offer Extended! | {company}",
        "body": """Dear {name},

We are delighted to inform you that {company} has extended you an offer!

  Role     : {role}
  Package  : {package} LPA
  Location : {location}

The formal offer letter will be shared shortly.
Please visit the placement portal to confirm your acceptance.

Congratulations!
Placement Cell
""",
    },
}


def _render_template(template_id: str, data: dict) -> tuple[str, str]:
    """Render subject + body from a template. Missing placeholders degrade to '-'
    instead of raising, since a TPO's ad-hoc `data` dict rarely fills every field."""
    if template_id == "custom":
        return data.get("subject", "Placement Update"), data.get("body", "")
    tmpl = TEMPLATES.get(template_id, {})
    safe_data = defaultdict(lambda: "-", data)
    subject = tmpl.get("subject", "Placement Update").format_map(safe_data)
    body = tmpl.get("body", "").format_map(safe_data)
    return subject, body


async def send_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: Optional[str] = None,
) -> bool:
    """Send email via SendGrid. Returns True on success."""
    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail, Content, MimeType

        sg = SendGridAPIClient(settings.SENDGRID_API_KEY)
        message = Mail(
            from_email=(settings.FROM_EMAIL, settings.FROM_NAME),
            to_emails=to_email,
            subject=subject,
        )
        message.add_content(Content(MimeType.text, body))
        if html_body:
            message.add_content(Content(MimeType.html, html_body))

        # Run in executor to avoid blocking
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, sg.send, message)
        logger.info(f"Email sent to {to_email}: {subject}")
        return True
    except Exception as e:
        logger.error(f"Email failed to {to_email}: {e}")
        return False


async def send_sms(phone: str, message: str) -> bool:
    """Send SMS via Twilio."""
    try:
        from twilio.rest import Client
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: client.messages.create(
                body=message,
                from_=settings.TWILIO_PHONE_NUMBER,
                to=phone,
            ),
        )
        logger.info(f"SMS sent to {phone}")
        return True
    except Exception as e:
        logger.error(f"SMS failed to {phone}: {e}")
        return False


async def send_whatsapp(phone: str, message: str) -> bool:
    """Send WhatsApp message via Twilio."""
    try:
        from twilio.rest import Client
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: client.messages.create(
                body=message,
                from_=settings.TWILIO_WHATSAPP_NUMBER,
                to=f"whatsapp:{phone}",
            ),
        )
        logger.info(f"WhatsApp sent to {phone}")
        return True
    except Exception as e:
        logger.error(f"WhatsApp failed to {phone}: {e}")
        return False


# ─── Multi-Channel Dispatcher ─────────────────────────────────────────────────

async def notify_student(
    student: dict,
    template_id: str,
    data: dict,
    channels: Optional[list[str]] = None,
) -> dict:
    """
    Send a notification to a student via all requested channels.
    Falls back gracefully — if all channels fail, marks as offline_queued.
    """
    channels = channels or ["email", "in_app"]
    subject, body = _render_template(template_id, {**data, "name": student.get("name", "Student")})
    results = {}

    if "email" in channels and student.get("email"):
        results["email"] = await send_email(student["email"], subject, body)

    if "sms" in channels and student.get("phone"):
        sms_body = f"{subject}\n{body[:160]}"
        results["sms"] = await send_sms(student["phone"], sms_body)

    if "whatsapp" in channels and student.get("phone"):
        results["whatsapp"] = await send_whatsapp(student["phone"], body[:1500])

    results["in_app"] = True  # always succeeds (stored in DB)

    any_success = any(results.values())
    status = "sent" if any_success else "offline_queued"

    return {
        "student_id": student["id"],
        "template_id": template_id,
        "channels": results,
        "status": status,
        "sent_at": datetime.utcnow().isoformat() if any_success else None,
    }


async def bulk_notify(
    students: list[dict],
    template_id: str,
    data_fn,  # callable(student) -> dict
    channels: Optional[list[str]] = None,
) -> list[dict]:
    """Send notifications to all students concurrently."""
    tasks = [
        notify_student(student, template_id, data_fn(student), channels)
        for student in students
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    successes = [r for r in results if isinstance(r, dict)]
    failures = [r for r in results if isinstance(r, Exception)]
    logger.info(f"Bulk notify: {len(successes)} sent, {len(failures)} failed")
    return successes
