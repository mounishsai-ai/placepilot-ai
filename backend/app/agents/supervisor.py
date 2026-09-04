"""
LangGraph Supervisor — orchestrates all sub-agents into a stateful pipeline.
Includes human-in-the-loop interrupt nodes for TPO approval gates.
"""
import asyncio
from typing import TypedDict, Annotated, Any, Optional
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph.message import add_messages
from loguru import logger

from app.agents.jd_analyst import analyze_jd, jd_is_usable
from app.agents.eligibility_agent import run_bulk_eligibility
from app.agents.matcher_agent import (
    index_students_for_drive,
    match_students_to_jd,
    generate_all_explanations,
)
from app.agents.scheduler_agent import allocate_slots, build_schedule_summary
from app.api.websocket import emit_agent_event


# ─── Shared Graph State ───────────────────────────────────────────────────────

class PlacementState(TypedDict):
    drive_id: str
    jd_text: str
    jd_parsed: Optional[dict]
    students: list[dict]
    rules: list[dict]
    eligibility_results: list[dict]
    eligible_students: list[dict]
    match_results: list[dict]
    shortlisted_student_ids: list[str]
    tpo_shortlist_approved: Optional[bool]  # None = pending
    schedule_summary: Optional[dict]
    tpo_schedule_approved: Optional[bool]   # None = pending
    allocated_slots: list[dict]
    notifications_sent: bool
    agent_events: list[dict]
    current_step: str
    error: Optional[str]


# ─── Node Implementations ─────────────────────────────────────────────────────

async def _emit(state: PlacementState, event_type: str, agent_name: str, payload: dict) -> dict:
    """Append an event to graph state AND broadcast it live over WS in one step."""
    event = {"event_type": event_type, "agent_name": agent_name, "payload": payload}
    await emit_agent_event(event_type, payload, drive_id=state["drive_id"], agent_name=agent_name)
    return event


async def node_analyze_jd(state: PlacementState) -> dict:
    logger.info(f"[{state['drive_id']}] JD Analyst started")
    try:
        jd_parsed = await analyze_jd(state["jd_text"])

        # Stop here rather than screening 200 students against nothing. See
        # jd_is_usable() for why an empty parse must not become a shortlist.
        usable, reason = jd_is_usable(jd_parsed)
        if not usable:
            logger.warning(f"[{state['drive_id']}] unusable JD — halting pipeline")
            await _emit(state, "pipeline_error", "jd_analyst", {"reason": reason})
            return {"jd_parsed": jd_parsed, "error": reason, "current_step": "error"}

        event = await _emit(state, "jd_analyzed", "jd_analyst", {
            "role": jd_parsed.get("role"), "package": jd_parsed.get("package_lpa"),
        })
        return {
            "jd_parsed": jd_parsed,
            "current_step": "jd_analyzed",
            "agent_events": state.get("agent_events", []) + [event],
        }
    except Exception as e:
        return {"error": str(e), "current_step": "error"}


async def node_check_eligibility(state: PlacementState) -> dict:
    logger.info(f"[{state['drive_id']}] Eligibility Agent started")
    results = run_bulk_eligibility(state["students"], state["rules"])
    eligible = [
        s for s in state["students"]
        if any(r["student_id"] == s["id"] and r["eligible"] for r in results)
    ]
    edge_cases = [r for r in results if r.get("is_edge_case")]

    event = await _emit(state, "eligibility_checked", "eligibility_agent", {
        "total": len(state["students"]),
        "eligible": len(eligible),
        "edge_cases": len(edge_cases),
    })
    return {
        "eligibility_results": results,
        "eligible_students": eligible,
        "current_step": "eligibility_checked",
        "agent_events": state.get("agent_events", []) + [event],
    }


async def node_match_candidates(state: PlacementState) -> dict:
    logger.info(f"[{state['drive_id']}] Matcher Agent started")
    eligible = state["eligible_students"]
    jd_parsed = state["jd_parsed"]
    drive_id = state["drive_id"]

    embedded_ok = await index_students_for_drive(drive_id, eligible)
    matches = await match_students_to_jd(
        drive_id, jd_parsed, top_k=50,
        students=eligible,          # needed for TF-IDF fallback
    )

    students_by_id = {s["id"]: s for s in eligible}
    matches = await generate_all_explanations(matches, students_by_id, jd_parsed)

    event = await _emit(state, "matching_complete", "matcher_agent", {
        "candidates_ranked": len(matches),
    })
    return {
        "match_results": matches,
        "current_step": "matched",
        "agent_events": state.get("agent_events", []) + [event],
    }


async def node_await_shortlist_approval(state: PlacementState) -> dict:
    """
    HUMAN-IN-THE-LOOP CHECKPOINT #1
    This node pauses the graph. The TPO must call PATCH /drives/{id}/shortlist
    to resume. LangGraph's interrupt() mechanism suspends execution here.
    """
    logger.info(f"[{state['drive_id']}] ⏸ Awaiting TPO shortlist approval")
    # Top 20 students auto-shortlisted as suggestion
    suggested = [m["student_id"] for m in state["match_results"][:20]]
    event = await _emit(state, "shortlist_pending", "supervisor", {
        "suggested_count": len(suggested),
    })
    return {
        "shortlisted_student_ids": suggested,
        "current_step": "shortlist_pending",
        "agent_events": state.get("agent_events", []) + [event],
    }


async def node_schedule_interviews(state: PlacementState) -> dict:
    logger.info(f"[{state['drive_id']}] Scheduler Agent started")
    # For prototype: use first available round info from state
    round_info = state.get("round_info", {
        "id": f"round_{state['drive_id']}_1",
        "round_no": 1,
        "round_type": "technical",
        "slot_duration_min": 30,
        "mode": "offline",
        "start_datetime": None,
        "end_datetime": None,
    })
    panels = state.get("available_panels", [])
    rooms = state.get("available_rooms", [])

    allocated, conflicts = allocate_slots(
        state["shortlisted_student_ids"],
        round_info,
        panels,
        rooms,
        [],
    )
    summary = build_schedule_summary(allocated, conflicts)

    event = await _emit(state, "schedule_created", "scheduler_agent", {
        "scheduled": len(allocated), "conflicts": len(conflicts),
    })
    return {
        "allocated_slots": allocated,
        "schedule_summary": summary,
        "current_step": "schedule_pending",
        "agent_events": state.get("agent_events", []) + [event],
    }


async def node_await_schedule_approval(state: PlacementState) -> dict:
    """HUMAN-IN-THE-LOOP CHECKPOINT #2 — TPO confirms schedule."""
    logger.info(f"[{state['drive_id']}] ⏸ Awaiting TPO schedule confirmation")
    event = await _emit(state, "schedule_pending", "supervisor", {})
    return {
        "current_step": "schedule_pending",
        "agent_events": state.get("agent_events", []) + [event],
    }


async def node_send_notifications(state: PlacementState) -> dict:
    logger.info(f"[{state['drive_id']}] Notifier Agent — sending interview invites")
    # Actual notification sending is handled by the Notifier service
    # This node queues the notification jobs
    event = await _emit(state, "notifications_queued", "notifier_agent", {
        "count": len(state["shortlisted_student_ids"]),
    })
    return {
        "notifications_sent": True,
        "current_step": "completed",
        "agent_events": state.get("agent_events", []) + [event],
    }


# ─── Routing Logic ────────────────────────────────────────────────────────────

def route_after_jd(state: PlacementState) -> str:
    """An unusable JD ends the run instead of screening anyone against it."""
    return "end" if state.get("error") else "check_eligibility"


def route_after_shortlist(state: PlacementState) -> str:
    if state.get("tpo_shortlist_approved") is True:
        return "schedule_interviews"
    return "await_shortlist_approval"


def route_after_schedule(state: PlacementState) -> str:
    if state.get("tpo_schedule_approved") is True:
        return "send_notifications"
    return "await_schedule_approval"


# ─── Build Graph ──────────────────────────────────────────────────────────────

def build_placement_graph():
    memory = MemorySaver()
    graph = StateGraph(PlacementState)

    # Add nodes
    graph.add_node("analyze_jd", node_analyze_jd)
    graph.add_node("check_eligibility", node_check_eligibility)
    graph.add_node("match_candidates", node_match_candidates)
    graph.add_node("await_shortlist_approval", node_await_shortlist_approval)
    graph.add_node("schedule_interviews", node_schedule_interviews)
    graph.add_node("await_schedule_approval", node_await_schedule_approval)
    graph.add_node("send_notifications", node_send_notifications)

    # Entry point
    graph.set_entry_point("analyze_jd")

    # Edges
    graph.add_conditional_edges(
        "analyze_jd",
        route_after_jd,
        {"check_eligibility": "check_eligibility", "end": END},
    )
    graph.add_edge("check_eligibility", "match_candidates")
    graph.add_conditional_edges(
        "match_candidates",
        route_after_shortlist,
        {
            "await_shortlist_approval": "await_shortlist_approval",
            "schedule_interviews": "schedule_interviews",
        },
    )
    graph.add_edge("await_shortlist_approval", END)  # pause — resume via API
    graph.add_conditional_edges(
        "schedule_interviews",
        route_after_schedule,
        {
            "await_schedule_approval": "await_schedule_approval",
            "send_notifications": "send_notifications",
        },
    )
    graph.add_edge("await_schedule_approval", END)   # pause — resume via API
    graph.add_edge("send_notifications", END)

    return graph.compile(checkpointer=memory)


# Singleton graph instance
placement_graph = build_placement_graph()


async def run_placement_pipeline(
    drive_id: str,
    jd_text: str,
    students: list[dict],
    rules: list[dict],
) -> dict:
    """Start the placement pipeline for a drive."""
    initial_state: PlacementState = {
        "drive_id": drive_id,
        "jd_text": jd_text,
        "jd_parsed": None,
        "students": students,
        "rules": rules,
        "eligibility_results": [],
        "eligible_students": [],
        "match_results": [],
        "shortlisted_student_ids": [],
        "tpo_shortlist_approved": None,
        "schedule_summary": None,
        "tpo_schedule_approved": None,
        "allocated_slots": [],
        "notifications_sent": False,
        "agent_events": [],
        "current_step": "starting",
        "error": None,
    }

    config = {"configurable": {"thread_id": drive_id}}
    result = await placement_graph.ainvoke(initial_state, config=config)
    return result


async def resume_pipeline(drive_id: str, updates: dict) -> dict:
    """Resume a paused pipeline after human approval."""
    config = {"configurable": {"thread_id": drive_id}}
    result = await placement_graph.ainvoke(updates, config=config)
    return result
