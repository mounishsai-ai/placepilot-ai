# AGENTS.md — Handoff for Next Agent
# AI Campus Placement Operations & Interview Coordination Agent
# Hackathon — 7-day deployment

---

## ⚡ TL;DR FOR NEXT AGENT

You are continuing a **FastAPI + LangGraph + Next.js** hackathon project.
**The project is ~97% COMPLETE. Backend 100%. Frontend 100%.**
**Do NOT re-plan. Do NOT rewrite existing files.**

Focus: Day 4+ polish, deployment to live URL, and winning!
See **"WHERE TO CONTINUE"** section below.

---

## ✅ WHAT IS ALREADY BUILT (DO NOT RECREATE)

### Backend (`e:\hackthon 7 days\backend\`)

| File | Status | Description |
|---|---|---|
| `requirements.txt` | ✅ Done | All Python deps (bcrypt==4.0.1 pinned — do NOT upgrade) |
| `.env` | ✅ Done | Real env with GEMINI_API_KEY set |
| `app/main.py` | ✅ Done | FastAPI + CORS (Vercel regex) + /health endpoint |
| `app/config.py` | ✅ Done | Pydantic settings |
| `app/database.py` | ✅ Done | Async SQLAlchemy + session factory |
| `app/models/models.py` | ✅ Done | ALL ORM models (extra_data, NOT metadata) |
| `app/agents/jd_analyst.py` | ✅ Done | Gemini JD parser + explain_match |
| `app/agents/eligibility_agent.py` | ✅ Done | Rule-based checkers |
| `app/agents/matcher_agent.py` | ✅ Done | ChromaDB + TF-IDF fallback, batch=5 |
| `app/agents/scheduler_agent.py` | ✅ Done | FCFS slot allocation |
| `app/agents/supervisor.py` | ✅ Done | LangGraph orchestrator + 2 HITL nodes |
| `app/agents/notifier_agent.py` | ✅ Done | Email/SMS/WhatsApp + offline queue |
| `app/api/auth.py` | ✅ Done | JWT + 4 roles + require_role() |
| `app/api/drives.py` | ✅ Done | Full pipeline + COMPANY role allowed |
| `app/api/students.py` | ✅ Done | CRUD + /me/resume upload + schedule + matches |
| `app/api/analytics.py` | ✅ Done | KPIs + skill-gap + readiness (COMPANY role allowed) |
| `app/api/schedule.py` | ✅ Done | Rounds + auto-schedule + slots |
| `app/api/notifications.py` | ✅ Done | Send + offline queue |
| `app/api/websocket.py` | ✅ Done | WS hub |
| `seed/seed_db.py` | ✅ Done | 200 students + Arjun Sharma linked to student@college.edu |
| `railway.toml` | ✅ Done | Railway deployment config |
| `render.yaml` | ✅ Done | Render deployment config |

### Frontend (`e:\hackthon 7 days\frontend\`)

| File | Status | Description |
|---|---|---|
| `src/app/page.tsx` | ✅ Done | **2-column login** — feature showcase + role cards + auto-fill |
| `src/app/(tpo)/tpo/dashboard/page.tsx` | ✅ Done | KPIs, drive table, agent feed, pending approvals |
| `src/app/(tpo)/tpo/analytics/page.tsx` | ✅ Done | Recharts: skill-gap bar, readiness donut, trend, branch |
| `src/app/(tpo)/tpo/drives/page.tsx` | ✅ Done | Pipeline timeline, **auto-polling**, HITL shortlist modal |
| `src/app/(tpo)/tpo/students/page.tsx` | ✅ Done | 201 students, filter by branch/CGPA |
| `src/app/(tpo)/tpo/schedule/page.tsx` | ✅ Done | Interview rounds + FCFS auto-schedule |
| `src/app/(tpo)/tpo/notifications/page.tsx` | ✅ Done | Queue management + compose |
| `src/app/(student)/student/dashboard/page.tsx` | ✅ Done | Readiness circle, matches, schedule, **resume upload**, AI skill advice |
| `src/app/(company)/company/dashboard/page.tsx` | ✅ Done | **4-step wizard**: JD upload → AI extract → pipeline → done |
| `src/app/(panel)/panel/schedule/page.tsx` | ✅ Done | **Full panel portal** with sidebar, demo slots, mark results |
| `src/app/globals.css` | ✅ Done | All classes: glass, btn-ghost, badge-*, input-glass, dark selects |
| `src/lib/api.ts` | ✅ Done | All API wrappers + uploadResume(FormData) |
| `src/lib/store.ts` | ✅ Done | Zustand: auth, dashboard, notifications |
| `src/lib/websocket.ts` | ✅ Done | useTPOWebSocket + useStudentWebSocket |
| `src/components/layout/TPOSidebar.tsx` | ✅ Done | Animated sidebar |
| `src/components/layout/TopBar.tsx` | ✅ Done | Header + WS status + notifications |
| `vercel.json` | ✅ Done | Vercel deployment config |

---

## 🚀 HOW TO RUN

```bash
# Terminal 1 — Backend
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

| Role | Email | Password |
|---|---|---|
| TPO | tpo@college.edu | tpo@123 |
| Student | student@college.edu | student@123 |
| Company | hr@tcs.com | company@123 |
| Panel | panel@company.com | panel@123 |

---

## ⚠️ KNOWN FIXES (DO NOT UNDO)

| Issue | Fix |
|---|---|
| `metadata` column reserved by SQLAlchemy | Renamed to `extra_data` |
| bcrypt==5.0.0 breaks passlib | Pinned bcrypt==4.0.1 |
| next.config.ts not supported | Renamed to next.config.mjs |
| @radix-ui/react-badge missing | Removed from package.json |
| Embedding timeout | Batch size 5 + retry + TF-IDF fallback |
| Company 403 on analytics | Added COMPANY role to analytics/readiness + drives/shortlist |
| sidebar overlay (ml-64 missing) | All pages have `ml-64` on content wrapper |
| select dropdown white bg (Windows) | Global `select { background-color: #0d1117 }` in globals.css |
| queue.filter not a function | Notifications API returns object, not array — safe extraction added |
| btn-ghost undefined | Added .btn-ghost to globals.css |

---

## 🔴 WHERE TO CONTINUE (Day 4+)

### High Priority
1. **Deploy to Railway + Vercel** — see `DEPLOYMENT.md` for step-by-step
   - Backend → Railway (with PostgreSQL + Redis plugins)
   - Frontend → Vercel (set `NEXT_PUBLIC_API_URL` to Railway URL)
   - Run `railway run python seed/seed_db.py` after first deploy

2. **Real-time WebSocket polish** — the WS connects but events need to flow through from supervisor to frontend during pipeline execution

3. **Student skill gap API integration** — currently shows hardcoded advice cards; wire up to real `/api/analytics/skill-gap` data filtered by student's skills

### Medium Priority
4. Resume parsing with Gemini — when student uploads resume, auto-extract skills and update profile
5. Email notifications — configure SendGrid API key for real email delivery
6. Mobile responsiveness — pages are desktop-only currently

### Low Priority
7. `/tpo/drives/{id}` detail page — currently shows inline, could be a full detail page
8. Student registration flow — TPO can add students manually from the UI

---

## 🔑 KEY DECISIONS (MADE — DO NOT RE-DEBATE)

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

*Last updated: 2026-08-22 14:25 IST | Day 3 complete | Project: ~97% done*
