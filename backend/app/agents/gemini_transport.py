"""Where a Gemini call is sent, and how it authenticates.

Two backends serve the same models and this module hides the difference:

  aistudio   generativelanguage.googleapis.com, authorised with an API key.
             No Google Cloud project needed, so this is what anyone cloning
             this repo will use, and it is the default.

  vertex     aiplatform.googleapis.com (the platform since renamed Gemini
             Enterprise Agent Platform), authorised with an ADC bearer token
             and billed to a GCP project. Quota is project-billed rather than
             per-key, which matters because the free key tier is tight enough
             to 429 partway through a single drive.

`generateContent` takes byte-identical request and response JSON on both, so
callers just ask for a target (URL + headers) and post their existing payload.
Embeddings do NOT: Gemini Enterprise uses :predict with an `instances` list, AI Studio
uses :batchEmbedContents with a `requests` list, and the responses nest the
vector differently. `embed_texts` normalises both to a plain list of vectors.

The orchestrator model differs too, and must: gemini-2.5-flash is what the
agent loop was built and verified against, but it is retired on the API-key
endpoint and 404s for keys issued after its cutoff.
"""
from __future__ import annotations

import httpx
from loguru import logger

from app.config import settings

_VERTEX_GENERATE = (
    "https://aiplatform.googleapis.com/v1/projects/{project}"
    "/locations/global/publishers/google/models/{model}:generateContent"
)
_VERTEX_EMBED = (
    "https://{location}-aiplatform.googleapis.com/v1/projects/{project}"
    "/locations/{location}/publishers/google/models/{model}:predict"
)
_AISTUDIO_GENERATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_AISTUDIO_EMBED = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"

# batchEmbedContents refuses more than 100 per call ("at most 100 requests can
# be in one batch"). Gemini Enterprise's :predict has no such cap, but one number that
# works on both is worth more than squeezing a few calls out of one path.
MAX_EMBED_BATCH = 100

_adc_available: bool | None = None


def _has_adc() -> bool:
    """Whether Application Default Credentials resolve on this machine.

    Cached: google.auth.default() hits the metadata server on Cloud Run and we
    do not want that on every call. A failure here is not an error — it just
    means this deployment has no GCP identity and belongs on the key path.
    """
    global _adc_available
    if _adc_available is None:
        try:
            import google.auth

            google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            _adc_available = True
        except Exception as e:  # noqa: BLE001 — any failure means "no ADC here"
            logger.info("No GCP credentials found ({}); using the API key path", type(e).__name__)
            _adc_available = False
    return _adc_available


def resolve_backend() -> str:
    """Return "aistudio" or "vertex".

    LLM_BACKEND pins it. On "auto" the API key wins whenever one is set, because
    that is the path a clone of this repo can actually authenticate; the other is
    opt-in for the one machine that has a project.
    """
    choice = (settings.LLM_BACKEND or "auto").strip().lower()
    if choice in ("vertex", "aistudio"):
        return choice
    if settings.GEMINI_API_KEY:
        return "aistudio"
    if settings.GCP_PROJECT_ID and _has_adc():
        return "vertex"
    return "aistudio"


def orchestrator_model() -> str:
    """The function-calling model, for whichever backend is resolved."""
    return (
        settings.VERTEX_ORCHESTRATOR_MODEL
        if resolve_backend() == "vertex"
        else settings.ORCHESTRATOR_MODEL
    )


def generate_content_target(model: str) -> tuple[str, dict[str, str]]:
    """(url, headers) for a generateContent POST. The payload is unchanged."""
    if resolve_backend() == "vertex":
        from app.agents.vertex_auth import get_vertex_access_token

        return (
            _VERTEX_GENERATE.format(project=settings.GCP_PROJECT_ID, model=model),
            {"Authorization": f"Bearer {get_vertex_access_token()}"},
        )
    # Header, not ?key=: httpx puts the query string in exception messages, so
    # a key in the URL ends up in the logs on every failed call.
    return _AISTUDIO_GENERATE.format(model=model), {"x-goog-api-key": settings.GEMINI_API_KEY}


async def embed_texts(texts: list[str], task_type: str) -> list[list[float]]:
    """Embed a batch, returning one vector per input in the same order.

    task_type is RETRIEVAL_DOCUMENT for indexed content (student profiles) or
    RETRIEVAL_QUERY for the search query (the JD) — the matching is asymmetric,
    and both backends take the same two names.

    Raises on failure; the caller owns the decision to fall back to TF-IDF.
    """
    model = settings.EMBEDDING_MODEL

    if resolve_backend() == "vertex":
        from app.agents.vertex_auth import get_vertex_access_token

        url = _VERTEX_EMBED.format(
            location=settings.VERTEX_EMBEDDING_LOCATION,
            project=settings.GCP_PROJECT_ID,
            model=model,
        )
        headers = {"Authorization": f"Bearer {get_vertex_access_token()}"}
        payload = {"instances": [{"content": t, "task_type": task_type} for t in texts]}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            return [p["embeddings"]["values"] for p in resp.json()["predictions"]]

    payload = {
        "requests": [
            {"model": f"models/{model}", "content": {"parts": [{"text": t}]}, "taskType": task_type}
            for t in texts
        ]
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            _AISTUDIO_EMBED.format(model=model),
            headers={"x-goog-api-key": settings.GEMINI_API_KEY},
            json=payload,
        )
        resp.raise_for_status()
        return [e["values"] for e in resp.json()["embeddings"]]
