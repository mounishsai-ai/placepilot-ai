"""
Shared one-shot JSON generation over Vertex — the shape panel_agent.py and
auditor_agent.py both need: no tools, no conversation, one document out.
Split out once a second caller needed it rather than duplicated a second time.
"""
import json
from typing import Any

import httpx
from loguru import logger

from app.config import settings
from app.agents.vertex_auth import get_vertex_access_token

VERTEX_GENERATE_URL = (
    "https://aiplatform.googleapis.com/v1/projects/{project}"
    "/locations/global/publishers/google/models/{model}:generateContent"
)


async def generate_json(system_prompt: str, user_prompt: str, *, caller: str = "agent") -> dict[str, Any]:
    """One Vertex call that must come back as a JSON object.

    responseMimeType pins the model to JSON so we don't have to strip markdown
    fences, but a fence still shows up occasionally — the guard below is
    cheaper than a retry.
    """
    token = get_vertex_access_token()
    url = VERTEX_GENERATE_URL.format(
        project=settings.GCP_PROJECT_ID, model=settings.VERTEX_ORCHESTRATOR_MODEL
    )
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.4},
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=payload)
        resp.raise_for_status()
        data = resp.json()

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        logger.warning("{}: no text in Vertex response: {}", caller, data)
        return {}

    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        logger.warning("{}: unparseable JSON: {}", caller, text[:300])
        return {}
