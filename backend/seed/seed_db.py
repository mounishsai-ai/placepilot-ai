"""
Database seeder — loads generated data into the DB.
Run: python -m seed.seed_db
"""
import asyncio
import json
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime, timedelta
from app.database import AsyncSessionLocal, init_db
from app.models import (
    Company, Student, StudentSkill, PlacementDrive, EligibilityRule,
    User, UserRole, Room, PanelMember, DriveStatus, InterviewRound,
    InterviewSlot, RoundType, SlotStatus
)
from app.api.auth import hash_password
from loguru import logger


async def seed():
    await init_db()

    with open("seed/data.json") as f:
        data = json.load(f)

    async with AsyncSessionLocal() as db:
        # ── Default users ────────────────────────────────────────────────────
        default_users = [
            User(id="user_tpo_01", email="tpo@college.edu",
                 hashed_password=hash_password("tpo@123"), role=UserRole.TPO),
            User(id="user_student_01", email="student@college.edu",
                 hashed_password=hash_password("student@123"), role=UserRole.STUDENT),
            User(id="user_company_01", email="hr@tcs.com",
                 hashed_password=hash_password("company@123"), role=UserRole.COMPANY),
            User(id="user_panel_01", email="panel@company.com",
                 hashed_password=hash_password("panel@123"), role=UserRole.PANEL),
        ]
        for u in default_users:
            db.add(u)
        await db.flush()  # users must exist before companies FK-reference user_company_01
        logger.info("Added default users")

        # ── Demo student record (linked to student@college.edu login) ─────────
        demo_student = Student(
            id="demo_student_01",
            roll_no="2024CS0001",
            name="Arjun Sharma",
            email="student@college.edu",   # MUST match User.email above
            phone="+91-9876543210",
            branch="CSE",
            batch=2024,
            cgpa=8.7,
            backlogs_active=0,
            backlogs_historical=0,
            attendance_pct=92.5,
            linkedin_url="https://linkedin.com/in/arjun-sharma",
            github_url="https://github.com/arjun-sharma",
            placement_readiness_score=84,
            skills_summary="Full-stack developer with expertise in Python, React, and ML",
        )
        db.add(demo_student)
        for skill_data in [
            ("Python", "expert", 2.5), ("React", "expert", 1.5),
            ("Machine Learning", "intermediate", 1.0), ("SQL", "expert", 2.0),
            ("Docker", "intermediate", 0.8), ("FastAPI", "intermediate", 1.2),
            ("TensorFlow", "beginner", 0.5), ("TypeScript", "intermediate", 1.0),
        ]:
            db.add(StudentSkill(
                student_id="demo_student_01",
                skill=skill_data[0], proficiency=skill_data[1],
                years_experience=skill_data[2],
            ))
        logger.info("Added demo student (student@college.edu)")

        # ── Companies ────────────────────────────────────────────────────────
        for c in data["companies"]:
            company = Company(
                id=c["id"], name=c["name"],
                sector=c.get("sector"), website=c.get("website"),
            )
            if c["id"] == "company_001":  # TCS Digital — linked to hr@tcs.com demo login
                company.user_id = "user_company_01"
            db.add(company)
        await db.flush()  # companies must exist before panel_members FK-reference them

        # ── Panel members ────────────────────────────────────────────────────
        for i in range(20):
            pm = PanelMember(
                id=f"panel_{i+1:03d}",
                company_id=data["companies"][i % 10]["id"],
                name=f"Interviewer {i+1}",
                email=f"interviewer{i+1}@company.com",
                designation="Senior Engineer",
                expertise=["Technical Interview", "System Design"],
            )
            if i == 0:  # panel_001 — linked to panel@company.com demo login
                pm.user_id = "user_panel_01"
            db.add(pm)

        # ── Rooms ────────────────────────────────────────────────────────────
        for i in range(10):
            room = Room(
                id=f"room_{i+1:03d}",
                name=f"Interview Room {i+1}",
                capacity=4,
                location=f"Block {'ABCDE'[i % 5]}, Floor {i // 5 + 1}",
                has_whiteboard=True,
                has_computer=i < 5,
                is_virtual=False,
            )
            db.add(room)

        # Virtual room
        db.add(Room(
            id="room_virtual_01",
            name="Google Meet Room",
            capacity=100,
            is_virtual=True,
        ))

        logger.info("Added companies, panel members, rooms")

        # ── Students ─────────────────────────────────────────────────────────
        for s in data["students"]:
            student = Student(
                id=s["roll_no"],   # use roll_no as id for easy lookup
                roll_no=s["roll_no"],
                name=s["name"],
                email=s["email"],
                phone=s.get("phone"),
                branch=s["branch"],
                batch=s["batch"],
                cgpa=s["cgpa"],
                backlogs_active=s["backlogs_active"],
                backlogs_historical=s["backlogs_historical"],
                attendance_pct=s["attendance_pct"],
                linkedin_url=s.get("linkedin_url"),
                placement_readiness_score=s.get("placement_readiness_score"),
                skills_summary=f"Student with expertise in {', '.join(sk['skill'] for sk in s['skills'][:3])}",
            )
            db.add(student)

            for sk in s.get("skills", []):
                db.add(StudentSkill(
                    student_id=student.id,
                    skill=sk["skill"],
                    proficiency=sk.get("proficiency", "intermediate"),
                    years_experience=sk.get("years_experience", 0),
                ))

        logger.info(f"Added {len(data['students'])} students")

        # ── Drives ───────────────────────────────────────────────────────────
        drive_objs = []
        for d in data["drives"]:
            drive = PlacementDrive(
                id=d["id"],
                company_id=d["company_id"],
                title=d["title"],
                jd_text=d["jd_text"],
                jd_parsed=d["jd_parsed"],
                role=d["role"],
                package_lpa=d["package_lpa"],
            )
            db.add(drive)
            drive_objs.append(drive)

            # Add eligibility rules
            parsed = d.get("jd_parsed", {})
            if parsed.get("min_cgpa"):
                db.add(EligibilityRule(
                    drive_id=d["id"], rule_type="min_cgpa",
                    rule_value=str(parsed["min_cgpa"]),
                ))
            if "max_backlogs" in parsed:
                db.add(EligibilityRule(
                    drive_id=d["id"], rule_type="max_backlogs",
                    rule_value=str(parsed["max_backlogs"]),
                ))
            if parsed.get("allowed_branches"):
                db.add(EligibilityRule(
                    drive_id=d["id"], rule_type="allowed_branches",
                    rule_json={"branches": parsed["allowed_branches"]},
                ))

        logger.info(f"Added {len(data['drives'])} drives with eligibility rules")

        # ── Demo interview history (so a fresh DB doesn't open on all-zero KPIs) ──
        # One COMPLETED drive with a real interview round + slots + results,
        # plus a couple of drives in other pipeline states for variety.
        if drive_objs:
            completed = drive_objs[0]
            completed.status = DriveStatus.COMPLETED

            demo_round = InterviewRound(
                id="round_demo_completed",
                drive_id=completed.id,
                round_no=1,
                round_type=RoundType.TECHNICAL,
                start_datetime=datetime(2026, 8, 20, 9, 0),
                end_datetime=datetime(2026, 8, 20, 13, 0),
                mode="offline",
                venue="Interview Room 1",
                slot_duration_min=30,
            )
            db.add(demo_round)

            interviewees = data["students"][:8]
            for i, s in enumerate(interviewees):
                slot_start = demo_round.start_datetime + timedelta(minutes=30 * i)
                db.add(InterviewSlot(
                    id=f"slot_demo_{i+1:02d}",
                    round_id=demo_round.id,
                    student_id=s["roll_no"],
                    panel_id=f"panel_{(i % 20) + 1:03d}",
                    room_id=f"room_{(i % 10) + 1:03d}",
                    slot_start=slot_start,
                    slot_end=slot_start + timedelta(minutes=30),
                    status=SlotStatus.COMPLETED,
                    result="selected" if i < 5 else "rejected",
                ))
            logger.info(f"Added 1 completed drive with {len(interviewees)} interview outcomes")

        if len(drive_objs) > 1:
            drive_objs[1].status = DriveStatus.SCHEDULED
        if len(drive_objs) > 2:
            drive_objs[2].status = DriveStatus.ONGOING

        await db.commit()
        logger.success("✅ Database seeded successfully!")
        logger.info("Default credentials:")
        logger.info("  TPO      : tpo@college.edu / tpo@123")
        logger.info("  Student  : student@college.edu / student@123")
        logger.info("  Company  : hr@tcs.com / company@123")
        logger.info("  Panel    : panel@company.com / panel@123")


if __name__ == "__main__":
    asyncio.run(seed())
