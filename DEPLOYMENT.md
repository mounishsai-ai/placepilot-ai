# 🚀 PlacementAI — Deployment Guide

## Architecture Overview

```
Frontend (Next.js 14)  →  Vercel
Backend  (FastAPI)     →  Railway / Render
Database (PostgreSQL)  →  Railway Managed DB / Render PostgreSQL
Redis                  →  Railway Redis / Upstash
Vector DB (ChromaDB)   →  Local persist on backend container
```

---

## 🖥️ Local Development (Quick Start)

```bash
# Terminal 1 — Start DB + Redis
cd "e:\hackthon 7 days\backend"
docker compose up -d db redis

# Terminal 2 — Start Backend
cd "e:\hackthon 7 days\backend"
.\venv\Scripts\uvicorn app.main:app --reload --port 8000

# Terminal 3 — Start Frontend
cd "e:\hackthon 7 days\frontend"
npm run dev
```

**URLs:**
- Frontend: http://localhost:3000
- API Docs: http://localhost:8000/api/docs
- Health:   http://localhost:8000/health

---

## 🌐 Production Deployment

### Step 1 — Deploy Backend to Railway

1. Go to https://railway.app → New Project → Deploy from GitHub
2. Select the repo root, set **Root Directory** to `backend/`
3. Railway auto-detects `railway.toml`
4. Add environment variables:
   ```
   GEMINI_API_KEY=your_key_here
   SECRET_KEY=generate_32_char_random_string
   DATABASE_URL=<auto-set by Railway PostgreSQL plugin>
   REDIS_URL=<auto-set by Railway Redis plugin>
   FRONTEND_URL=https://your-app.vercel.app
   ENVIRONMENT=production
   UPLOAD_DIR=/tmp/uploads
   CHROMA_PERSIST_DIR=/tmp/chroma_db
   ```
5. Add **PostgreSQL** plugin → Railway sets `DATABASE_URL` automatically
6. Add **Redis** plugin → Railway sets `REDIS_URL` automatically
7. Note your backend URL: `https://your-backend.railway.app`

**Seed the database after first deploy:**
```bash
railway run python seed/seed_db.py
```

---

### Step 2 — Deploy Frontend to Vercel

1. Go to https://vercel.com → New Project → Import from GitHub
2. Set **Root Directory** to `frontend/`
3. Add environment variables:
   ```
   NEXT_PUBLIC_API_URL=https://your-backend.railway.app
   NEXT_PUBLIC_WS_URL=wss://your-backend.railway.app
   ```
4. Deploy — Vercel handles the rest

---

## 🔐 Default Credentials

| Role         | Email                  | Password     |
|--------------|------------------------|--------------|
| TPO          | tpo@college.edu        | tpo@123      |
| Student      | student@college.edu    | student@123  |
| Company HR   | hr@tcs.com             | company@123  |
| Panel Member | panel@company.com      | panel@123    |

---

## ⚙️ Environment Variables Reference

### Backend `.env`
```env
APP_NAME=PlacementAI
APP_ENV=development
SECRET_KEY=your-secret-key-here
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/placementai
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your-gemini-api-key
FRONTEND_URL=http://localhost:3000
UPLOAD_DIR=./uploads
CHROMA_PERSIST_DIR=./chroma_db
```

### Frontend `.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

---

## 🤖 AI Pipeline — How It Works

```
Company uploads JD
        ↓
[JD Analyst Agent] — Gemini extracts: role, skills, CGPA cutoff, branches, package
        ↓
[Eligibility Agent] — Rule-based filter: CGPA, backlogs, attendance, branch
        ↓
[Matcher Agent] — ChromaDB vector search + TF-IDF fallback → ranked shortlist
        ↓
⏸ Human-in-the-Loop: TPO reviews & approves shortlist
        ↓
[Scheduler Agent] — FCFS slot allocation, conflict detection
        ↓
⏸ Human-in-the-Loop: TPO confirms schedule
        ↓
[Notifier Agent] — Email/SMS/WhatsApp invitations sent
        ↓
Panel marks interview results → Drive marked COMPLETED
```

---

## 📊 Tech Stack

| Layer        | Technology                          |
|--------------|-------------------------------------|
| LLM          | Gemini 1.5 Flash (free tier)        |
| Agent Framework | LangGraph (stateful, HITL)       |
| Backend      | FastAPI + SQLAlchemy async          |
| Database     | PostgreSQL 16                       |
| Cache        | Redis 7                             |
| Vector DB    | ChromaDB (local persist)            |
| Embeddings   | Google `text-embedding-004`         |
| Frontend     | Next.js 14 App Router + TypeScript  |
| Styling      | Tailwind CSS + Glassmorphism        |
| Animations   | Framer Motion                       |
| State        | Zustand (persisted auth)            |
| Real-time    | WebSocket (FastAPI)                 |
| Auth         | JWT (4 roles: TPO/Student/Company/Panel) |

---

## 🏆 Key Features for Demo

1. **Login** → Select role card → auto-fills credentials → Sign In
2. **TPO Dashboard** → KPIs, live agent feed, pending approvals
3. **Run Pipeline** → Click any drive → "Run AI Pipeline" → watch live events
4. **Human-in-the-Loop** → Drives page → "Review Shortlist" modal → AI rankings with Gemini explanations
5. **Analytics** → Real skill gap charts, readiness donut, branch breakdown
6. **Company Portal** → 4-step wizard: JD upload → AI extract → confirm → pipeline
7. **Student Portal** → Readiness circle, matches, schedule, AI skill advice, resume upload
8. **Panel Portal** → Mark interview results with feedback
