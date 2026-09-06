"""Turn a TPO's plain-English instruction into a shortlist selection.

The model's only job is to read the sentence and emit a filter spec. It never
sees the candidate list and never names a student. Python applies the spec to
the ranked candidates and decides who ends up selected.

That split is the point. "Shortlist the top 15 CSE students with no backlogs" is
a filter, not a judgement, and a filter that a model applied by hand would be
unauditable, non-repeatable, and wrong in ways nobody could see — the same
reason the analytics numbers are plain SQL. Here the model does the part it is
good at (language) and code does the part that has to be exactly right.

The TPO still approves the result; nothing here writes to the database.
"""
from __future__ import annotations

from typing import Any

from loguru import logger

from app.agents.gemini_json import generate_json

SELECT_SYSTEM = """You convert a placement officer's instruction about an interview shortlist
into a filter, as JSON. You never choose individual students — you describe the rule.

Respond with JSON only:
{"action": "replace|add|keep",
 "branches": ["CSE","IT"] or null,
 "min_cgpa": number or null,
 "max_cgpa": number or null,
 "max_backlogs": integer or null,
 "top_n": integer or null,
 "summary": "one short sentence describing the rule you applied"}

action — in every case the filter describes who should REMAIN, never who to throw away:
- "replace" — the instruction describes the whole shortlist from scratch
              ("shortlist the top 15 CSE students")
- "add"     — it widens the current selection
              ("also include the ECE students")
- "keep"    — it narrows the current selection to those matching the filter
              ("drop anyone with active backlogs" -> keep max_backlogs 0;
               "only CSE and IT"                  -> keep branches CSE, IT)

Never describe who to exclude. "No backlogs" is max_backlogs 0, not a rule about
students who have them.

Rules:
- Use null for anything the instruction does not mention. Do not invent thresholds.
- top_n counts from the best-ranked candidate downwards.
- Branch codes are short and uppercase: CSE, IT, ECE, EEE, ME, CE, MCA.
- If the instruction is not about filtering a shortlist at all, return
  {"action": "replace", "summary": "", "unclear": true} and no filter fields.
"""

_BRANCH_MAX = 12


def _as_number(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def _as_int(v: Any) -> int | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return int(v)


def apply_spec(spec: dict, candidates: list[dict], already: set[str]) -> tuple[set[str], str]:
    """Apply a validated filter spec to ranked candidates. Pure function."""
    branches = spec.get("branches")
    branches = (
        {str(b).strip().upper() for b in branches[:_BRANCH_MAX]}
        if isinstance(branches, list) and branches else None
    )
    min_cgpa, max_cgpa = _as_number(spec.get("min_cgpa")), _as_number(spec.get("max_cgpa"))
    max_backlogs, top_n = _as_int(spec.get("max_backlogs")), _as_int(spec.get("top_n"))

    ordered = sorted(candidates, key=lambda c: c.get("rank") or 10**6)
    matched: list[str] = []
    for c in ordered:
        if branches and str(c.get("branch") or "").strip().upper() not in branches:
            continue
        cgpa = _as_number(c.get("cgpa"))
        if min_cgpa is not None and (cgpa is None or cgpa < min_cgpa):
            continue
        if max_cgpa is not None and (cgpa is None or cgpa > max_cgpa):
            continue
        if max_backlogs is not None:
            backlogs = _as_int(c.get("backlogs_active")) or 0
            if backlogs > max_backlogs:
                continue
        matched.append(str(c["student_id"]))
        if top_n is not None and len(matched) >= top_n:
            break

    # The filter always describes who should remain, so the three actions are
    # just set operations on it. An action meaning "remove everyone matching"
    # reads naturally in English and inverts in code: "drop anyone with active
    # backlogs" produces the filter max_backlogs=0, and subtracting that set
    # removes precisely the students the TPO wanted to keep.
    action = str(spec.get("action") or "replace").lower()
    if action == "add":
        return already | set(matched), "add"
    if action == "keep":
        return already & set(matched), "keep"
    return set(matched), "replace"


async def select_by_instruction(instruction: str, candidates: list[dict], already: set[str]) -> dict:
    """Plain-English instruction -> the set of student_ids that should be selected."""
    try:
        spec = await generate_json(SELECT_SYSTEM, instruction, caller="shortlist_selector")
    except Exception as exc:  # noqa: BLE001 — surfaced to the TPO, not swallowed
        logger.warning("shortlist_selector: model call failed: {}", type(exc).__name__)
        return {"error": "Onyx is unavailable right now — try again in a moment."}

    if not spec or spec.get("unclear"):
        return {"error": "I could not read that as a shortlist instruction. Try something like "
                         "\"top 15 CSE and IT students with CGPA above 7.5\"."}

    filter_keys = ("branches", "min_cgpa", "max_cgpa", "max_backlogs", "top_n")
    if all(spec.get(k) in (None, [], "") for k in filter_keys):
        return {"error": "That did not name anything to filter on — try a branch, a CGPA, "
                         "a backlog limit, or how many to take."}

    selected, action = apply_spec(spec, candidates, already)
    return {
        "student_ids": sorted(selected),
        "count": len(selected),
        "action": action,
        "summary": str(spec.get("summary") or "").strip()[:200],
    }
