"""
Matcher Agent — embeds student profiles + JD, finds top-k matches via ChromaDB.
"""
import json
from typing import Any
import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from app.config import settings
from app.agents.jd_analyst import explain_match
from loguru import logger


def get_embedder():
    return GoogleGenerativeAIEmbeddings(
        model=settings.EMBEDDING_MODEL,
        google_api_key=settings.GEMINI_API_KEY,
    )


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

    embedder = get_embedder()
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

    # Batch embed (ChromaDB handles embedding internally via embedding function,
    # but we use Google embeddings directly)
    batch_size = 50
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i : i + batch_size]
        batch_ids = ids[i : i + batch_size]
        batch_meta = metadatas[i : i + batch_size]

        embeddings = await embedder.aembed_documents(batch_texts)
        collection.add(
            ids=batch_ids,
            embeddings=embeddings,
            documents=batch_texts,
            metadatas=batch_meta,
        )

    logger.info(f"Indexed {len(students)} students for drive {drive_id}")


async def match_students_to_jd(
    drive_id: str,
    jd_parsed: dict,
    top_k: int = 50,
    generate_explanations: bool = True,
) -> list[dict[str, Any]]:
    """
    Query ChromaDB with the JD embedding and return ranked student matches.
    """
    client = get_chroma_client()
    collection_name = f"drive_{drive_id}_students"

    try:
        collection = client.get_collection(collection_name)
    except Exception as e:
        logger.error(f"Collection {collection_name} not found: {e}")
        return []

    embedder = get_embedder()
    jd_text = _jd_to_text(jd_parsed)
    jd_embedding = await embedder.aembed_query(jd_text)

    results = collection.query(
        query_embeddings=[jd_embedding],
        n_results=min(top_k, collection.count()),
        include=["distances", "metadatas", "documents"],
    )

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
    Only explain top 20 to save API quota.
    """
    top_matches = matches[:20]
    for match in top_matches:
        student = students_by_id.get(match["student_id"])
        if student:
            explanation = await explain_match(student, jd_parsed, match["score"])
            match["explanation"] = explanation
    return matches
