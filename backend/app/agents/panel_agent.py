"""
Panel Agent — the two places an interviewer's day has dead time in it.

Before the interview: the panel member gets a candidate they've never seen,
five minutes before they walk in. `generate_prep_brief` reads the student's
profile against the drive's parsed JD and writes what's worth asking — which
is a genuinely different job from matching, because a *match* explains why
someone qualified and a *brief* has to surface where they might not.

After it: the verdict exists as three lines of shorthand in someone's
notebook and never becomes structured data. `structure_debrief` turns those
notes into a scorecard without making the interviewer fill in a form.

Both are single-shot generations, deliberately. The orchestrator's tool loop
is the right shape when the model has to *decide* something over several
steps; here it has all the input up front and produces one document. Wiring
these through a tool loop would add latency and failure modes for nothing.
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


async def _generate_json(system_prompt: str, user_prompt: str) -> dict[str, Any]:
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
        logger.warning("panel_agent: no text in Vertex response: {}", data)
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
        logger.warning("panel_agent: unparseable JSON: {}", text[:300])
        return {}


# ─── Before the interview ────────────────────────────────────────────────────

PREP_SYSTEM = """You brief a campus interview panel on the candidate they are about to meet.

You are given the candidate's profile and the parsed job description they applied against.
Write the briefing an experienced interviewer would want: short, specific, and honest about
what is NOT evidenced. Never invent a fact that is not in the profile.

Respond with JSON only:
{
  "headline": "one sentence placing this candidate — what they are, in plain words",
  "strengths": ["skill or signal backed by something in the profile", ...],   // max 4
  "probe": ["a gap, a claim with no evidence behind it, or a risk worth testing", ...],  // max 4
  "questions": [
     {"q": "the question to ask", "why": "what a good answer would tell the panel"},
     ...
  ]   // exactly 3 or 4, ordered easiest to hardest
}

Rules:
- "probe" must be things the profile leaves open, not generic interview advice.
- If the candidate lists a skill the JD wants but shows no project or experience using it,
  that belongs in "probe", not "strengths".
- Questions must be answerable in an interview, not take-home exercises."""


async def generate_prep_brief(
    student: dict[str, Any], jd_parsed: dict[str, Any] | None, role_title: str
) -> dict[str, Any]:
    """A briefing on one candidate, for the panel member about to interview them."""
    prompt = (
        f"ROLE BEING INTERVIEWED FOR: {role_title}\n\n"
        f"PARSED JOB DESCRIPTION:\n{json.dumps(jd_parsed or {}, indent=2)}\n\n"
        f"CANDIDATE PROFILE:\n{json.dumps(student, indent=2, default=str)}"
    )
    brief = await _generate_json(PREP_SYSTEM, prompt)
    if not brief:
        # A failed generation must not read as "this candidate has no strengths".
        return {
            "headline": "The briefing could not be generated — interview from the profile below.",
            "strengths": [], "probe": [], "questions": [], "degraded": True,
        }
    return brief


# ─── After the interview ─────────────────────────────────────────────────────

DEBRIEF_SYSTEM = """You turn an interviewer's rough notes into a structured scorecard.

You are given free-text notes written immediately after a campus interview, plus the role.
Your job is to organise what the interviewer said — NOT to form your own opinion of the
candidate. Every rating must be traceable to something in the notes.

Respond with JSON only:
{
  "summary": "2-3 sentences restating the interviewer's assessment in clean prose",
  "ratings": [
     {"competency": "Technical depth", "score": 1-10, "basis": "the words in the notes this came from"},
     ...
  ],   // only competencies the notes actually speak to — 2 to 5 of them
  "recommendation": "selected" | "rejected" | "on_hold",
  "confidence": "high" | "medium" | "low",
  "unclear": ["anything the notes leave genuinely ambiguous", ...]
}

Rules:
- If the notes do not mention a competency, leave it out. Do not pad to five.
- "basis" must quote or closely paraphrase the notes — never your own inference.
- Set confidence to "low" when the notes are too thin to support the recommendation,
  and say so in "unclear". An interviewer needs to know when you are guessing."""


async def structure_debrief(notes: str, role_title: str) -> dict[str, Any]:
    """Rough post-interview notes → a scorecard the panel can check and file."""
    prompt = f"ROLE: {role_title}\n\nINTERVIEWER'S NOTES:\n{notes}"
    card = await _generate_json(DEBRIEF_SYSTEM, prompt)
    if not card:
        return {
            "summary": "", "ratings": [], "recommendation": "on_hold",
            "confidence": "low", "unclear": ["The scorecard could not be generated."],
            "degraded": True,
        }
    return card
