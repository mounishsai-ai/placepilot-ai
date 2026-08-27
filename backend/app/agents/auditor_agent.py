"""
Auditor — a second, independent model checking the orchestrator's pipeline
before a human is asked to approve it.

The orchestrator narrates its own reasoning as it goes ("eligibility checked,
looks good"), but nothing checks that narration against what the numbers
actually say — a rule set that silently no-ops still lets the model report
"eligibility checked" with a straight face. This runs as a separate Gemini
call, immediately before ask_human, given only the pipeline's factual record
(what criteria were applied and where they came from, how many students
survived, what the top matches scored). It is deliberately not given the
orchestrator's own conversation or narration — an auditor that reads the
story before the numbers just rubber-stamps the story.

A failed audit call degrades to "clear" rather than blocking the handoff:
the Auditor is a second opinion, not a gate the pipeline depends on to
function.
"""
import json
from typing import Any

from loguru import logger

from app.agents.vertex_json import generate_json

AUDITOR_SYSTEM = """You audit a college placement drive's eligibility-and-ranking pipeline
before a human (the placement officer, "TPO") approves its output. You are given only the
pipeline's factual record, not the other agent's narration of it — your job is to check the
numbers, not agree with a story about them.

Respond with JSON only:
{
  "verdict": "clear" | "flag",
  "concerns": ["short, specific, factual concern", ...],
  "note": "one sentence a TPO would want to read, whichever verdict"
}

Flag when the numbers themselves are suspicious, for example:
- eligibility criteria came from nowhere ("nothing — no criteria found") — every student passed by default
- eligible_count equals total_students (nothing was actually filtered), or equals 0
- criteria were inferred from the JD text rather than manually configured rules — branch names
  in particular are known to be written differently in JD text ("CSE") than on the student
  roster ("Computer Science & Engineering"), so an inferred branch filter can silently pass or
  reject the wrong students
- the top-ranked candidate's own score is low in absolute terms — a weak best match, not merely
  a short list
- ranked_count is far below eligible_count AND far below top_k_requested — that combination means
  candidates were silently dropped, not merely that the shortlist was capped by design. ranked_count
  landing at or near top_k_requested is the pipeline working as intended and is NOT a concern, even
  when eligible_count is much larger — a shortlist is supposed to be shorter than the eligible pool.
- ranked_count is zero

Do not flag on style, tone, or completeness of the shortlist. Silence about something not listed
above is not itself a concern. If nothing here looks wrong, return verdict "clear" with an empty
"concerns" list and a one-sentence "note" saying what you checked."""


async def audit_pipeline(summary: dict[str, Any]) -> dict[str, Any]:
    """summary is the factual record only — see orchestrator.py's ask_human handler
    for exactly what it contains."""
    prompt = json.dumps(summary, indent=2, default=str)
    result = await generate_json(AUDITOR_SYSTEM, prompt, caller="auditor_agent")
    if not result:
        logger.warning("auditor_agent: audit call failed, defaulting to clear")
        return {
            "verdict": "clear",
            "concerns": [],
            "note": "The audit could not be generated — proceeding without a second check.",
            "degraded": True,
        }
    result.setdefault("verdict", "clear")
    result.setdefault("concerns", [])
    result.setdefault("note", "")
    return result
