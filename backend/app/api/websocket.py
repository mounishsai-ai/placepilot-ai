"""
WebSocket hub — real-time updates for TPO dashboard and student notifications.
"""
import json
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError, jwt
from loguru import logger

from app.database import get_db
from app.models import User, UserRole, Student
from app.config import settings

router = APIRouter()

_ALGORITHM = "HS256"


async def _authenticate_ws(token: Optional[str], db: AsyncSession) -> Optional[User]:
    """Decode the JWT passed as a WS query param — browsers can't set custom
    headers on a WebSocket handshake, so this is the standard pattern."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[_ALGORITHM])
        user_id = payload.get("sub")
    except JWTError:
        return None
    if not user_id:
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    return user if user and user.is_active else None


class ConnectionManager:
    def __init__(self):
        # room_id -> list of WebSocket connections
        self.active: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room: str):
        await websocket.accept()
        if room not in self.active:
            self.active[room] = []
        self.active[room].append(websocket)
        logger.info(f"WS connected: room={room}, total={len(self.active[room])}")

    def disconnect(self, websocket: WebSocket, room: str):
        if room in self.active:
            self.active[room] = [ws for ws in self.active[room] if ws != websocket]
        logger.info(f"WS disconnected: room={room}")

    async def broadcast(self, room: str, message: dict):
        """Send a message to all connections in a room."""
        if room not in self.active:
            return
        dead = []
        for ws in self.active[room]:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active[room].remove(ws)

    async def broadcast_all(self, message: dict):
        """Broadcast to all connected clients."""
        for room in list(self.active.keys()):
            await self.broadcast(room, message)


manager = ConnectionManager()


@router.websocket("/dashboard")
async def tpo_dashboard_ws(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """WebSocket for TPO — receives all agent events and drive status updates."""
    user = await _authenticate_ws(token, db)
    if not user or user.role != UserRole.TPO:
        await websocket.close(code=4401)
        return
    await manager.connect(websocket, "tpo_dashboard")
    try:
        while True:
            data = await websocket.receive_text()
            # Ping-pong keep-alive
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket, "tpo_dashboard")


@router.websocket("/student/{student_id}")
async def student_ws(
    websocket: WebSocket,
    student_id: str,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """WebSocket for a specific student — receives their notifications.
    Only that student (matched by email) or a TPO may connect to this room."""
    user = await _authenticate_ws(token, db)
    if not user:
        await websocket.close(code=4401)
        return
    if user.role == UserRole.STUDENT:
        result = await db.execute(select(Student).where(Student.id == student_id))
        student = result.scalar_one_or_none()
        if not student or student.email != user.email:
            await websocket.close(code=4403)
            return
    elif user.role != UserRole.TPO:
        await websocket.close(code=4403)
        return

    room = f"student_{student_id}"
    await manager.connect(websocket, room)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)


# ─── Utility functions (called from other parts of the app) ──────────────────

async def emit_agent_event(
    event_type: str,
    payload: dict,
    drive_id: Optional[str] = None,
    agent_name: Optional[str] = None,
):
    """Broadcast an agent event to the TPO dashboard."""
    await manager.broadcast("tpo_dashboard", {
        "type": "agent_event",
        "event_type": event_type,
        "agent_name": agent_name,
        "drive_id": drive_id,
        "payload": payload,
    })


async def notify_student_ws(student_id: str, notification: dict):
    """Send a real-time notification to a specific student."""
    await manager.broadcast(f"student_{student_id}", {
        "type": "notification",
        **notification,
    })
