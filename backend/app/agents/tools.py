"""
Tool registry — the existing agent functions, described to Gemini as callable
tools instead of being called directly by Python. This is the piece that makes
supervisor.py a workflow and orchestrator.py an agent: here, the MODEL decides
which of these to call and with what arguments, not a hardcoded graph.add_edge().

Tool results sent back to the model are deliberately small summaries (counts,
top-N) — large intermediate data (the full student roster, full match list)
lives in ToolContext instead, so token cost doesn't scale with roster size.
"""
from typing import Any
from sqlalchemy import select, delete, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    PlacementDrive, Student, EligibilityRule, EligibilityResult, MatchScore,
)
from app.agents.jd_analyst import analyze_jd
from app.agents.eligibility_agent import run_bulk_eligibility
from app.agents.matcher_agent import (
    index_students_for_drive, match_students_to_jd, generate_all_explanations,
)
from loguru import logger


class ToolContext:
    """Per-run scratch space, not sent to the model."""

    def __init__(self, db: AsyncSession, drive_id: str):
        self.db = db
        self.drive_id = drive_id
        self.drive: PlacementDrive | None = None
        self.rules: list[dict] = []
        self.jd_parsed: dict | None = None
        self.all_students: list[dict] = []
        self.eligible_students: list[dict] = []
        self.match_results: list[dict] = []
        # Set by _exec_check_eligibility / _exec_rank_candidates, read by the
        # auditor before ask_human — the executor's return value is a trimmed
        # summary for the model, this is the fuller record the audit needs.
        self.criteria_from: str | None = None
        self.criteria_applied: list[str] = []
        self.top_k_requested: int | None = None


async def _load_students(db: AsyncSession) -> list[dict]:
    result = await db.execute(select(Student).options(selectinload(Student.skills)))
    students = result.scalars().all()
    return [
        {
            "id": s.id, "name": s.name, "roll_no": s.roll_no, "email": s.email,
            "branch": s.branch, "batch": s.batch, "cgpa": s.cgpa,
            "backlogs_active": s.backlogs_active, "backlogs_historical": s.backlogs_historical,
            "attendance_pct": s.attendance_pct, "skills_summary": s.skills_summary,
            "skills": [{"skill": sk.skill, "proficiency": sk.proficiency} for sk in s.skills],
        }
        for s in students
    ]


# ─── Tool declarations (Gemini function-calling schema) ───────────────────────

TOOL_DECLARATIONS = [
    {
        "name": "get_drive_context",
        "description": "Fetch the drive's title, raw job description text, current status, and eligibility rules. Call this first if you don't already have them.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "parse_jd",
        "description": "Parse the drive's raw job description into structured fields: role, package, required/preferred skills, min CGPA, allowed branches. Must run before check_eligibility.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "check_eligibility",
        "description": "Run all eligibility rules against every student in the college and report how many are eligible. Must run after parse_jd, before rank_candidates.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "rank_candidates",
        "description": "Rank the eligible students against the parsed JD using AI semantic matching, and generate explanations for the top candidates. Must run after check_eligibility.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "top_k": {"type": "INTEGER", "description": "How many top candidates to shortlist. Default 20."},
            },
        },
    },
    {
        "name": "select_candidates",
        "description": (
            "Find students matching one plain criterion and propose them for the shortlist — for "
            "when the TPO names a specific person or rule (\"approve anyone with 99%+ attendance\", "
            "\"include Rahul Sharma\", \"add students within 0.5 CGPA of the cutoff even though they "
            "didn't pass eligibility\"). Searches the FULL student roster, not just students who "
            "passed check_eligibility — this is how a TPO overrides the automatic cutoff for a "
            "specific person or group. Matches are proposed and pre-checked for the TPO to confirm on "
            "the shortlist review screen; this never finalizes anything by itself.\n\n"
            "By name, use 'contains' with just what the TPO typed (first name alone is fine — do not "
            "require a surname or exact match). If that matches MORE THAN ONE student, nobody is added "
            "yet — the result comes back with each candidate's name, roll_no, branch, and cgpa. Call "
            "ask_human with one option per candidate formatted 'Name — Roll No' so the TPO can click "
            "the right one, then once they answer, call select_candidates again with field='roll_no', "
            "op='eq', value=<the roll number they picked> to add exactly that student."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "field": {
                    "type": "STRING",
                    "enum": ["cgpa", "attendance_pct", "backlogs_active", "name", "branch", "roll_no"],
                    "description": "Which student attribute to filter on. Use roll_no to resolve a name ambiguity to one exact student.",
                },
                "op": {
                    "type": "STRING",
                    "enum": ["gte", "lte", "gt", "lt", "eq", "contains"],
                    "description": "Comparison to apply. Use 'contains' for a partial/case-insensitive name or branch match.",
                },
                "value": {
                    "type": "STRING",
                    "description": "The comparison value as text (numbers are parsed for numeric fields).",
                },
            },
            "required": ["field", "op", "value"],
        },
    },
    {
        "name": "ask_human",
        "description": "Pause and ask the TPO (a human placement officer) a question before proceeding. Use this once ranking is complete and you have a clear shortlist recommendation ready for approval — never finalize a shortlist without asking.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "question": {"type": "STRING", "description": "The question to ask the TPO."},
                "options": {
                    "type": "ARRAY", "items": {"type": "STRING"},
                    "description": "Suggested answer options, if applicable.",
                },
            },
            "required": ["question"],
        },
    },
]


# ─── Tool executors ────────────────────────────────────────────────────────────

async def _exec_get_drive_context(ctx: ToolContext, args: dict) -> dict:
    result = await ctx.db.execute(select(PlacementDrive).where(PlacementDrive.id == ctx.drive_id))
    drive = result.scalar_one_or_none()
    if not drive:
        return {"error": f"drive {ctx.drive_id} not found"}
    ctx.drive = drive

    rules_result = await ctx.db.execute(
        select(EligibilityRule).where(EligibilityRule.drive_id == ctx.drive_id)
    )
    ctx.rules = [
        {"rule_type": r.rule_type, "rule_value": r.rule_value, "rule_json": r.rule_json}
        for r in rules_result.scalars().all()
    ]

    response: dict[str, Any] = {
        "title": drive.title,
        "jd_text": drive.jd_text,
        "status": drive.status.value,
        "rules": ctx.rules,
    }

    # Some drives already have parsing/eligibility/a ranked shortlist from the
    # older deterministic pipeline (Company/HR's "run pipeline") or an
    # earlier agent run this conversation didn't see (a fresh ToolContext on
    # resume — see resume_run). Surface it so the model can pick up from here
    # instead of silently redoing work a human already watched happen
    # (observed live 2026-08-28: a drive already at "shortlist_pending" from
    # HR's pipeline re-ran the whole thing from parse_jd on "Start the agent").
    if drive.jd_parsed:
        ctx.jd_parsed = drive.jd_parsed
        response["existing_jd_parsed"] = True

    elig_result = await ctx.db.execute(
        select(EligibilityResult)
        .where(EligibilityResult.drive_id == ctx.drive_id, EligibilityResult.eligible == True)
        .order_by(EligibilityResult.checked_at.desc())
    )
    eligible_ids: list[str] = []
    seen: set[str] = set()
    for r in elig_result.scalars().all():
        if r.student_id in seen:
            continue
        seen.add(r.student_id)
        eligible_ids.append(r.student_id)
    if eligible_ids:
        response["existing_eligible_count"] = len(eligible_ids)
        if not ctx.all_students:
            ctx.all_students = await _load_students(ctx.db)
        students_by_id = {s["id"]: s for s in ctx.all_students}
        ctx.eligible_students = [students_by_id[i] for i in eligible_ids if i in students_by_id]

    match_result = await ctx.db.execute(
        select(MatchScore)
        .options(selectinload(MatchScore.student))
        .where(MatchScore.drive_id == ctx.drive_id)
        .order_by(MatchScore.rank)
    )
    existing_matches = match_result.scalars().all()
    if existing_matches:
        ctx.match_results = [
            {
                "student_id": m.student_id,
                "name": m.student.name if m.student else None,
                "score": m.score,
                "rank": m.rank,
                "explanation": m.explanation,
            }
            for m in existing_matches
        ]
        ctx.top_k_requested = len(existing_matches)
        response["existing_shortlist"] = {
            "ranked_count": len(existing_matches),
            "top_candidates": [
                {"name": m["name"], "score": m["score"], "rank": m["rank"]}
                for m in ctx.match_results[:5]
            ],
        }

    return response


async def _exec_parse_jd(ctx: ToolContext, args: dict) -> dict:
    if ctx.drive is None:
        await _exec_get_drive_context(ctx, {})
    if not ctx.drive or not ctx.drive.jd_text:
        return {"error": "no jd_text on this drive — cannot parse"}

    parsed = await analyze_jd(ctx.drive.jd_text)
    ctx.jd_parsed = parsed
    ctx.drive.jd_parsed = parsed
    ctx.drive.role = parsed.get("role")
    ctx.drive.package_lpa = parsed.get("package_lpa")
    await ctx.db.commit()

    return {
        "role": parsed.get("role"),
        "package_lpa": parsed.get("package_lpa"),
        "min_cgpa": parsed.get("min_cgpa"),
        "allowed_branches": parsed.get("allowed_branches"),
        "required_skills": parsed.get("required_skills"),
        "summary": parsed.get("job_description_summary"),
    }


def _rules_from_jd(jd_parsed: dict) -> list[dict]:
    """Fall back to the criteria the JD itself states.

    run_bulk_eligibility marks a student eligible unless some rule rejects them,
    so an empty rule list passes everyone — a drive with no rules configured
    reported "201 of 201 eligible" while the JD plainly said 7.0 CGPA, CSE/IT
    only. Manually configured EligibilityRule rows still win; this only fills the
    gap when there are none.
    """
    rules: list[dict] = []
    min_cgpa = jd_parsed.get("min_cgpa")
    if isinstance(min_cgpa, (int, float)) and min_cgpa > 0:
        rules.append({"rule_type": "min_cgpa", "rule_value": min_cgpa})

    # Deliberately not deriving allowed_branches: the JD parses abbreviations
    # ("CSE", "IT", "ECE") but the student roster has at least one full-name
    # variant ("Computer Science & Engineering") that an exact-match checker
    # would wrongly reject. Needs branch-name normalization before this is safe
    # — leave it to manually configured EligibilityRule rows until then.

    return rules


async def _exec_check_eligibility(ctx: ToolContext, args: dict) -> dict:
    if ctx.jd_parsed is None:
        return {"error": "call parse_jd first — no parsed JD to check eligibility against"}

    students = await _load_students(ctx.db)
    ctx.all_students = students

    rules = ctx.rules
    rules_source = "drive rules"
    if not rules:
        rules = _rules_from_jd(ctx.jd_parsed)
        rules_source = "the job description" if rules else "nothing — no criteria found"

    results = run_bulk_eligibility(students, rules)

    eligible_ids = {r["student_id"] for r in results if r["eligible"]}
    ctx.eligible_students = [s for s in students if s["id"] in eligible_ids]
    ctx.criteria_from = rules_source
    ctx.criteria_applied = [r["rule_type"] for r in rules]

    for r in results:
        ctx.db.add(EligibilityResult(
            drive_id=ctx.drive_id, student_id=r["student_id"],
            eligible=r["eligible"], is_edge_case=r.get("is_edge_case", False),
            reason=r.get("reasons", []),
        ))
    await ctx.db.commit()

    edge_cases = sum(1 for r in results if r.get("is_edge_case"))
    return {
        "total_students": len(students),
        "eligible_count": len(ctx.eligible_students),
        "edge_case_count": edge_cases,
        # Told to the model, not just logged: if it reads "criteria from nothing"
        # the system prompt's "say so if a tool result looks wrong" rule gives it
        # something concrete to object to.
        "criteria_from": rules_source,
        "criteria_applied": [r["rule_type"] for r in rules],
    }


async def _exec_rank_candidates(ctx: ToolContext, args: dict) -> dict:
    if not ctx.eligible_students:
        # A resumed run gets a brand-new ToolContext (see resume_run), so
        # eligible_students/jd_parsed/drive are all empty even though the
        # original run already computed and persisted them. Reload from the
        # DB instead of erroring — both jd_parsed (PlacementDrive.jd_parsed)
        # and the eligibility check (EligibilityResult rows) survive a run,
        # so this needs zero extra Gemini calls, unlike re-running parse_jd.
        if ctx.drive is None or ctx.jd_parsed is None:
            await _exec_get_drive_context(ctx, {})
            if ctx.drive is not None:
                ctx.jd_parsed = ctx.drive.jd_parsed

        result = await ctx.db.execute(
            select(EligibilityResult)
            .where(EligibilityResult.drive_id == ctx.drive_id, EligibilityResult.eligible == True)
            .order_by(EligibilityResult.checked_at.desc())
        )
        eligible_ids: list[str] = []
        seen: set[str] = set()
        for r in result.scalars().all():
            if r.student_id in seen:
                continue
            seen.add(r.student_id)
            eligible_ids.append(r.student_id)
        if not eligible_ids or not ctx.jd_parsed:
            return {"error": "call check_eligibility first — no eligible students to rank"}
        if not ctx.all_students:
            ctx.all_students = await _load_students(ctx.db)
        students_by_id = {s["id"]: s for s in ctx.all_students}
        ctx.eligible_students = [students_by_id[i] for i in eligible_ids if i in students_by_id]

    top_k = int(args.get("top_k") or 20)
    ctx.top_k_requested = top_k
    embedded_ok = await index_students_for_drive(ctx.drive_id, ctx.eligible_students)
    matches = await match_students_to_jd(
        ctx.drive_id, ctx.jd_parsed, top_k=top_k, students=ctx.eligible_students,
    )
    students_by_id = {s["id"]: s for s in ctx.eligible_students}
    matches = await generate_all_explanations(matches, students_by_id, ctx.jd_parsed)
    ctx.match_results = matches

    # A re-run within the same conversation (the TPO asked for more/fewer
    # candidates) must replace the previous ranking, not append to it — the
    # (drive_id, student_id) pair isn't unique, so a second insert without
    # this would double-count everyone still in both rankings.
    await ctx.db.execute(delete(MatchScore).where(MatchScore.drive_id == ctx.drive_id))

    for m in matches:
        ctx.db.add(MatchScore(
            drive_id=ctx.drive_id, student_id=m["student_id"],
            score=m["score"], rank=m["rank"], explanation=m.get("explanation"),
        ))
    await ctx.db.commit()

    return {
        "ranked_count": len(matches),
        "used_ai_embeddings": embedded_ok,
        "top_candidates": [
            {"name": m["name"], "score": m["score"], "rank": m["rank"]}
            for m in matches[:5]
        ],
    }


_SELECT_FIELD_TYPES: dict[str, type] = {
    "cgpa": float, "attendance_pct": float, "backlogs_active": int,
    "name": str, "branch": str, "roll_no": str,
}
_SELECT_OPS = {"gte", "lte", "gt", "lt", "eq", "contains"}


def _select_filter(students: list[dict], field: str, op: str, value: str) -> list[dict]:
    caster = _SELECT_FIELD_TYPES[field]
    numeric = caster is not str
    matches = []
    for s in students:
        raw = s.get(field)
        if raw is None:
            continue
        try:
            sval = caster(raw)
            cmpval = caster(value)
        except (TypeError, ValueError):
            continue
        if numeric:
            if op == "gte" and sval >= cmpval: matches.append(s)
            elif op == "lte" and sval <= cmpval: matches.append(s)
            elif op == "gt" and sval > cmpval: matches.append(s)
            elif op == "lt" and sval < cmpval: matches.append(s)
            elif op == "eq" and sval == cmpval: matches.append(s)
        else:
            sval, cmpval = sval.lower(), cmpval.lower()
            if op == "eq" and sval == cmpval: matches.append(s)
            elif op == "contains" and cmpval in sval: matches.append(s)
    return matches


async def _exec_select_candidates(ctx: ToolContext, args: dict) -> dict:
    field = args.get("field")
    op = args.get("op")
    value = args.get("value")
    if field not in _SELECT_FIELD_TYPES:
        return {"error": f"unknown field {field!r} — use one of {sorted(_SELECT_FIELD_TYPES)}"}
    if op not in _SELECT_OPS:
        return {"error": f"unknown op {op!r} — use one of {sorted(_SELECT_OPS)}"}

    # Deliberately the FULL roster, not ctx.eligible_students — this tool's
    # entire purpose is letting the TPO pull in someone the automatic
    # eligibility check excluded.
    if not ctx.all_students:
        ctx.all_students = await _load_students(ctx.db)
    matches = _select_filter(ctx.all_students, field, op, str(value))
    if not matches:
        return {"matched_count": 0, "names": []}

    # A name is meant to pick ONE specific person — unlike every other field,
    # more than one hit means genuine ambiguity (two students can share a
    # first name), not a legitimate bulk match. Add nobody yet; hand back
    # enough to ask_human with so the TPO can pick the exact one by roll
    # number, then the model resolves it with field="roll_no", op="eq".
    if field == "name" and len(matches) > 1:
        return {
            "ambiguous": True,
            "matched_count": len(matches),
            "candidates": [
                {"name": s["name"], "roll_no": s["roll_no"], "branch": s["branch"], "cgpa": s["cgpa"]}
                for s in matches
            ],
            "note": "Do not add any of these yet — call ask_human with one option per "
                    "candidate (e.g. 'Name — Roll No'), then call select_candidates again "
                    "with field=roll_no, op=eq once the TPO picks one.",
        }

    matched_ids = [s["id"] for s in matches]
    existing_result = await ctx.db.execute(
        select(MatchScore).where(
            MatchScore.drive_id == ctx.drive_id, MatchScore.student_id.in_(matched_ids),
        )
    )
    existing_by_student = {m.student_id: m for m in existing_result.scalars().all()}

    max_rank_result = await ctx.db.execute(
        select(func.max(MatchScore.rank)).where(MatchScore.drive_id == ctx.drive_id)
    )
    next_rank = (max_rank_result.scalar() or 0) + 1

    note = f"Proposed per TPO request: {field} {op} {value}"
    added, updated = [], []
    for s in matches:
        existing = existing_by_student.get(s["id"])
        if existing:
            existing.shortlisted = True
            existing.tpo_override = True
            existing.tpo_override_reason = note
            updated.append(s["name"])
        else:
            ctx.db.add(MatchScore(
                drive_id=ctx.drive_id, student_id=s["id"], score=0.0, rank=next_rank,
                explanation=note, shortlisted=True, tpo_override=True, tpo_override_reason=note,
            ))
            next_rank += 1
            added.append(s["name"])
    await ctx.db.commit()

    return {
        "matched_count": len(matches),
        "newly_added": added,
        "already_on_list_now_checked": updated,
        "note": "Pre-checked on the shortlist review screen — not final until the TPO clicks Approve there.",
    }


async def _exec_ask_human(ctx: ToolContext, args: dict) -> dict:
    # Intercepted by the orchestrator loop before dispatch — this executor
    # exists only so ask_human appears in TOOL_EXECUTORS for validation.
    raise RuntimeError("ask_human must be intercepted by the orchestrator loop")


TOOL_EXECUTORS = {
    "get_drive_context": _exec_get_drive_context,
    "parse_jd": _exec_parse_jd,
    "check_eligibility": _exec_check_eligibility,
    "rank_candidates": _exec_rank_candidates,
    "select_candidates": _exec_select_candidates,
    "ask_human": _exec_ask_human,
}
