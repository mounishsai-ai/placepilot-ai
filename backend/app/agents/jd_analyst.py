"""
JD Analyst Agent — uses Gemini to extract structured info from a job description.

Calls Gemini directly via REST (same pattern matcher_agent.py already uses for
embeddings) instead of langchain-google-genai, which is documented there to
hang ~60s and then 504 under this project's pinned version. That hang is what
was silently stalling generate_all_explanations mid-pipeline.
"""
import asyncio
import json
from typing import Any
import httpx
from app.config import settings
from loguru import logger

GEMINI_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

JD_SYSTEM_PROMPT = """You are an expert HR analyst AI. 
Your job is to extract structured information from job descriptions provided by companies for campus placements.
Always respond with valid JSON only — no markdown, no extra text.

Extract the following fields:
- role: (string) job title / role name
- package_lpa: (float) CTC in LPA, null if not mentioned
- bond_years: (float) service bond in years, 0 if none
- location: (string) work location(s)
- work_mode: "remote" | "hybrid" | "onsite"
- min_cgpa: (float) minimum CGPA required, null if not mentioned
- max_backlogs: (int) max allowed backlogs, 0 if none allowed
- allowed_branches: (list[str]) eligible branches, e.g. ["CSE","IT","ECE"], empty list means all
- required_skills: (list[str]) must-have technical skills
- preferred_skills: (list[str]) good-to-have skills
- experience_required: (string) "fresher" | "0-1yr" | "1-2yr" etc.
- job_description_summary: (string) 2-3 sentence summary
- roles_and_responsibilities: (list[str]) key responsibilities
- selection_process: (list[str]) rounds in order, e.g. ["Aptitude Test","Technical Interview","HR Interview"]
- deadline: (string | null) application deadline if mentioned, ISO format
- bond_details: (string) any bond/return-of-bond clause details
"""


async def _generate_content(
    prompt: str,
    system_prompt: str | None = None,
    pro: bool = False,
    temperature: float = 0.1,
    retries: int = 2,
) -> str:
    """Call Gemini generateContent directly via REST, with retry on transient failure.

    Use pro model for JD parsing (quality critical), lite for everything else.
    """
    model = settings.GEMINI_MODEL_PRO if pro else settings.GEMINI_MODEL
    url = GEMINI_GENERATE_URL.format(model=model)
    payload: dict[str, Any] = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature},
    }
    if system_prompt:
        payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}

    for attempt in range(retries + 1):
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(url, params={"key": settings.GEMINI_API_KEY}, json=payload)
                resp.raise_for_status()
                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            if attempt < retries:
                wait = 2 ** attempt
                logger.warning(f"Gemini generateContent attempt {attempt+1} failed: {e}. Retrying in {wait}s...")
                await asyncio.sleep(wait)
            else:
                raise


async def analyze_jd(jd_text: str) -> dict[str, Any]:
    """
    Parse a raw JD text and return a structured JSON dict.
    Falls back to a rule-based extractor if LLM fails.
    """
    try:
        text = await _generate_content(
            prompt=f"Extract information from this Job Description:\n\n{jd_text}",
            system_prompt=JD_SYSTEM_PROMPT,
            pro=True,  # JD parsing = quality critical → use pro model
        )
        text = text.strip()
        # strip possible markdown code fences
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text)
        logger.info(f"JD analysis complete: role={parsed.get('role')}, package={parsed.get('package_lpa')}")
        return parsed
    except Exception as e:
        logger.error(f"JD analysis failed: {e}")
        return _fallback_jd_extract(jd_text)


def _fallback_jd_extract(jd_text: str) -> dict[str, Any]:
    """Rule-based fallback when LLM is unavailable."""
    import re
    text_lower = jd_text.lower()

    cgpa_match = re.search(r"cgpa[:\s>]+(\d+\.?\d*)", text_lower)
    pkg_match = re.search(r"(\d+\.?\d*)\s*(lpa|lakh|lakhs)", text_lower)
    branches = []
    for b in ["cse", "it", "ece", "eee", "me", "ce", "mca", "msc"]:
        if b in text_lower:
            branches.append(b.upper())

    return {
        "role": "Software Engineer",
        "package_lpa": float(pkg_match.group(1)) if pkg_match else None,
        "bond_years": 0,
        "location": "India",
        "work_mode": "hybrid",
        "min_cgpa": float(cgpa_match.group(1)) if cgpa_match else 6.0,
        "max_backlogs": 0,
        "allowed_branches": branches or ["CSE", "IT", "ECE"],
        "required_skills": [],
        "preferred_skills": [],
        "experience_required": "fresher",
        "job_description_summary": jd_text[:200],
        "roles_and_responsibilities": [],
        "selection_process": ["Aptitude Test", "Technical Interview", "HR Interview"],
        "deadline": None,
        "bond_details": "",
        "_fallback": True,
    }


async def generate_skill_gap_advice(
    student_skills: list[str],
    required_skills: list[str],
    preferred_skills: list[str],
    role: str,
) -> str:
    """Generate personalised skill-gap advice for a student."""
    missing_required = [s for s in required_skills if s.lower() not in [x.lower() for x in student_skills]]
    missing_preferred = [s for s in preferred_skills if s.lower() not in [x.lower() for x in student_skills]]

    prompt = f"""A student applying for the role of {role} has the following skills: {student_skills}.
Required skills they are missing: {missing_required}.
Preferred skills they could add: {missing_preferred}.

Write a concise, actionable skill-gap analysis (3-5 bullet points) with specific learning resources or timelines.
Be encouraging but realistic. Format as plain text, not JSON."""

    text = await _generate_content(prompt=prompt)
    return text.strip()


async def explain_match(
    student_profile: dict,
    jd_parsed: dict,
    score: float,
) -> dict:
    """Generate a human-readable explanation for why a student matched (or didn't)."""
    prompt = f"""You are helping a placement officer understand why a student was matched to a job.

Student profile:
- Name: {student_profile.get('name')}
- CGPA: {student_profile.get('cgpa')}
- Branch: {student_profile.get('branch')}
- Skills: {[s['skill'] for s in student_profile.get('skills', [])]}

Job Requirements:
- Role: {jd_parsed.get('role')}
- Min CGPA: {jd_parsed.get('min_cgpa')}
- Required Skills: {jd_parsed.get('required_skills')}
- Preferred Skills: {jd_parsed.get('preferred_skills')}
- Allowed Branches: {jd_parsed.get('allowed_branches')}

Match Score: {score:.2%}

Provide a JSON response with:
- strengths: list of 2-3 key matching points
- gaps: list of 0-2 areas where student falls short
- verdict: "strong match" | "good match" | "marginal match"
- one_liner: single sentence summary for the dashboard
"""
    try:
        text = await _generate_content(prompt=prompt)
        text = text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        logger.error(f"explain_match failed: {e}")
        return {
            "strengths": ["Profile meets basic requirements"],
            "gaps": [],
            "verdict": "good match",
            "one_liner": f"Matched with {score:.0%} similarity score.",
        }


# ─── Is this actually a job description? ─────────────────────────────────────

def jd_is_usable(parsed: dict | None) -> tuple[bool, str]:
    """Whether a parsed JD carries enough to screen anyone against.

    The parser itself is honest about junk input: given "abc" or "how are you"
    it returns nulls and empty lists rather than inventing a role. The danger is
    what the pipeline did next. With no skills to match on and no criteria to
    filter by, check_eligibility passes everyone and rank_candidates orders them
    by embedding noise — scores landed within 0.003 of each other, with a 5.88
    CGPA above a 9.92. The run still reached shortlist_pending and asked a TPO
    to approve 20 candidates chosen against nothing, each with a fluent
    justification. A confident wrong answer is worse than a refusal, so the
    pipeline stops here instead.

    Role or skills is the bar: a real posting has at least one, and neither
    survives text that was never a job description.

    Returns (usable, reason) — reason is empty when usable.
    """
    if not parsed:
        return False, "The job description could not be read at all."

    role = (parsed.get("role") or "").strip() if isinstance(parsed.get("role"), str) else ""
    skills = parsed.get("required_skills") or []
    if role or skills:
        return True, ""

    return False, (
        "This does not read as a job description — no role and no required "
        "skills could be found in it. Nothing was shortlisted, because there "
        "is nothing to match candidates against. Paste the full JD and run it "
        "again."
    )
