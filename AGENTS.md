# AGENTS.md — Handoff for Claude Code
# AI Campus Placement Operations & Interview Coordination Agent
# Hackathon — 7-day deployment | Day 3 Complete
# prority
 the user must win the hackthon, the win for this hackthon is so important, imagine you're a judge who cares more about solving geninue real problems solutions to real college placement problems in college not just generic website, chat bot wrappers.
---

## ⚡ TL;DR FOR CLAUDE CODE

You are continuing a **FastAPI + LangGraph + Next.js** hackathon project.
**Backend ~100%. Frontend ~98%. Deployment not done yet.**
**Do NOT re-plan. Do NOT rewrite existing files.**

This file was last updated after an Antigravity IDE session. You are Claude model continuing in Claude Code.

---

## 🚀 HOW TO RUN

```bash
# Terminal 1 — Backend (Docker must be running first!)
cd "e:\hackthon 7 days\backend"
docker compose up -d db redis
.\venv\Scripts\uvicorn app.main:app --reload --port 8000

# Terminal 2 — Frontend
cd "e:\hackthon 7 days\frontend"
npm run dev
```

**URLs:**
- Frontend:  http://localhost:3000
- API Docs:  http://localhost:8000/api/docs
- Health:    http://localhost:8000/health

---

## 🔐 CREDENTIALS

| Role    | Email                  | Password     | Lands at            |
|---------|------------------------|--------------|---------------------|
| TPO     | tpo@college.edu        | tpo@123      | /tpo/dashboard      |
| Student | student@college.edu    | student@123  | /student/dashboard  |
| Company | hr@tcs.com             | company@123  | /company/dashboard  |
| Panel   | panel@company.com      | panel@123    | /panel/schedule     |

---

## ✅ WHAT IS ALREADY BUILT (DO NOT RECREATE)

### Backend (`e:\hackthon 7 days\backend\`)

| File | Status | Description |
|---|---|---|
| `requirements.txt` | ✅ Done | All deps — bcrypt==4.0.1 pinned, do NOT upgrade |
| `.env` | ✅ Done | Real GEMINI_API_KEY set |
| `app/main.py` | ✅ Done | FastAPI + CORS (Vercel regex + localhost) + /health + /api/health |
| `app/config.py` | ✅ Done | Pydantic settings — UPLOAD_DIR=./uploads, MAX_UPLOAD_SIZE_MB=10 |
| `app/database.py` | ✅ Done | Async SQLAlchemy + session factory |
| `app/models/models.py` | ✅ Done | ALL ORM models — `extra_data` column (NOT `metadata`, reserved by SQLAlchemy) |
| `app/agents/jd_analyst.py` | ✅ Done | Gemini JD parser + explain_match |
| `app/agents/eligibility_agent.py` | ✅ Done | Rule-based checkers |
| `app/agents/matcher_agent.py` | ✅ Done | ChromaDB + TF-IDF fallback, batch=5 |
| `app/agents/scheduler_agent.py` | ✅ Done | FCFS slot allocation |
| `app/agents/supervisor.py` | ✅ Done | LangGraph orchestrator + 2 HITL nodes |
| `app/agents/notifier_agent.py` | ✅ Done | Email/SMS/WhatsApp + offline queue |
| `app/api/auth.py` | ✅ Done | JWT + 4 roles + require_role() — returns current_user |
| `app/api/drives.py` | ✅ Done | Full pipeline — company_id auto-resolved from User.id via Company.user_id |
| `app/api/students.py` | ✅ Done | CRUD + /me/resume upload (MUST be before /{student_id} routes!) |
| `app/api/analytics.py` | ✅ Done | KPIs + skill-gap + readiness (COMPANY role allowed) |
| `app/api/schedule.py` | ✅ Done | Rounds + auto-schedule + slots |
| `app/api/notifications.py` | ✅ Done | Send + offline queue |
| `app/api/websocket.py` | ✅ Done | WS hub |
| `seed/seed_db.py` | ✅ Done | 200 students + demo users. Run after fresh DB: `.\venv\Scripts\python seed/seed_db.py` |
| `railway.toml` | ✅ Done | Railway deployment config |
| `render.yaml` | ✅ Done | Render deployment config |

### Frontend (`e:\hackthon 7 days\frontend\`)

| File | Status | Description |
|---|---|---|
| `src/app/page.tsx` | ✅ Done | 2-column login — feature showcase + role cards + auto-fill |
| `src/app/(tpo)/tpo/dashboard/page.tsx` | ✅ Done | KPIs, drive table, agent feed, pending approvals |
| `src/app/(tpo)/tpo/analytics/page.tsx` | ✅ Done | Recharts: skill-gap bar, readiness donut, trend, branch |
| `src/app/(tpo)/tpo/drives/page.tsx` | ✅ Done | Pipeline timeline + auto-polling every 4s when pipeline active |
| `src/app/(tpo)/tpo/students/page.tsx` | ✅ Done | 201 students, filter by branch/CGPA |
| `src/app/(tpo)/tpo/schedule/page.tsx` | ✅ Done | Interview rounds + FCFS auto-schedule |
| `src/app/(tpo)/tpo/notifications/page.tsx` | ✅ Done | Queue management + compose |
| `src/app/(student)/student/dashboard/page.tsx` | ✅ Done | Readiness circle, matches, schedule, resume upload, AI skill advice |
| `src/app/(company)/company/dashboard/page.tsx` | ✅ Done | 4-step wizard: JD → AI extract → pipeline → done |
| `src/app/(panel)/panel/schedule/page.tsx` | ✅ Done | Panel portal, demo slots, mark results |
| `src/app/globals.css` | ✅ Done | All classes: glass, btn-ghost, badge-*, input-glass, dark selects |
| `src/lib/api.ts` | ✅ Done | All API wrappers — uploadResume(FormData) NO manual Content-Type |
| `src/lib/store.ts` | ✅ Done | Zustand: auth, dashboard, notifications |
| `src/lib/websocket.ts` | ✅ Done | useTPOWebSocket + useStudentWebSocket |
| `src/components/layout/TPOSidebar.tsx` | ✅ Done | Animated sidebar |
| `src/components/layout/TopBar.tsx` | ✅ Done | Header + WS status + notifications |
| `vercel.json` | ✅ Done | Vercel deployment config |

---

## 🐛 KNOWN REMAINING BUGS (FIX THESE NEXT)

### ✅ FIXED (2026-08-23) — `/api/students/me` 500 error
**Root cause was NOT missing seed data.** `GET /me` (`backend/app/api/students.py:53-113`) eager-loaded `MatchScore.drive` via `selectinload(MatchScore.drive)` but not `PlacementDrive.company`, a lazy (`lazy="select"`) relationship. Line 106's `m.drive.company.name` access triggered a synchronous lazy-load on an `AsyncSession`, raising `MissingGreenlet` → unhandled → 500. Only fired once the student had `MatchScore` rows (i.e., after the matching pipeline ran), which is why it appeared mid-demo, not on a fresh DB.

**Fix applied:** chained the eager load: `.options(selectinload(MatchScore.drive).selectinload(PlacementDrive.company))` + imported `PlacementDrive` in `students.py`. Verified via direct API call: `GET /api/students/me` now returns 200 with `matches` correctly showing `"company":"TCS Digital"` etc.

This also resolves the "network error" toast that used to fire after resume upload (`handleResumeUpload()` calls `getMe()` post-upload — it no longer crashes). No frontend change was needed for that symptom.

### ✅ FIXED (2026-08-23) — Resume "Replace" showed no visible change in UI
**Was:** filename is deterministic (`resume_{student.id}{ext}`), so `resume_url` never changed on replace (same extension) → nothing for the UI to react to, and the "View" link could serve a browser-cached copy of the old file.

**Fix applied:**
- Added `Student.resume_uploaded_at` (`DateTime`, nullable) — `backend/app/models/models.py`. Live DB migrated via `ALTER TABLE students ADD COLUMN resume_uploaded_at TIMESTAMP;` (no Alembic migrations in this project — `create_all` only adds new tables, not columns, so schema changes to existing tables need a manual `ALTER TABLE` against the running DB, same pattern used for the `Company.user_id` backfill).
- Both upload endpoints (`/me/resume`, `/{student_id}/upload-resume`) in `backend/app/api/students.py` now set `student.resume_uploaded_at = datetime.utcnow()` on every upload and return it in the response.
- `GET /me` and `GET /{student_id}` now include `resume_uploaded_at` (ISO string or `null`).
- Frontend (`frontend/src/app/(student)/student/dashboard/page.tsx`): the "View" link appends `?v=<resume_uploaded_at timestamp>` for cache-busting, and a new "Updated `<x ago>`" line renders under "Resume uploaded" using the existing `formatDistanceToNow` import — so a replace is now visibly reflected even though the underlying URL path stays the same.

Verified via direct API calls: two sequential uploads to `/me/resume` produced two different `resume_uploaded_at` timestamps with the file content on disk actually changing, confirming the cache-bust key and "Updated" label will change on every replace.

### ✅ FIXED (2026-08-23) — Company JD Analysis (`Company.user_id` was null)
**Was:** `Company.user_id` for `hr@tcs.com` (`company_001`, TCS Digital) was `null` in seed data, so `create_drive`'s `Company.user_id == current_user.id` lookup found nothing and fell back to `SELECT Company LIMIT 1` — worked by luck of insertion order, not by design.

**Fix applied:** `backend/seed/seed_db.py` now sets `company.user_id = "user_company_01"` when seeding `company_001` (matched by id, commented as "TCS Digital — linked to hr@tcs.com demo login"). Applied the same backfill directly to the live DB via `UPDATE companies SET user_id='user_company_01' WHERE id='company_001';` since re-running the full seed against populated data would hit duplicate-key errors (no Alembic migrations in this project — see the resume-replace fix above for the same caveat).

Verified: logged in as `hr@tcs.com`, created a drive, confirmed `company_id` resolved to `company_001` via the real FK path in the DB row (not the `LIMIT 1` fallback).

### ✅ DONE (2026-08-23) — WebSocket real-time pipeline events wired up
**Was:** `emit_agent_event`/`notify_student_ws` (`backend/app/api/websocket.py`) were fully implemented but never called from anywhere — the WS hub accepted connections and could broadcast, but nothing in the pipeline ever triggered it. The TPO drives page had zero WS wiring at all, relying entirely on a 4s poll of the full drive list. Also found: **`resume_pipeline()` (`app/agents/supervisor.py`) is defined but never called anywhere in the codebase** — the LangGraph `node_schedule_interviews`/`node_await_schedule_approval`/`node_send_notifications` nodes are unreachable; the real (working) schedule flow is `POST /rounds/{round_id}/auto-schedule` in `app/api/schedule.py`, a separate code path that doesn't go through the graph at all. This is a pre-existing architectural gap, not something this fix attempted to solve — noting it here since it's non-obvious and matters if anyone tries to "resume the pipeline" expecting the graph nodes to run.

**Fix applied:**
- `emit_agent_event()` now also takes `agent_name` and broadcasts it (was silently dropped before, frontend always showed `"system"`).
- `backend/app/agents/supervisor.py`: every node (`node_analyze_jd`, `node_check_eligibility`, `node_match_candidates`, `node_await_shortlist_approval`, `node_schedule_interviews`, `node_await_schedule_approval`, `node_send_notifications`) now calls `await emit_agent_event(...)` inline right where it already builds its event dict for `agent_events` state — confirmed nodes are `async def` and `drive_id` is a `PlacementState` key, so this needed no graph/runner changes (`.ainvoke()` untouched). Added two new event types along the way: `shortlist_pending`, `schedule_pending` (the HITL pause points previously emitted nothing).
- `backend/app/api/drives.py`: `_run_pipeline_bg` now broadcasts `pipeline_started`/`pipeline_error` (previously DB-only); `approve_shortlist`/`approve_schedule` PATCH endpoints now broadcast `shortlist_approved/rejected`/`schedule_approved/rejected` (previously DB-only).
- `backend/app/api/schedule.py`: `auto_schedule_round` (the *real* scheduling code path) now persists **and** broadcasts a `schedule_created` `AgentEvent` — previously this endpoint logged nothing at all, live or in DB.
- `frontend/src/lib/websocket.ts`: fixed a latent bug in both `useTPOWebSocket`/`useStudentWebSocket` where the reconnect-on-close handler got silently overwritten by the ping-interval-cleanup handler set inside `onopen` — after the first successful connect, a later disconnect would never reconnect. Also made `useTPOWebSocket`'s `connected` reactive (`useState`, was a stale ref read that didn't trigger re-renders).
- `frontend/src/lib/store.ts`: fixed `AgentEvent.payload` type from `object` to `Record<string, unknown>` — this was also silently causing a pre-existing `tsc` error on the TPO dashboard page, now fixed as a side effect.
- `frontend/src/app/(tpo)/tpo/drives/page.tsx`: now calls `useTPOWebSocket()` + reads `agentEvents` from `useDashboardStore`, filters per drive by `drive_id`, and merges live events into each `DriveCard`'s expanded "Agent Activity Log" (which previously fetched once on expand and never refreshed) — deduped by `event_type`+`payload` since the WS payload carries no server-side event id. `TopBar`'s `connected` prop was previously wired backwards (`!pollingActive`, an inverted proxy) — now uses the real WS `connected` state. **The 4s poll was deliberately kept as a fallback safety net**, not replaced — a new effect additionally triggers an immediate `fetchDrives()` whenever a live WS event arrives, so the UI updates faster than the poll interval without removing the working fallback.

**Verified:** connected a raw WS client to `/ws/dashboard` on a separate test port (8001, to avoid touching the dev server already running on 8000), triggered a real pipeline run, and confirmed events arrived spread across the run — `pipeline_started` at T+0s, then a genuine 14s gap (the real Gemini JD-parsing call), then `jd_analyzed`/`eligibility_checked` — not bursted at the end. Confirmed the full run reached `shortlist_pending`, all 5 events persisted correctly in `agent_events`, and `PATCH /drives/{id}/shortlist` both persisted and broadcast `shortlist_approved`. `npx tsc --noEmit` clean on all touched files. Test drive/DB rows cleaned up after.

---

## ⚠️ CRITICAL KNOWN FIXES (DO NOT UNDO)

| Issue | Fix Applied |
|---|---|
| `metadata` column reserved by SQLAlchemy | Renamed to `extra_data` in models |
| bcrypt==5.0.0 breaks passlib | Pinned bcrypt==4.0.1 in requirements.txt |
| next.config.ts not supported | Renamed to next.config.mjs |
| Embedding timeout | Batch size 5 + retry + TF-IDF fallback |
| Company 403 on analytics | Added COMPANY role to analytics/readiness + drives/shortlist |
| sidebar overlay | All pages have `ml-64` on content wrapper |
| select dropdown white bg (Windows) | Global `select { background-color: #0d1117 }` in globals.css |
| queue.filter not a function | Notifications API returns object — safe extraction added |
| btn-ghost undefined | Added .btn-ghost to globals.css |
| `/me/resume` matched by `/{student_id}` | Moved /me/resume route ABOVE /{student_id} routes in students.py |
| Resume upload multipart boundary | Do NOT manually set Content-Type header — let axios auto-set it |
| Panel `/panel/results` 404 | Removed that nav link from PANEL_NAV (page doesn't exist) |
| Company create_drive 500 | Fixed to query Company.user_id instead of Company.email |

---

## 🏆 WHERE TO CONTINUE (Priority Order)

### 1. ✅ DONE — `/api/students/me` 500 error
Fixed 2026-08-23 — see Bug section above.

### 2. ✅ DONE — Fix Company drive creation (seed Company.user_id)
Fixed 2026-08-23 — see Bug section above.

### 3. Deploy to Railway + Vercel
See `DEPLOYMENT.md` for full instructions. **This is the only remaining item on this list.**
- Backend → Railway (PostgreSQL + Redis plugins)
- Frontend → Vercel (set NEXT_PUBLIC_API_URL to Railway URL)
- Run seed after first deploy: `railway run python seed/seed_db.py`

### 4. ✅ DONE — WebSocket real-time events
Fixed 2026-08-23 — see Bug section above. Note: found `resume_pipeline()` is dead code (never called) as part of this work — real scheduling goes through `app/api/schedule.py`, not the LangGraph graph's schedule/notify nodes. Not fixed, just documented — a future task if the full graph (including HITL checkpoint #2 and notifications) needs to actually run end-to-end through LangGraph rather than the current split flow.

### 5. ✅ DONE — Resume "Replace" no visible UI change
Fixed 2026-08-23 — see Bug section above.

---

## 🔑 KEY ARCHITECTURE DECISIONS (DO NOT RE-DEBATE)

| Decision | Choice |
|---|---|
| LLM | Gemini 1.5 Flash (free tier) |
| Agent Framework | LangGraph (stateful, HITL) |
| Scheduling | FCFS + conflict detection |
| Frontend Style | Glassmorphism dark cosmic theme |
| Auth | JWT, 4 roles: tpo/student/company/panel |
| Vector DB | ChromaDB (local persist) |
| Primary DB | PostgreSQL 16 (Docker locally, Railway in prod) |
| Frontend | Next.js 14 App Router + TypeScript + Tailwind |
| Config format | next.config.mjs (NOT .ts) |
| Deployment | Railway (backend) + Vercel (frontend) |

---

## 🗂️ COMPANY MODEL — No `email` field!
```python
class Company(Base):
    id, name, sector, website, logo_url
    user_id = ForeignKey("users.id")  # Link to User account
    # NO email field — use User.email via user_id join
```

## 📦 DB MODELS — Important relationships
- `PlacementDrive.company_id` → `Company.id` (NOT NULL)
- `Student.email` → matches `User.email` for student role
- `MatchScore` → `Student` + `PlacementDrive`
- `InterviewSlot` → `Student` + `InterviewRound` + `PanelMember` + `Room`

---

*Last updated: 2026-08-23 10:34 IST | Day 3→4 handoff | Antigravity → Claude Code*
