"""
JD Analyst Agent — uses Gemini to extract structured info from a job description.
"""
import json
from typing import Any
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage
from app.config import settings
from loguru import logger

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


def get_llm(pro: bool = False):
    """Use pro model for JD parsing (quality critical), lite for everything else."""
    model = settings.GEMINI_MODEL_PRO if pro else settings.GEMINI_MODEL
    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=settings.GEMINI_API_KEY,
        temperature=0.1,
    )


async def analyze_jd(jd_text: str) -> dict[str, Any]:
    """
    Parse a raw JD text and return a structured JSON dict.
    Falls back to a rule-based extractor if LLM fails.
    """
    llm = get_llm(pro=True)  # JD parsing = quality critical → use pro model
    messages = [
        SystemMessage(content=JD_SYSTEM_PROMPT),
        HumanMessage(content=f"Extract information from this Job Description:\n\n{jd_text}"),
    ]

    try:
        response = await llm.ainvoke(messages)
        text = response.content.strip()
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
    llm = get_llm()
    missing_required = [s for s in required_skills if s.lower() not in [x.lower() for x in student_skills]]
    missing_preferred = [s for s in preferred_skills if s.lower() not in [x.lower() for x in student_skills]]

    prompt = f"""A student applying for the role of {role} has the following skills: {student_skills}.
Required skills they are missing: {missing_required}.
Preferred skills they could add: {missing_preferred}.

Write a concise, actionable skill-gap analysis (3-5 bullet points) with specific learning resources or timelines.
Be encouraging but realistic. Format as plain text, not JSON."""

    response = await llm.ainvoke([HumanMessage(content=prompt)])
    return response.content.strip()


async def explain_match(
    student_profile: dict,
    jd_parsed: dict,
    score: float,
) -> dict:
    """Generate a human-readable explanation for why a student matched (or didn't)."""
    llm = get_llm()
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
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        text = response.content.strip()
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
