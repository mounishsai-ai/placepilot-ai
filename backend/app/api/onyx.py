"""
Onyx sidebar API — the free-text supervisor chat, reachable from anywhere in
the TPO portal. See app/agents/onyx_chat.py for why this is a stateless,
synchronous endpoint rather than the paused/resumed AgentRun pattern the rest
of the orchestrator uses.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import UserRole
from app.api.auth import require_role
from app.agents.onyx_chat import run_onyx_chat

router = APIRouter()


class OnyxChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    # Vertex's own `contents` list from the previous turn, round-tripped by
    # the frontend — gives the sidebar real multi-turn memory with no new
    # DB table (this app has no migration path beyond create_all).
    history: list[dict] = Field(default_factory=list)


@router.post("/chat")
async def onyx_chat(
    body: OnyxChatRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_role(UserRole.TPO)),
):
    """One turn of the Onyx sidebar chat."""
    result = await run_onyx_chat(db, body.message, body.history)
    return {
        "answer": result["answer"],
        "contents": result["contents"],
        "trace": result["trace"],
    }
