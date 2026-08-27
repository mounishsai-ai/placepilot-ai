"""
Analyst Agent — a deliberately narrow bridge between a TPO's plain-language
question and the placement database.

The model plans the query, but it never gets database access and it never gets
to decide whether its SQL is safe. Keeping generation, Python validation,
execution, and explanation as four separate boundaries makes this useful for
ad-hoc analysis without turning a dashboard text box into a general database
console. The second model call receives only returned rows, so its answer is
grounded in the data actually read rather than in the first call's intent.
"""
import json
import re
from typing import Any

from loguru import logger

from app.agents.vertex_json import generate_json


MAX_QUERY_ROWS = 100

# This is intentionally a hand-written, least-privilege view of the schema.
# IDs remain available for joins, while account links, contact details, resume
# URLs, and notification contents have no analytical purpose here.
QUERYABLE_SCHEMA = """
Use PostgreSQL table and column names exactly as listed below. These are the
only tables you may query:

companies: id, name, sector, website, logo_url, created_at
students: id, roll_no, name, branch, batch, cgpa, backlogs_active,
  backlogs_historical, attendance_pct, placement_readiness_score, skills_summary,
  created_at, updated_at
student_skills: id, student_id, skill, proficiency, years_experience, verified
placement_drives: id, company_id, title, jd_parsed, role, package_lpa, bond_years,
  location, deadline, status, created_at, updated_at
eligibility_rules: id, drive_id, rule_type, rule_value, rule_json
eligibility_results: id, drive_id, student_id, eligible, is_edge_case, reason, checked_at
match_scores: id, drive_id, student_id, score, rank, explanation, shortlisted,
  tpo_override, tpo_override_reason, created_at
interview_rounds: id, drive_id, round_no, round_type, start_datetime, end_datetime,
  mode, venue, meet_link, slot_duration_min
interview_slots: id, round_id, student_id, panel_id, room_id, slot_start, slot_end,
  status, result, feedback
rooms: id, name, capacity, location, has_projector, has_whiteboard, has_computer,
  is_virtual
panel_members: id, company_id, name, designation, expertise
notifications: id, student_id, channel, template_id, sent_at, delivered_at, read_at,
  status, retry_count, created_at
""".strip()

SQL_SYSTEM = f"""You translate a TPO's placement-data question into one PostgreSQL SELECT query.

{QUERYABLE_SCHEMA}

Respond with JSON only:
{{"sql": "SELECT ..."}}

Rules:
- Produce exactly one SELECT statement, using only the listed tables and columns.
- Never use CTEs, subqueries that read unlisted tables, comments, semicolons, or SQL-writing commands.
- Use explicit JOINs when a join is needed; do not use comma joins.
- Never use SELECT * — name the columns you actually need.
- Prefer aggregated answers for count, highest, lowest, or comparison questions.
- Add LIMIT 100 or less for row-level results. Never guess data; if the question cannot be answered
  from this schema, return {{"sql": ""}}.
"""

SUMMARY_SYSTEM = """You are a placement-data analyst writing a concise answer for a TPO.
You receive the original question, the read-only SQL that was run, and the actual rows returned.
Answer only from those rows. State the result directly, mention when there were no matching rows,
and do not invent an explanation or claim a total beyond the returned data. Keep it to two or
three plain-English sentences.

Respond with JSON only:
{"answer": "concise, factual answer"}
"""

_ALLOWED_TABLES = {
    "placement_drives",
    "students",
    "student_skills",
    "eligibility_rules",
    "eligibility_results",
    "match_scores",
    "companies",
    "interview_rounds",
    "interview_slots",
    "rooms",
    "panel_members",
    "notifications",
}
_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(?:insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|do|"
    r"execute|merge|vacuum|analyze|refresh|lock|set|show|reset|listen|notify|unlisten|"
    r"prepare|deallocate|lateral)\b",
    re.IGNORECASE,
)
_TABLE_REFERENCE = re.compile(r"\b(?:from|join)\s+([a-z_][a-z0-9_]*)", re.IGNORECASE)
_RELATION = re.compile(
    r"\b(?:from|join)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?"
    r"(?=\s+(?:where|group|having|order|limit|inner|left|right|full|cross|join|on|union|except|intersect)\b|$)",
    re.IGNORECASE,
)
_QUALIFIED_REFERENCE = re.compile(r"\b([a-z_][a-z0-9_]*)\s*\.", re.IGNORECASE)
_FUNCTION_CALL = re.compile(r"\b([a-z_][a-z0-9_]*)\s*\(", re.IGNORECASE)
_ALLOWED_FUNCTIONS = {
    "count", "sum", "avg", "min", "max", "round", "coalesce", "lower", "upper",
    "date_trunc", "extract", "cast", "nullif",
}

# QUERYABLE_SCHEMA's column lists are only a prompt hint — the real tables carry
# more columns than that (students.email, .phone, .resume_url, .linkedin_url,
# .github_url, .user_id; every table's link back to `users`), and nothing above
# stops a generated query from naming them explicitly. `SELECT *` would return
# them too. Block both: this is the actual enforcement of "no analytical purpose
# here," not the schema doc's wording.
_SELECT_STAR = re.compile(r"select\s+(?:[a-z_][a-z0-9_.]*\s*\.\s*)?\*", re.IGNORECASE)
_BLOCKED_COLUMNS = re.compile(
    r"\b(?:email|phone|user_id|resume_url|resume_uploaded_at|linkedin_url|"
    r"github_url|hashed_password|password|token)\b",
    re.IGNORECASE,
)


async def generate_sql(question: str) -> str:
    try:
        result = await generate_json(SQL_SYSTEM, question, caller="analyst_agent.sql")
    except Exception as exc:  # noqa: BLE001 - the endpoint has a deliberate degraded response
        logger.warning("analyst_agent: SQL generation failed: {}", type(exc).__name__)
        return ""
    sql = result.get("sql") if result else ""
    if not isinstance(sql, str):
        return ""
    return sql.strip()


def validate_readonly_sql(sql: str) -> str | None:
    """Returns a bounded query only when it fits this endpoint's small SQL subset.

    The validator is intentionally more restrictive than PostgreSQL: rejecting an
    uncommon analytical form is preferable to making the model prompt the only
    protection against a write, a system-table read, or a side-effecting function.
    """
    normalized = sql.strip()
    if not normalized or not re.match(r"^select\b", normalized, re.IGNORECASE):
        return None
    if ";" in normalized or "--" in normalized or "/*" in normalized or "*/" in normalized:
        return None
    if _FORBIDDEN_KEYWORDS.search(normalized):
        return None
    if _SELECT_STAR.search(normalized) or _BLOCKED_COLUMNS.search(normalized):
        return None

    table_names = _TABLE_REFERENCE.findall(normalized)
    if not table_names or any(table.lower() not in _ALLOWED_TABLES for table in table_names):
        return None

    aliases = set(_ALLOWED_TABLES)
    relation_stopwords = {
        "where", "group", "having", "order", "limit", "inner", "left", "right",
        "full", "cross", "join", "on", "union", "except", "intersect",
    }
    for table, alias in _RELATION.findall(normalized):
        if table.lower() not in _ALLOWED_TABLES:
            return None
        if alias and alias.lower() not in relation_stopwords:
            aliases.add(alias.lower())
    # A qualified identifier must be either an exposed table or an alias that
    # came from one; this closes the gap where SELECT users.password_hash FROM
    # students could otherwise look like an ordinary column qualification.
    if any(prefix.lower() not in aliases for prefix in _QUALIFIED_REFERENCE.findall(normalized)):
        return None

    # Implicit joins make it too easy for a second table reference to evade the
    # simple table parser above, so generated analysis is deliberately explicit.
    from_clause = re.search(
        r"\bfrom\b(.*?)(?:\bwhere\b|\bgroup\s+by\b|\bhaving\b|\border\s+by\b|\blimit\b|$)",
        normalized,
        re.IGNORECASE | re.DOTALL,
    )
    if from_clause and "," in from_clause.group(1):
        return None

    function_names = _FUNCTION_CALL.findall(normalized)
    if any(function.lower() not in _ALLOWED_FUNCTIONS for function in function_names):
        return None

    if re.search(r"\blimit\b", normalized, re.IGNORECASE):
        limit = re.search(r"\blimit\s+(\d+)\b", normalized, re.IGNORECASE)
        if not limit:
            return None
        if int(limit.group(1)) > MAX_QUERY_ROWS:
            normalized = (
                normalized[:limit.start(1)] + str(MAX_QUERY_ROWS) + normalized[limit.end(1):]
            )
    else:
        normalized = f"{normalized} LIMIT {MAX_QUERY_ROWS}"

    return normalized


async def summarize_rows(question: str, sql: str, rows: list[dict[str, Any]]) -> str:
    prompt = json.dumps(
        {"question": question, "sql": sql, "rows": rows},
        default=str,
        ensure_ascii=False,
    )
    try:
        result = await generate_json(SUMMARY_SYSTEM, prompt, caller="analyst_agent.summary")
    except Exception as exc:  # noqa: BLE001 - summary failure still has a useful deterministic answer
        logger.warning("analyst_agent: summary generation failed: {}", type(exc).__name__)
        result = {}
    answer = result.get("answer") if result else ""
    if isinstance(answer, str) and answer.strip():
        return answer.strip()

    logger.warning("analyst_agent: summary call failed after {} returned rows", len(rows))
    if rows:
        return f"I found {len(rows)} matching row(s). The AI summary could not be generated."
    return "No matching placement records were found."
