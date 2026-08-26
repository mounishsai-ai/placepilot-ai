from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    APP_NAME: str = "AI Campus Placement Agent"
    APP_ENV: str = "development"
    SECRET_KEY: str = "dev-secret-key-change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/placement_db"
    SYNC_DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/placement_db"

    REDIS_URL: str = "redis://localhost:6379/0"

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"      # 500 RPD, 15 RPM — primary workhorse
    GEMINI_MODEL_PRO: str = "gemini-3.5-flash"           # high-quality JD analysis; gemini-3.6-flash measured ~27s/call vs ~5.7s here
    EMBEDDING_MODEL: str = "gemini-embedding-001"

    # Vertex AI — used only for embeddings (project-billed quota, no per-key 429s;
    # see backend/.gcp_project.env for how this was verified). JD analysis / match
    # explanations stay on the AI Studio key path — low volume, not currently rate-limited.
    GCP_PROJECT_ID: str = "placement-agent-22587"
    VERTEX_EMBEDDING_LOCATION: str = "us-central1"

    CHROMA_PERSIST_DIR: str = "./chroma_db"

    SENDGRID_API_KEY: str = ""
    FROM_EMAIL: str = "placement@college.edu"
    FROM_NAME: str = "Placement Cell"

    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""
    TWILIO_WHATSAPP_NUMBER: str = ""

    GOOGLE_CALENDAR_CREDENTIALS_FILE: str = "./credentials/google_calendar.json"
    GOOGLE_CALENDAR_ID: str = "primary"

    FRONTEND_URL: str = "http://localhost:3000"
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE_MB: int = 10

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
