"""Where a Gemini call is sent, and how it authenticates.

Everything goes to generativelanguage.googleapis.com with an API key. That is
the whole of it now, and the simplicity is deliberate: this repo is meant to be
cloned and run, and anyone doing that has a key, not a Google Cloud project.

It used to also speak to Vertex AI (now the Gemini Enterprise Agent Platform),
authorised with an ADC bearer token and billed to a GCP project, because the
hosted demo needed a path with no daily request cap. That demo is gone, so the
second backend was code nobody could exercise — a cloner has no project, and
there is no deployment left that does.

`embed_texts` stays here rather than in the caller because the embedding
endpoint is genuinely different in shape from generateContent — a `requests`
list rather than `contents`, and the vector nested under `embeddings` — and
matcher_agent should not have to know that.
"""
from __future__ import annotations

import httpx

from app.config import settings

_GENERATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_EMBED = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"


def generate_content_target(model: str) -> tuple[str, dict[str, str]]:
    """(url, headers) for a generateContent POST. The payload is unchanged."""
    return _GENERATE.format(model=model), {"x-goog-api-key": settings.GEMINI_API_KEY}


def orchestrator_model() -> str:
    """The function-calling model for the agent loop and the one-shot agents."""
    return settings.ORCHESTRATOR_MODEL


async def embed_texts(texts: list[str], task_type: str) -> list[list[float]]:
    """Embed a batch, returning one vector per input in the same order.

    task_type is RETRIEVAL_DOCUMENT for indexed content (student profiles) or
    RETRIEVAL_QUERY for the search query (the JD) — the matching is asymmetric.

    Raises on failure; the caller owns the decision to fall back to TF-IDF.
    """
    model = settings.EMBEDDING_MODEL
    payload = {
        "requests": [
            {"model": f"models/{model}", "content": {"parts": [{"text": t}]}, "taskType": task_type}
            for t in texts
        ]
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            _EMBED.format(model=model),
            headers={"x-goog-api-key": settings.GEMINI_API_KEY},
            json=payload,
        )
        resp.raise_for_status()
        return [e["values"] for e in resp.json()["embeddings"]]
