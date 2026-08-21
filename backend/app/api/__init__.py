from app.api import auth, drives, students, analytics, websocket
from app.api.schedule import router as schedule_router
from app.api.notifications import router as notifications_router

__all__ = ["auth", "drives", "students", "analytics", "websocket", "schedule_router", "notifications_router"]
