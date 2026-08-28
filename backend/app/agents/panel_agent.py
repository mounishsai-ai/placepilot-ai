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

from app.agents.vertex_json import generate_json as _generate_json_raw


async def _generate_json(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    return await _generate_json_raw(system_prompt, user_prompt, caller="panel_agent")


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


SESSION_NOTE_SYSTEM = """You clean up an interviewer's rough notes about an interview
session as a whole (not about any one candidate) into clear, well-organised prose.

Often dictated by voice between interviews, so the input may run on or repeat itself.
Fix grammar and punctuation, organise distinct points as short bullet-style sentences
if there are several, keep it factual. Never invent a detail that is not in the notes,
and never add an opinion or recommendation — this is not about any one candidate.

Respond with JSON only:
{"polished": "the cleaned-up notes, ready to save"}
"""


async def polish_session_note(raw_notes: str) -> str:
    """Rough (often dictated) session-wide notes -> clean prose. No scoring, no
    recommendation -- there is no single candidate for either to attach to."""
    result = await _generate_json(SESSION_NOTE_SYSTEM, raw_notes)
    polished = result.get("polished") if result else None
    return polished.strip() if isinstance(polished, str) and polished.strip() else raw_notes


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
