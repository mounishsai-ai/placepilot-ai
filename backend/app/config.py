from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    APP_NAME: str = "PlacePilot AI"
    APP_ENV: str = "development"
    SECRET_KEY: str = "dev-secret-key-change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/placement_db"
    SYNC_DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/placement_db"

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"      # 500 RPD, 15 RPM — primary workhorse
    GEMINI_MODEL_PRO: str = "gemini-3.5-flash"           # high-quality JD analysis; gemini-3.6-flash measured ~27s/call vs ~5.7s here
    EMBEDDING_MODEL: str = "gemini-embedding-001"

    # Drives the agent loop and every one-shot JSON agent: it is the only model
    # here that has to do function calling. Note it is NOT gemini-2.5-flash,
    # which the loop was originally built against — that model is retired on
    # generativelanguage.googleapis.com and 404s for keys issued after its
    # cutoff. Function calling is verified working on this one.
    ORCHESTRATOR_MODEL: str = "gemini-3.5-flash"

    CHROMA_PERSIST_DIR: str = "./chroma_db"

    SENDGRID_API_KEY: str = ""
    FROM_EMAIL: str = "placement@college.edu"
    FROM_NAME: str = "Placement Cell"

    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""
    TWILIO_WHATSAPP_NUMBER: str = ""

    FRONTEND_URL: str = "http://localhost:3000"
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE_MB: int = 10

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
