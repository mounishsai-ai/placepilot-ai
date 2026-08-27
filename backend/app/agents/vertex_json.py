"""
Shared one-shot JSON generation over Vertex — the shape panel_agent.py and
auditor_agent.py both need: no tools, no conversation, one document out.
Split out once a second caller needed it rather than duplicated a second time.
"""
import asyncio
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

# Same transient-error retry as orchestrator.py's _call_gemini — a 429/503
# here previously killed the Analyst/Auditor/Panel call outright.
_RETRY_DELAYS_S = [5, 15]


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
        for attempt, delay in enumerate([*_RETRY_DELAYS_S, None]):
            resp = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=payload)
            if resp.status_code not in (429, 503) or delay is None:
                resp.raise_for_status()
                data = resp.json()
                break
            logger.warning(
                "{}: Vertex {}, retrying in {}s (attempt {}/{})",
                caller, resp.status_code, delay, attempt + 1, len(_RETRY_DELAYS_S),
            )
            await asyncio.sleep(delay)

    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError):
        logger.warning("{}: no parts in Vertex response: {}", caller, data)
        return {}

    # gemini-2.5-flash is a thinking model: it can emit a "thought" part before
    # the real answer part, so parts[0] is not reliably the JSON we want — skip
    # any part marked as a thought (orchestrator.py's loop does the equivalent
    # by treating all text as trace-worthy; here there's only one answer part).
    text_parts = [p["text"] for p in parts if "text" in p and not p.get("thought")]
    if not text_parts:
        logger.warning("{}: no non-thought text in Vertex response: {}", caller, data)
        return {}
    text = "".join(text_parts)

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
