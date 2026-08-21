"""
WebSocket hub — real-time updates for TPO dashboard and student notifications.
"""
import json
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from loguru import logger

router = APIRouter()


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
async def tpo_dashboard_ws(websocket: WebSocket):
    """WebSocket for TPO — receives all agent events and drive status updates."""
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
async def student_ws(websocket: WebSocket, student_id: str):
    """WebSocket for a specific student — receives their notifications."""
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

async def emit_agent_event(event_type: str, payload: dict, drive_id: Optional[str] = None):
    """Broadcast an agent event to the TPO dashboard."""
    await manager.broadcast("tpo_dashboard", {
        "type": "agent_event",
        "event_type": event_type,
        "drive_id": drive_id,
        "payload": payload,
    })


async def notify_student_ws(student_id: str, notification: dict):
    """Send a real-time notification to a specific student."""
    await manager.broadcast(f"student_{student_id}", {
        "type": "notification",
        **notification,
    })
