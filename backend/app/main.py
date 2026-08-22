"""
FastAPI main application entry point.
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.config import settings
from app.database import init_db
from app.api import auth, drives, students, analytics, schedule, notifications, websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup + shutdown events."""
    logger.info(f"Starting {settings.APP_NAME} [{settings.APP_ENV}]")
    await init_db()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs(settings.CHROMA_PERSIST_DIR, exist_ok=True)
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

# ─── Static files (uploaded resumes, etc.) ───────────────────────────────────
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# ─── API Routers ─────────────────────────────────────────────────────────────
app.include_router(auth.router,          prefix="/api/auth",          tags=["Authentication"])
app.include_router(drives.router,        prefix="/api/drives",        tags=["Placement Drives"])
app.include_router(students.router,      prefix="/api/students",      tags=["Students"])
app.include_router(analytics.router,     prefix="/api/analytics",     tags=["Analytics"])
app.include_router(schedule.router,      prefix="/api/schedule",      tags=["Scheduling"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(websocket.router,     prefix="/ws",                tags=["WebSocket"])


@app.get("/health")          # Railway / Render health check
@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.APP_ENV}


@app.get("/")
async def root():
    return {"message": f"{settings.APP_NAME} API is running. Visit /api/docs"}
