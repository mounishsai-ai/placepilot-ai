"""
FastAPI main application entry point.
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from sqlalchemy import update

from app.config import settings
from app.database import init_db, async_session_factory
from app.models.models import AgentRun, AgentRunStatus
from app.api import auth, drives, students, analytics, schedule, notifications, notices, websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup + shutdown events."""
    logger.info(f"Starting {settings.APP_NAME} [{settings.APP_ENV}]")
    await init_db()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs(settings.CHROMA_PERSIST_DIR, exist_ok=True)

    # A run can only still be "running" here if the previous container was
    # killed mid-loop (crash, OOM, forced restart/deploy) — nothing else
    # leaves that status set without the loop also finishing. Left alone it's
    # a permanent zombie: stuck forever in the agent dock's "in flight" slot,
    # since the background task that was going to advance it no longer
    # exists (observed live 2026-08-27, after a DB connection exhaustion crash).
    async with async_session_factory() as db:
        result = await db.execute(
            update(AgentRun)
            .where(AgentRun.status == AgentRunStatus.RUNNING)
            .values(status=AgentRunStatus.FAILED)
        )
        await db.commit()
        if result.rowcount:
            logger.warning(f"Marked {result.rowcount} orphaned agent run(s) as failed on startup")

    yield
    logger.info("Shutting down...")


app = FastAPI(
    title=settings.APP_NAME,
    description="AI-powered Campus Placement Operations & Interview Coordination Agent",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

# ─── CORS ────────────────────────────────────────────────────────────────────
CORS_ORIGINS = [
    settings.FRONTEND_URL,
    "http://localhost:3000",
    "http://localhost:3001",
    "https://*.vercel.app",         # Vercel preview deployments
    "https://placementai.vercel.app",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
# NOTE: résumés are intentionally NOT served via a public static mount — any
# uploaded file (deterministic filename: resume_{student_id}.ext) would be
# downloadable with no login. They're served through the authenticated
# GET /api/students/{student_id}/resume endpoint instead (students.py).

# ─── API Routers ─────────────────────────────────────────────────────────────
app.include_router(auth.router,          prefix="/api/auth",          tags=["Authentication"])
app.include_router(drives.router,        prefix="/api/drives",        tags=["Placement Drives"])
app.include_router(students.router,      prefix="/api/students",      tags=["Students"])
app.include_router(analytics.router,     prefix="/api/analytics",     tags=["Analytics"])
app.include_router(schedule.router,      prefix="/api/schedule",      tags=["Scheduling"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(notices.router,       prefix="/api/notices",       tags=["Notices"])
app.include_router(websocket.router,     prefix="/ws",                tags=["WebSocket"])


@app.get("/health")          # Railway / Render health check
@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.APP_ENV}


@app.get("/")
async def root():
    return {"message": f"{settings.APP_NAME} API is running. Visit /api/docs"}
