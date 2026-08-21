"""
Eligibility Agent — checks all students against a drive's eligibility rules.
Handles edge cases with near-boundary decisions.
"""
from typing import Any
from loguru import logger


RULE_CHECKERS = {}


def rule_checker(rule_type: str):
    def decorator(fn):
        RULE_CHECKERS[rule_type] = fn
        return fn
    return decorator


@rule_checker("min_cgpa")
def check_min_cgpa(student: dict, rule: dict) -> tuple[bool, str]:
    min_val = float(rule.get("rule_value", 6.0))
    cgpa = student.get("cgpa", 0)
    if cgpa >= min_val:
        return True, f"CGPA {cgpa} ≥ {min_val} ✓"
    return False, f"CGPA {cgpa} < {min_val} (required)"


@rule_checker("max_backlogs")
def check_max_backlogs(student: dict, rule: dict) -> tuple[bool, str]:
    max_allowed = int(rule.get("rule_value", 0))
    active = student.get("backlogs_active", 0)
    if active <= max_allowed:
        return True, f"Active backlogs {active} ≤ {max_allowed} ✓"
    return False, f"Active backlogs {active} > {max_allowed} allowed"


@rule_checker("allowed_branches")
def check_allowed_branches(student: dict, rule: dict) -> tuple[bool, str]:
    rule_json = rule.get("rule_json", {})
    allowed = rule_json.get("branches", [])
    if not allowed:
        return True, "All branches allowed ✓"
    branch = student.get("branch", "")
    if branch.upper() in [b.upper() for b in allowed]:
        return True, f"Branch {branch} is eligible ✓"
    return False, f"Branch {branch} not in allowed list: {allowed}"


@rule_checker("min_attendance")
def check_attendance(student: dict, rule: dict) -> tuple[bool, str]:
    min_pct = float(rule.get("rule_value", 75.0))
    att = student.get("attendance_pct", 100.0)
    if att >= min_pct:
        return True, f"Attendance {att:.1f}% ≥ {min_pct}% ✓"
    return False, f"Attendance {att:.1f}% < {min_pct}% required"


@rule_checker("no_historical_backlogs")
def check_historical_backlogs(student: dict, rule: dict) -> tuple[bool, str]:
    hist = student.get("backlogs_historical", 0)
    if hist == 0:
        return True, "No historical backlogs ✓"
    return False, f"Student has {hist} historical backlog(s)"


def _is_edge_case(student: dict, rules: list[dict]) -> bool:
    """
    Flag students who barely miss criteria (within 5% of boundary).
    These are surfaced in the TPO exception panel for manual review.
    """
    for rule in rules:
        if rule.get("rule_type") == "min_cgpa":
            min_val = float(rule.get("rule_value", 6.0))
            cgpa = student.get("cgpa", 0)
            if min_val - 0.3 <= cgpa < min_val:
                return True
        if rule.get("rule_type") == "max_backlogs":
            max_allowed = int(rule.get("rule_value", 0))
            active = student.get("backlogs_active", 0)
            if active == max_allowed + 1:
                return True
    return False


def check_student_eligibility(
    student: dict,
    rules: list[dict],
) -> dict[str, Any]:
    """
    Run all eligibility rules for a student.
    Returns a dict with: eligible, is_edge_case, reasons.
    """
    results = []
    eligible = True

    for rule in rules:
        rule_type = rule.get("rule_type")
        checker = RULE_CHECKERS.get(rule_type)
        if checker:
            passed, reason = checker(student, rule)
            results.append({"rule": rule_type, "passed": passed, "reason": reason})
            if not passed:
                eligible = False
        else:
            logger.warning(f"Unknown rule type: {rule_type}")

    is_edge = _is_edge_case(student, rules) if not eligible else False

    return {
        "eligible": eligible,
        "is_edge_case": is_edge,
        "reasons": results,
        "summary": (
            "Eligible for this drive" if eligible
            else f"Not eligible: {', '.join(r['reason'] for r in results if not r['passed'])}"
        ),
    }


def run_bulk_eligibility(
    students: list[dict],
    rules: list[dict],
) -> list[dict[str, Any]]:
    """Run eligibility check for all students in bulk."""
    output = []
    eligible_count = 0
    edge_count = 0

    for student in students:
        result = check_student_eligibility(student, rules)
        result["student_id"] = student["id"]
        output.append(result)
        if result["eligible"]:
            eligible_count += 1
        if result.get("is_edge_case"):
            edge_count += 1

    logger.info(
        f"Eligibility check complete: {eligible_count}/{len(students)} eligible, "
        f"{edge_count} edge cases"
    )
    return output
