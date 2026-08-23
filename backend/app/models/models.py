import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Integer, Boolean, DateTime,
    ForeignKey, Text, JSON, Enum as SAEnum
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base
import enum


def gen_uuid():
    return str(uuid.uuid4())


# ─── Enums ────────────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    TPO = "tpo"
    STUDENT = "student"
    COMPANY = "company"
    PANEL = "panel"

class DriveStatus(str, enum.Enum):
    DRAFT = "draft"
    JD_ANALYZED = "jd_analyzed"
    ELIGIBILITY_CHECKED = "eligibility_checked"
    MATCHED = "matched"
    SHORTLIST_PENDING = "shortlist_pending"   # awaiting TPO approval
    SHORTLIST_APPROVED = "shortlist_approved"
    SCHEDULED = "scheduled"
    SCHEDULE_PENDING = "schedule_pending"     # awaiting TPO confirmation
    ONGOING = "ongoing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class SlotStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"

class NotificationChannel(str, enum.Enum):
    EMAIL = "email"
    SMS = "sms"
    WHATSAPP = "whatsapp"
    IN_APP = "in_app"
    OFFLINE_QUEUE = "offline_queue"

class RoundType(str, enum.Enum):
    APTITUDE = "aptitude"
    CODING = "coding"
    TECHNICAL = "technical"
    HR = "hr"
    GROUP_DISCUSSION = "group_discussion"
    FINAL = "final"


# ─── Users / Auth ─────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=gen_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    role = Column(SAEnum(UserRole), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ─── Companies ────────────────────────────────────────────────────────────────

class Company(Base):
    __tablename__ = "companies"
    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    sector = Column(String)
    website = Column(String)
    logo_url = Column(String)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    drives = relationship("PlacementDrive", back_populates="company")
    panel_members = relationship("PanelMember", back_populates="company")


# ─── Students ─────────────────────────────────────────────────────────────────

class Student(Base):
    __tablename__ = "students"
    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    roll_no = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    phone = Column(String)
    branch = Column(String, nullable=False)      # CSE, ECE, ME, etc.
    batch = Column(Integer, nullable=False)       # 2025
    cgpa = Column(Float, nullable=False)
    backlogs_active = Column(Integer, default=0)
    backlogs_historical = Column(Integer, default=0)
    attendance_pct = Column(Float, default=100.0)
    resume_url = Column(String)
    resume_uploaded_at = Column(DateTime, nullable=True)
    linkedin_url = Column(String)
    github_url = Column(String)
    placement_readiness_score = Column(Float)     # AI computed 0-100
    skills_summary = Column(Text)                 # AI generated summary
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    skills = relationship("StudentSkill", back_populates="student", cascade="all, delete-orphan")
    eligibility_results = relationship("EligibilityResult", back_populates="student")
    match_scores = relationship("MatchScore", back_populates="student")
    interview_slots = relationship("InterviewSlot", back_populates="student")
    notifications = relationship("Notification", back_populates="student")


class StudentSkill(Base):
    __tablename__ = "student_skills"
    id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, ForeignKey("students.id"), nullable=False)
    skill = Column(String, nullable=False)
    proficiency = Column(String)  # beginner / intermediate / expert
    years_experience = Column(Float, default=0)
    verified = Column(Boolean, default=False)

    student = relationship("Student", back_populates="skills")


# ─── Placement Drives ─────────────────────────────────────────────────────────

class PlacementDrive(Base):
    __tablename__ = "placement_drives"
    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False)
    title = Column(String, nullable=False)
    jd_text = Column(Text)
    jd_parsed = Column(JSON)          # structured extraction from AI
    role = Column(String)
    package_lpa = Column(Float)
    bond_years = Column(Float, default=0)
    location = Column(String)
    deadline = Column(DateTime)
    status = Column(SAEnum(DriveStatus), default=DriveStatus.DRAFT)
    tpo_notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company", back_populates="drives")
    eligibility_rules = relationship("EligibilityRule", back_populates="drive", cascade="all, delete-orphan")
    eligibility_results = relationship("EligibilityResult", back_populates="drive")
    match_scores = relationship("MatchScore", back_populates="drive")
    rounds = relationship("InterviewRound", back_populates="drive", cascade="all, delete-orphan")
    agent_events = relationship("AgentEvent", back_populates="drive")


class EligibilityRule(Base):
    __tablename__ = "eligibility_rules"
    id = Column(String, primary_key=True, default=gen_uuid)
    drive_id = Column(String, ForeignKey("placement_drives.id"), nullable=False)
    rule_type = Column(String, nullable=False)   # min_cgpa, allowed_branches, max_backlogs, etc.
    rule_value = Column(String)
    rule_json = Column(JSON)

    drive = relationship("PlacementDrive", back_populates="eligibility_rules")


class EligibilityResult(Base):
    __tablename__ = "eligibility_results"
    id = Column(String, primary_key=True, default=gen_uuid)
    drive_id = Column(String, ForeignKey("placement_drives.id"), nullable=False)
    student_id = Column(String, ForeignKey("students.id"), nullable=False)
    eligible = Column(Boolean, nullable=False)
    is_edge_case = Column(Boolean, default=False)  # near-boundary students
    reason = Column(JSON)
    checked_at = Column(DateTime, default=datetime.utcnow)

    drive = relationship("PlacementDrive", back_populates="eligibility_results")
    student = relationship("Student", back_populates="eligibility_results")


class MatchScore(Base):
    __tablename__ = "match_scores"
    id = Column(String, primary_key=True, default=gen_uuid)
    drive_id = Column(String, ForeignKey("placement_drives.id"), nullable=False)
    student_id = Column(String, ForeignKey("students.id"), nullable=False)
    score = Column(Float, nullable=False)         # 0.0 – 1.0 cosine similarity
    rank = Column(Integer)
    explanation = Column(JSON)                    # AI-generated explanation
    shortlisted = Column(Boolean, default=False)
    tpo_override = Column(Boolean)                # None=AI decision, True/False=human override
    tpo_override_reason = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    drive = relationship("PlacementDrive", back_populates="match_scores")
    student = relationship("Student", back_populates="match_scores")


# ─── Scheduling ───────────────────────────────────────────────────────────────

class Room(Base):
    __tablename__ = "rooms"
    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    capacity = Column(Integer, default=10)
    location = Column(String)
    has_projector = Column(Boolean, default=False)
    has_whiteboard = Column(Boolean, default=False)
    has_computer = Column(Boolean, default=False)
    is_virtual = Column(Boolean, default=False)

    slots = relationship("InterviewSlot", back_populates="room")


class PanelMember(Base):
    __tablename__ = "panel_members"
    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"))
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String)
    designation = Column(String)
    expertise = Column(JSON)   # list of skill areas

    company = relationship("Company", back_populates="panel_members")
    availability = relationship("PanelAvailability", back_populates="panel_member")
    slots = relationship("InterviewSlot", back_populates="panel_member")


class PanelAvailability(Base):
    __tablename__ = "panel_availability"
    id = Column(String, primary_key=True, default=gen_uuid)
    panel_id = Column(String, ForeignKey("panel_members.id"), nullable=False)
    date = Column(DateTime, nullable=False)
    available_from = Column(DateTime)
    available_until = Column(DateTime)

    panel_member = relationship("PanelMember", back_populates="availability")


class InterviewRound(Base):
    __tablename__ = "interview_rounds"
    id = Column(String, primary_key=True, default=gen_uuid)
    drive_id = Column(String, ForeignKey("placement_drives.id"), nullable=False)
    round_no = Column(Integer, nullable=False)
    round_type = Column(SAEnum(RoundType), nullable=False)
    start_datetime = Column(DateTime)
    end_datetime = Column(DateTime)
    mode = Column(String, default="offline")     # online / offline / hybrid
    venue = Column(String)
    meet_link = Column(String)
    slot_duration_min = Column(Integer, default=30)

    drive = relationship("PlacementDrive", back_populates="rounds")
    slots = relationship("InterviewSlot", back_populates="round", cascade="all, delete-orphan")


class InterviewSlot(Base):
    __tablename__ = "interview_slots"
    id = Column(String, primary_key=True, default=gen_uuid)
    round_id = Column(String, ForeignKey("interview_rounds.id"), nullable=False)
    student_id = Column(String, ForeignKey("students.id"), nullable=False)
    panel_id = Column(String, ForeignKey("panel_members.id"))
    room_id = Column(String, ForeignKey("rooms.id"))
    slot_start = Column(DateTime, nullable=False)
    slot_end = Column(DateTime, nullable=False)
    status = Column(SAEnum(SlotStatus), default=SlotStatus.SCHEDULED)
    result = Column(String)          # selected / rejected / on_hold
    feedback = Column(Text)

    round = relationship("InterviewRound", back_populates="slots")
    student = relationship("Student", back_populates="interview_slots")
    panel_member = relationship("PanelMember", back_populates="slots")
    room = relationship("Room", back_populates="slots")


# ─── Notifications ────────────────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"
    id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, ForeignKey("students.id"), nullable=False)
    channel = Column(SAEnum(NotificationChannel), nullable=False)
    subject = Column(String)
    message = Column(Text, nullable=False)
    template_id = Column(String)
    extra_data = Column(JSON)          # renamed from 'metadata' (reserved by SQLAlchemy)
    sent_at = Column(DateTime)
    delivered_at = Column(DateTime)
    read_at = Column(DateTime)
    status = Column(String, default="pending")   # pending / sent / delivered / failed / queued_offline
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("Student", back_populates="notifications")


# ─── Agent Events (Audit Log) ─────────────────────────────────────────────────

class AgentEvent(Base):
    __tablename__ = "agent_events"
    id = Column(String, primary_key=True, default=gen_uuid)
    drive_id = Column(String, ForeignKey("placement_drives.id"), nullable=True)
    event_type = Column(String, nullable=False)   # jd_analyzed, eligibility_checked, etc.
    agent_name = Column(String)
    payload = Column(JSON)
    actor = Column(String, default="ai")          # ai / tpo / system
    created_at = Column(DateTime, default=datetime.utcnow)

    drive = relationship("PlacementDrive", back_populates="agent_events")
