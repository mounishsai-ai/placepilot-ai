"""
Matcher Agent — embeds student profiles + JD, finds top-k matches via ChromaDB.

Embeddings go straight to Vertex AI's REST :predict endpoint (project-billed
quota, not the free per-API-key quota) — the free-tier generativelanguage.
googleapis.com path was hitting 429s at ~8 rapid batches/minute in production.
Falls back to TF-IDF if the REST call fails.
"""
import asyncio
import math
from typing import Any
from collections import Counter
import chromadb
import httpx
from chromadb.config import Settings as ChromaSettings
from app.config import settings
from app.agents.jd_analyst import explain_match
from app.agents.vertex_auth import get_vertex_access_token
from loguru import logger

VERTEX_EMBED_URL = (
    "https://{location}-aiplatform.googleapis.com/v1/projects/{project}"
    "/locations/{location}/publishers/google/models/{model}:predict"
)


async def _embed_texts_rest(texts: list[str], task_type: str) -> list[list[float]]:
    """Embed a batch of texts via Vertex AI's :predict endpoint.

    task_type must be RETRIEVAL_DOCUMENT for indexed content (student profiles)
    or RETRIEVAL_QUERY for the search query (the JD) — matching is asymmetric.
    """
    model = settings.EMBEDDING_MODEL
    url = VERTEX_EMBED_URL.format(
        location=settings.VERTEX_EMBEDDING_LOCATION,
        project=settings.GCP_PROJECT_ID,
        model=model,
    )
    token = get_vertex_access_token()
    payload = {
        "instances": [{"content": t, "task_type": task_type} for t in texts]
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=payload)
        resp.raise_for_status()
        data = resp.json()
        return [p["embeddings"]["values"] for p in data["predictions"]]


def get_chroma_client():
    return chromadb.PersistentClient(
        path=settings.CHROMA_PERSIST_DIR,
        settings=ChromaSettings(anonymized_telemetry=False),
    )


def _student_to_text(student: dict) -> str:
    """Convert student dict to rich text for embedding."""
    skills = [s.get("skill", "") for s in student.get("skills", [])]
    return (
        f"Name: {student.get('name', '')}. "
        f"Branch: {student.get('branch', '')}. "
        f"CGPA: {student.get('cgpa', 0)}. "
        f"Skills: {', '.join(skills)}. "
        f"Summary: {student.get('skills_summary', '')}. "
        f"Batch: {student.get('batch', '')}."
    )


def _jd_to_text(jd_parsed: dict) -> str:
    """Convert parsed JD to text for embedding."""
    return (
        f"Role: {jd_parsed.get('role', '')}. "
        f"Required Skills: {', '.join(jd_parsed.get('required_skills', []))}. "
        f"Preferred Skills: {', '.join(jd_parsed.get('preferred_skills', []))}. "
        f"Summary: {jd_parsed.get('job_description_summary', '')}. "
        f"Responsibilities: {'. '.join(jd_parsed.get('roles_and_responsibilities', []))}."
    )


# ─── TF-IDF Fallback ─────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    return text.lower().split()

def _tfidf_score(doc_tokens: list[str], query_tokens: list[str]) -> float:
    """Simple cosine similarity using TF overlap."""
    if not doc_tokens or not query_tokens:
        return 0.0
    query_set = set(query_tokens)
    doc_counter = Counter(doc_tokens)
    overlap = sum(doc_counter[t] for t in query_set if t in doc_counter)
    norm = math.sqrt(len(doc_tokens)) * math.sqrt(len(query_tokens))
    return overlap / norm if norm > 0 else 0.0

def _fallback_match(students: list[dict], jd_parsed: dict, top_k: int) -> list[dict]:
    """TF-IDF keyword matching — used when Google embeddings fail/timeout."""
    logger.warning("Using TF-IDF fallback for matching (Google embeddings unavailable)")
    jd_text = _jd_to_text(jd_parsed)
    jd_tokens = _tokenize(jd_text)

    scored = []
    for s in students:
        doc_text = _student_to_text(s)
        score = _tfidf_score(_tokenize(doc_text), jd_tokens)
        # Bonus for CGPA
        cgpa = float(s.get("cgpa", 0))
        score += (cgpa / 10) * 0.15
        scored.append((s, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [
        {
            "student_id": s["id"],
            "name": s.get("name", ""),
            "score": round(score, 4),
            "rank": i + 1,
            "explanation": None,
        }
        for i, (s, score) in enumerate(scored[:top_k])
    ]


# ─── Embed with retry ──────────────────────────────────────────────────────

async def _embed_batch_with_retry(texts: list[str], task_type: str, retries: int = 2) -> list:
    """Embed a batch via direct REST, with retry on transient failure."""
    for attempt in range(retries + 1):
        try:
            return await _embed_texts_rest(texts, task_type)
        except Exception as e:
            if attempt < retries:
                wait = 2 ** attempt  # 1s, 2s backoff
                logger.warning(f"Embedding attempt {attempt+1} failed: {e}. Retrying in {wait}s...")
                await asyncio.sleep(wait)
            else:
                raise


# ─── Main Functions ───────────────────────────────────────────────────────────

async def index_students_for_drive(
    drive_id: str,
    students: list[dict],
) -> None:
    """Embed and store eligible student profiles in ChromaDB for a specific drive."""
    client = get_chroma_client()
    collection_name = f"drive_{drive_id}_students"

    # Delete existing collection for this drive
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass

    collection = client.create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )

    texts = [_student_to_text(s) for s in students]
    ids = [s["id"] for s in students]
    metadatas = [
        {
            "student_id": s["id"],
            "name": s.get("name", ""),
            "cgpa": str(s.get("cgpa", 0)),
            "branch": s.get("branch", ""),
        }
        for s in students
    ]

    # Vertex accepted all 201 students in a single :predict call in ~9s when
    # tested live — batches of 200 mean a typical drive needs just 1-2 calls
    # instead of the 11 that used to blow through the per-minute quota.
    BATCH_SIZE = 200
    embedded_ok = True
    for i in range(0, len(texts), BATCH_SIZE):
        batch_texts = texts[i: i + BATCH_SIZE]
        batch_ids = ids[i: i + BATCH_SIZE]
        batch_meta = metadatas[i: i + BATCH_SIZE]

        try:
            embeddings = await _embed_batch_with_retry(batch_texts, task_type="RETRIEVAL_DOCUMENT")
            collection.add(
                ids=batch_ids,
                embeddings=embeddings,
                documents=batch_texts,
                metadatas=batch_meta,
            )
            logger.debug(f"Embedded batch {i//BATCH_SIZE + 1}/{math.ceil(len(texts)/BATCH_SIZE)}")
        except Exception as e:
            logger.error(f"Embedding batch {i}-{i+BATCH_SIZE} failed permanently: {e}")
            embedded_ok = False
            break

    if embedded_ok:
        logger.info(f"Indexed {len(students)} students for drive {drive_id} via Gemini embeddings")
    else:
        logger.warning(f"Partial index for drive {drive_id} — will use TF-IDF fallback")

    return embedded_ok


async def match_students_to_jd(
    drive_id: str,
    jd_parsed: dict,
    top_k: int = 50,
    students: list[dict] | None = None,   # needed for TF-IDF fallback
) -> list[dict[str, Any]]:
    """
    Query ChromaDB with the JD embedding and return ranked student matches.
    Falls back to TF-IDF keyword matching if embeddings unavailable.
    """
    client = get_chroma_client()
    collection_name = f"drive_{drive_id}_students"

    try:
        collection = client.get_collection(collection_name)
    except Exception as e:
        logger.error(f"Collection {collection_name} not found: {e}")
        if students:
            return _fallback_match(students, jd_parsed, top_k)
        return []

    if collection.count() == 0:
        logger.warning(f"Empty collection for drive {drive_id}, using TF-IDF fallback")
        if students:
            return _fallback_match(students, jd_parsed, top_k)
        return []

    jd_text = _jd_to_text(jd_parsed)

    try:
        jd_embedding = await _embed_batch_with_retry(
            [jd_text],   # embed as single document then use as query
            task_type="RETRIEVAL_QUERY",
        )
        # Use first embedding as query
        results = collection.query(
            query_embeddings=[jd_embedding[0]],
            n_results=min(top_k, collection.count()),
            include=["distances", "metadatas", "documents"],
        )
    except Exception as e:
        logger.error(f"JD embedding failed: {e}. Using TF-IDF fallback.")
        if students:
            return _fallback_match(students, jd_parsed, top_k)
        return []

    matches = []
    for i, (doc, dist, meta) in enumerate(
        zip(
            results["documents"][0],
            results["distances"][0],
            results["metadatas"][0],
        )
    ):
        # ChromaDB cosine distance → similarity
        score = 1 - dist
        matches.append(
            {
                "student_id": meta["student_id"],
                "name": meta["name"],
                "score": round(score, 4),
                "rank": i + 1,
                "explanation": None,
            }
        )

    logger.info(f"Matched {len(matches)} students for drive {drive_id}")
    return matches


async def generate_all_explanations(
    matches: list[dict],
    students_by_id: dict[str, dict],
    jd_parsed: dict,
) -> list[dict]:
    """
    Enrich top-N matches with AI-generated explanations.
    Only explain top 5 to save API quota (was 20).
    """
    top_matches = matches[:5]
    for match in top_matches:
        student = students_by_id.get(match["student_id"])
        if student:
            try:
                explanation = await explain_match(student, jd_parsed, match["score"])
                match["explanation"] = explanation
            except Exception as e:
                logger.warning(f"Failed to explain match for {match['student_id']}: {e}")
    return matches
