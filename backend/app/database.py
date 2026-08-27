from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "development",
    pool_pre_ping=True,
    # Cloud SQL is db-f1-micro, patched to max_connections=30 (was the
    # default 25) after that got exhausted live on 2026-08-27. Cloud Run is
    # capped at max-instances=2, so pool_size+max_overflow per instance must
    # stay comfortably under 15 to leave headroom for Postgres's own reserved
    # slots. 3+2 (5/instance) was too tight the other way: dashboard polling,
    # an open WebSocket, and one background agent run were enough to exhaust
    # it, so a scheduling run's own state-save timed out waiting for a
    # connection and silently died mid-loop (observed live same day).
    pool_size=8,
    max_overflow=4,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# Alias for background tasks that need their own session
async_session_factory = AsyncSessionLocal


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
