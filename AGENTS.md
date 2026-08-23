# AGENTS.md — Handoff for Claude Code
# AI Campus Placement Operations & Interview Coordination Agent
# Hackathon — 7-day deployment | Day 3 Complete

---

## ⚡ TL;DR FOR CLAUDE CODE

You are continuing a **FastAPI + LangGraph + Next.js** hackathon project.
**Backend ~100%. Frontend ~98%. Deployment not done yet.**
**Do NOT re-plan. Do NOT rewrite existing files.**

This file was last updated after an Antigravity IDE session. You are Claude Sonnet 4.6 continuing in Claude Code.

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

### 🔴 HIGH — Resume upload shows "network error"
**Root cause:** `GET /api/students/me` returns **500 Internal Server Error**  
The upload itself works (200 OK — file is saved to disk).  
But `handleResumeUpload()` calls `studentsAPI.getMe()` after upload to refresh the profile, and that 500 makes the whole try-catch fail with "network error".

**Fix needed in `frontend/src/app/(student)/student/dashboard/page.tsx`:**
```js
// Current broken code:
await studentsAPI.uploadResume(form);
const meRes = await studentsAPI.getMe();  // ← this crashes with 500
setProfile(meRes.data);

// Fix: don't block on getMe(), update resume_url from upload response directly
const res = await studentsAPI.uploadResume(form);
setProfile(p => ({ ...(p as Record<string, unknown>), resume_url: res.data.resume_url }));
toast.success("✅ Resume uploaded!");
```

**Also investigate why `/api/students/me` returns 500** — likely `Student` record not found for `student@college.edu` because the seed hasn't been run after the fresh Docker restart.  
Run: `.\venv\Scripts\python seed/seed_db.py`

### 🔴 HIGH — Company JD Analysis
**Root cause:** `Company.user_id` for `hr@tcs.com` is `null` in seed data — the Company record isn't linked to the User record.  
When company creates a drive, the code tries `Company.user_id == current_user.id` but finds nothing, falls back to `SELECT Company LIMIT 1`, which might not be TCS.

**Fix needed in `backend/app/api/drives.py`:**
The seed links User `user_company_01` to email `hr@tcs.com` but does NOT set `company.user_id = user_company_01`.  
Either fix the seed to set `user_id` on Company records, OR change the fallback to use the first available company (acceptable for demo).

**Fix in `seed/seed_db.py`:**
After creating the TCS company, set `company.user_id = "user_company_01"`.

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

### 1. Fix `/api/students/me` 500 error
Run seed first: `.\venv\Scripts\python seed/seed_db.py`  
Then debug the GET /me endpoint in `app/api/students.py` around line 53

### 2. Fix resume upload frontend (don't call getMe after upload)
See fix snippet above in Bug section

### 3. Fix Company drive creation (seed Company.user_id)
Add to seed_db.py after company creation:
```python
# Link company user to TCS company
tcs_company.user_id = "user_company_01"
```

### 4. Deploy to Railway + Vercel
See `DEPLOYMENT.md` for full instructions.
- Backend → Railway (PostgreSQL + Redis plugins)
- Frontend → Vercel (set NEXT_PUBLIC_API_URL to Railway URL)
- Run seed after first deploy: `railway run python seed/seed_db.py`

### 5. WebSocket real-time events
The WS connects but pipeline events need to flow from supervisor to frontend.
`src/lib/websocket.ts` has the hooks — wire up to drives page.

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
