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
- Branch codes are short and uppercase: CSE, IT, ECE, EEE, ME, CE, MCA.
- top_n is a count of students, applied within whichever action is chosen. A bare
  quantity IS a valid instruction — do not call it unclear:
    "10 more"            -> {"action":"add","top_n":10}
    "another 40"         -> {"action":"add","top_n":40}
    "just the top 15"    -> {"action":"keep","top_n":15}
    "shortlist 25"       -> {"action":"replace","top_n":25}
  "more" and "another" always mean add, never replace.
- Only return {"action":"replace","summary":"","unclear":true} when the text is not
  an instruction about the shortlist at all ("how are you", "abc").
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

    # Which candidates the filter runs over depends on the action, and this is
    # what makes "10 more" mean the next ten rather than the top ten. Counting
    # top_n over the whole list would re-pick people who are already selected,
    # so a union adds nobody and the instruction appears to do nothing.
    action = str(spec.get("action") or "replace").lower()
    ordered = sorted(candidates, key=lambda c: c.get("rank") or 10**6)
    if action == "add":
        scope = [c for c in ordered if str(c["student_id"]) not in already]
    elif action == "keep":
        scope = [c for c in ordered if str(c["student_id"]) in already]
    else:
        scope = ordered

    matched: list[str] = []
    for c in scope:
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

    # The filter always describes who should remain, so the actions are set
    # operations on it. Note there is deliberately no "remove": that reads fine
    # in English and inverts in code — "drop anyone with active backlogs" gives
    # the filter max_backlogs=0, and subtracting that removes precisely the
    # students the TPO wanted to keep.
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
    # The instruction, the spec it became, and the size change — without these
    # a report of "it selected the wrong number" cannot be diagnosed from logs.
    logger.info(
        "shortlist_selector: {!r} -> {} | {} selected -> {}",
        instruction[:120], spec, len(already), len(selected),
    )
    return {
        "student_ids": sorted(selected),
        "count": len(selected),
        "action": action,
        "summary": str(spec.get("summary") or "").strip()[:200],
    }
