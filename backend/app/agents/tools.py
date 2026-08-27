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
from sqlalchemy import select
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
    return {
        "title": drive.title,
        "jd_text": drive.jd_text,
        "status": drive.status.value,
        "rules": ctx.rules,
    }


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
        return {"error": "call check_eligibility first — no eligible students to rank"}

    top_k = int(args.get("top_k") or 20)
    ctx.top_k_requested = top_k
    embedded_ok = await index_students_for_drive(ctx.drive_id, ctx.eligible_students)
    matches = await match_students_to_jd(
        ctx.drive_id, ctx.jd_parsed, top_k=top_k, students=ctx.eligible_students,
    )
    students_by_id = {s["id"]: s for s in ctx.eligible_students}
    matches = await generate_all_explanations(matches, students_by_id, ctx.jd_parsed)
    ctx.match_results = matches

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


async def _exec_ask_human(ctx: ToolContext, args: dict) -> dict:
    # Intercepted by the orchestrator loop before dispatch — this executor
    # exists only so ask_human appears in TOOL_EXECUTORS for validation.
    raise RuntimeError("ask_human must be intercepted by the orchestrator loop")


TOOL_EXECUTORS = {
    "get_drive_context": _exec_get_drive_context,
    "parse_jd": _exec_parse_jd,
    "check_eligibility": _exec_check_eligibility,
    "rank_candidates": _exec_rank_candidates,
    "ask_human": _exec_ask_human,
}
