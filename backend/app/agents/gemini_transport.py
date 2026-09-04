"""Where a Gemini call is sent, and how it authenticates.

Two backends serve the same models and this module hides the difference:

  vertex     aiplatform.googleapis.com, authorised with an ADC bearer token and
             billed to a GCP project. No per-key daily request cap, which is
             why the original build used it — AI Studio's free tier would have
             hit its ceiling partway through a live demo.

  aistudio   generativelanguage.googleapis.com, authorised with an API key.
             Free, with a daily request cap. Fine once traffic is occasional
             rather than a room full of people hammering it at once.

That trade only pointed one way while the demo had to survive sustained live
use. It points the other way for a project that is deployed and then opened
occasionally, so the backend is selectable rather than compiled in.

`generateContent` takes byte-identical request and response JSON on both, so
callers just ask for a target (URL + headers) and post their existing payload.
Embeddings do NOT: Vertex uses :predict with an `instances` list, AI Studio
uses :batchEmbedContents with a `requests` list, and the responses nest the
vector differently. `embed_texts` normalises both to a plain list of vectors.
"""
from __future__ import annotations

import httpx
from loguru import logger

from app.config import settings

# ─── Endpoints ───────────────────────────────────────────────────────────────

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


# ─── Backend selection ───────────────────────────────────────────────────────

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
            logger.info("No GCP credentials found ({}); Gemini calls will use the API key path", type(e).__name__)
            _adc_available = False
    return _adc_available


def resolve_backend() -> str:
    """Return "vertex" or "aistudio".

    LLM_BACKEND pins it explicitly. On "auto" (the default) Vertex wins when a
    project and credentials are both present, because it has no daily cap;
    otherwise anything with an API key still works.
    """
    choice = (settings.LLM_BACKEND or "auto").strip().lower()
    if choice == "vertex":
        return "vertex"
    if choice == "aistudio":
        return "aistudio"
    if settings.GCP_PROJECT_ID and _has_adc():
        return "vertex"
    if settings.GEMINI_API_KEY:
        return "aistudio"
    # Neither is configured. Return vertex so the caller fails with a real
    # auth error naming the missing credential, rather than a confusing 400
    # from an unauthenticated key request.
    return "vertex"


# ─── generateContent ─────────────────────────────────────────────────────────

def generate_content_target(model: str) -> tuple[str, dict[str, str]]:
    """(url, headers) for a generateContent POST. The payload is unchanged."""
    if resolve_backend() == "aistudio":
        return (
            _AISTUDIO_GENERATE.format(model=model),
            {"x-goog-api-key": settings.GEMINI_API_KEY},
        )

    from app.agents.vertex_auth import get_vertex_access_token

    return (
        _VERTEX_GENERATE.format(project=settings.GCP_PROJECT_ID, model=model),
        {"Authorization": f"Bearer {get_vertex_access_token()}"},
    )


# ─── Embeddings ──────────────────────────────────────────────────────────────

async def embed_texts(texts: list[str], task_type: str) -> list[list[float]]:
    """Embed a batch, returning one vector per input in the same order.

    task_type is RETRIEVAL_DOCUMENT for indexed content (student profiles) or
    RETRIEVAL_QUERY for the search query (the JD) — the matching is asymmetric,
    and both backends take the same two names.

    Raises on failure; the caller owns the decision to fall back to TF-IDF.
    """
    model = settings.EMBEDDING_MODEL

    if resolve_backend() == "aistudio":
        url = _AISTUDIO_EMBED.format(model=model)
        headers = {"x-goog-api-key": settings.GEMINI_API_KEY}
        payload = {
            "requests": [
                {
                    "model": f"models/{model}",
                    "content": {"parts": [{"text": t}]},
                    "taskType": task_type,
                }
                for t in texts
            ]
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            return [e["values"] for e in resp.json()["embeddings"]]

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
