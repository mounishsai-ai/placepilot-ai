"""
Scheduler Agent — allocates conflict-free interview slots,
assigns rooms and panel members, generates calendar invites.
"""
from datetime import datetime, timedelta
from typing import Optional
from loguru import logger


# ─── Slot Finder ──────────────────────────────────────────────────────────────

def generate_time_slots(
    start: datetime,
    end: datetime,
    duration_min: int,
    break_min: int = 5,
) -> list[tuple[datetime, datetime]]:
    """Generate all possible slots between start and end."""
    slots = []
    current = start
    while current + timedelta(minutes=duration_min) <= end:
        slot_end = current + timedelta(minutes=duration_min)
        slots.append((current, slot_end))
        current = slot_end + timedelta(minutes=break_min)
    return slots


def find_panel_conflicts(
    panel_id: str,
    slot_start: datetime,
    slot_end: datetime,
    existing_slots: list[dict],
) -> bool:
    """Returns True if panel has a conflict at the given time."""
    for slot in existing_slots:
        if slot.get("panel_id") != panel_id:
            continue
        existing_start = slot["slot_start"]
        existing_end = slot["slot_end"]
        if not (slot_end <= existing_start or slot_start >= existing_end):
            return True
    return False


def find_room_conflicts(
    room_id: str,
    slot_start: datetime,
    slot_end: datetime,
    existing_slots: list[dict],
) -> bool:
    """Returns True if room is booked at the given time."""
    for slot in existing_slots:
        if slot.get("room_id") != room_id:
            continue
        existing_start = slot["slot_start"]
        existing_end = slot["slot_end"]
        if not (slot_end <= existing_start or slot_start >= existing_end):
            return True
    return False


# ─── Core Scheduler ───────────────────────────────────────────────────────────

def allocate_slots(
    shortlisted_student_ids: list[str],
    round_info: dict,
    available_panels: list[dict],
    available_rooms: list[dict],
    panel_availabilities: list[dict],
) -> tuple[list[dict], list[dict]]:
    """
    FCFS slot allocation with conflict detection.

    Returns:
        (allocated_slots, conflicts)
    """
    start_dt = round_info["start_datetime"]
    end_dt = round_info["end_datetime"]
    duration = round_info.get("slot_duration_min", 30)
    round_id = round_info["id"]
    mode = round_info.get("mode", "offline")

    all_slots = generate_time_slots(start_dt, end_dt, duration)
    allocated: list[dict] = []
    conflicts: list[dict] = []

    # Round-robin across panels
    panel_idx = 0
    room_idx = 0
    slot_idx = 0

    for student_id in shortlisted_student_ids:
        placed = False
        attempts = 0
        _slot_idx = slot_idx

        while _slot_idx < len(all_slots) and attempts < len(all_slots):
            slot_start, slot_end = all_slots[_slot_idx]
            panel = available_panels[panel_idx % len(available_panels)] if available_panels else None
            room = available_rooms[room_idx % len(available_rooms)] if available_rooms and mode == "offline" else None

            panel_conflict = (
                find_panel_conflicts(panel["id"], slot_start, slot_end, allocated)
                if panel else False
            )
            room_conflict = (
                find_room_conflicts(room["id"], slot_start, slot_end, allocated)
                if room else False
            )

            if not panel_conflict and not room_conflict:
                allocated.append({
                    "round_id": round_id,
                    "student_id": student_id,
                    "panel_id": panel["id"] if panel else None,
                    "room_id": room["id"] if room else None,
                    "slot_start": slot_start,
                    "slot_end": slot_end,
                    "status": "scheduled",
                })
                slot_idx = _slot_idx  # advance global pointer
                panel_idx += 1
                if mode == "offline":
                    room_idx += 1
                placed = True
                break
            else:
                _slot_idx += 1
                attempts += 1

        if not placed:
            conflicts.append({
                "student_id": student_id,
                "reason": "No available slot found in the given time window",
            })

    logger.info(
        f"Scheduling complete: {len(allocated)} allocated, "
        f"{len(conflicts)} unscheduled for round {round_id}"
    )
    return allocated, conflicts


def detect_all_conflicts(slots: list[dict]) -> list[dict]:
    """Scan existing slots for any double-bookings (panel or room)."""
    found = []
    for i, s1 in enumerate(slots):
        for j, s2 in enumerate(slots):
            if i >= j:
                continue
            overlap = not (s1["slot_end"] <= s2["slot_start"] or s1["slot_start"] >= s2["slot_end"])
            if overlap:
                if s1.get("panel_id") and s1["panel_id"] == s2["panel_id"]:
                    found.append({"type": "panel_conflict", "slot_ids": [s1["id"], s2["id"]]})
                if s1.get("room_id") and s1["room_id"] == s2["room_id"]:
                    found.append({"type": "room_conflict", "slot_ids": [s1["id"], s2["id"]]})
    return found


def build_schedule_summary(allocated: list[dict], conflicts: list[dict]) -> dict:
    """Build a summary dict for the TPO approval step."""
    return {
        "total_students": len(allocated) + len(conflicts),
        "scheduled": len(allocated),
        "unscheduled": len(conflicts),
        "conflicts": conflicts,
        "schedule": allocated,
    }
