# SYSTEM DESIGN — AI Campus Placement Operations & Interview Coordination Agent

> **Read this to understand the whole machine.** Every box, every file, every hop a
> byte makes from a click to the database and back. Written 2026-08-23 (Day 3) from a
> verified read of the actual code — not from the original plan.
>
> Companion docs: [AGENTS.md](AGENTS.md) = *what's broken and in what order to fix it*.
> This file = *what exists and how it fits together*.

---

## 0. TABLE OF CONTENTS

| § | Section |
|---|---|
| 1 | What this system does (the one-paragraph version) |
| 2 | The 10,000-foot view |
| 3 | The stack, and why each piece is here |
| 4 | The four personas |
| 5 | Complete component catalogue (every file, what it does) |
| 6 | The data model — 15 tables |
| 7 | The core flow: a JD becomes an interview schedule |
| 8 | The agent layer in detail (LangGraph) |
| 9 | The real-time layer (WebSocket) |
| 10 | Auth, roles, and the request lifecycle |
| 11 | Reality overlay: what's real vs. theater **← the important one** |
| 12 | Target state: where this is going |
| 13 | Deployment topology |
| 14 | Glossary |

---

## 1. WHAT THIS SYSTEM DOES

A college placement cell (the **TPO** — Training & Placement Officer) drowns in manual
work every hiring season: read each company's job description, figure out which of 200+
students are eligible, rank them by skill fit, book interview slots without
double-booking a room or an interviewer, and message everyone repeatedly.

This system automates that chain with a pipeline of AI agents, **but deliberately stops
and asks a human for approval at the decision points that matter.** The AI proposes;
the TPO disposes. That "human-in-the-loop" property is the core design commitment — it's
literally in the problem statement's objective sentence.

---

## 2. THE 10,000-FOOT VIEW

```
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │   COMPANY   │  │     TPO     │  │   STUDENT   │  │    PANEL    │
   │   (HR)      │  │  (staff)    │  │             │  │(interviewer)│
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                │                │
          └────────────────┴────────┬───────┴────────────────┘
                                    │  HTTPS (JWT) + WebSocket
                     ┌──────────────▼──────────────┐
                     │      NEXT.JS 14 FRONTEND    │   Vercel
                     │  App Router · TS · Tailwind │
                     │  Zustand · axios · Recharts │
                     └──────────────┬──────────────┘
                                    │  REST /api/*   ·   WS /ws/*
                     ┌──────────────▼──────────────┐
                     │      FASTAPI BACKEND        │   Railway
                     │  async SQLAlchemy · JWT     │
                     ├─────────────────────────────┤
                     │  AGENT LAYER (LangGraph)    │
                     │   JD Analyst → Eligibility  │
                     │   → Matcher → ⏸HUMAN GATE   │
                     │   → Scheduler → Notifier    │
                     └───┬────────┬────────┬───────┘
                         │        │        │
              ┌──────────▼──┐ ┌───▼─────┐ ┌▼──────────────┐
              │ PostgreSQL  │ │ChromaDB │ │  Gemini API   │
              │  15 tables  │ │ vectors │ │ 3.6/3.5-flash │
              │ (source of  │ │ (search │ │  + embeddings │
              │   truth)    │ │  index) │ │               │
              └─────────────┘ └─────────┘ └───────────────┘
```

**The one-line summary:** a React dashboard talks to a Python API, which runs a chain of
AI agents that read from Postgres, think with Gemini, search with ChromaDB, and stream
their progress back to the browser live over a WebSocket — pausing for human approval
in the middle.

---

## 3. THE STACK, AND WHY EACH PIECE IS HERE

| Layer | Choice | Why this and not something else |
|---|---|---|
| **Frontend framework** | Next.js 14 (App Router) | Route groups give clean per-role URL namespaces; deploys to Vercel with zero config |
| **Language** | TypeScript | Catches shape mismatches between API and UI at compile time |
| **Styling** | Tailwind + custom "glassmorphism dark cosmic" theme | Fast to write; the dark glass look reads as premium in a demo |
| **Animation** | Framer Motion | Page/card transitions, the live agent feed sliding in |
| **Charts** | Recharts | Skill-gap bars, readiness donut, branch breakdown |
| **Client state** | Zustand (3 stores) | Simpler than Redux; `persist` keeps you logged in across refresh |
| **HTTP** | axios + interceptors | One place to attach the JWT and one place to catch 401 → logout |
| **Backend framework** | FastAPI | Async-native (needed — agents make slow network calls), auto OpenAPI docs at `/api/docs` |
| **ORM** | SQLAlchemy 2.0 **async** | Non-blocking DB access so slow Gemini calls don't stall the event loop |
| **Database** | PostgreSQL 16 | Relational data with real foreign keys; JSON columns where structure is fluid |
| **Vector store** | ChromaDB (local persist) | Embeddable, no separate server to run — right call for a hackathon |
| **LLM** | Gemini `3.6-flash` / `3.5-flash-lite` | Free tier; flash-lite for volume, the bigger model for quality-critical JD parsing |
| **Agent framework** | LangGraph | Gives an explicit **state machine** with nodes/edges — which is what makes pause-for-human possible |
| **Real-time** | Native FastAPI WebSocket | No extra broker needed for one process |
| **Auth** | JWT (python-jose) + bcrypt | Stateless; the token carries the role |

> **Note:** `celery` and `redis` appear in `requirements.txt` and `docker-compose.yml`
> but are **imported nowhere**. They are leftovers from the original plan. See
> [AGENTS.md §5](AGENTS.md) — remove them, including from your pitch diagram.

---

## 4. THE FOUR PERSONAS

Each role logs into the same app and lands somewhere different. The role lives in the
JWT and is enforced server-side by `require_role(...)`.

| Role | Login | Lands at | Can do |
|---|---|---|---|
| **TPO** | `tpo@college.edu` / `tpo@123` | `/tpo/dashboard` | Everything. Approves shortlists & schedules, runs pipelines, sends notifications. The "boss" role. |
| **Company** | `hr@tcs.com` / `company@123` | `/company/dashboard` | Submit a JD, watch it get parsed, launch the pipeline. Cannot approve. |
| **Student** | `student@college.edu` / `student@123` | `/student/dashboard` | See own readiness score, matches, interview schedule; upload résumé. |
| **Panel** | `panel@company.com` / `panel@123` | `/panel/schedule` | See assigned interview slots, record result + feedback. |

---

## 5. COMPLETE COMPONENT CATALOGUE

### 5.1 Frontend — `frontend/src/`

#### Routing (Next.js App Router)

Parentheses = **route groups**: they organise files without appearing in the URL.

```
src/app/
├── layout.tsx              Root shell: fonts (Inter, JetBrains Mono), <Toaster>, dark bg
├── globals.css             Design system: .glass-card .btn-primary .badge-* .sidebar-item
├── page.tsx                "/"  → LOGIN. 2-column: feature showcase + 4 role cards
│                                 Clicking a role card auto-fills demo credentials.
├── (tpo)/tpo/
│   ├── dashboard/page.tsx    "/tpo/dashboard"     KPI cards, drive table, live agent feed
│   ├── drives/page.tsx       "/tpo/drives"        ★ THE CENTREPIECE (667 lines)
│   ├── students/page.tsx     "/tpo/students"      201 students, filter/sort, detail drawer
│   ├── schedule/page.tsx     "/tpo/schedule"      Interview rounds + FCFS auto-schedule
│   ├── analytics/page.tsx    "/tpo/analytics"     Recharts: skill gap, readiness, branch
│   └── notifications/page.tsx"/tpo/notifications" Offline queue + compose
├── (student)/student/dashboard/page.tsx   Readiness ring, matches, schedule, résumé upload
├── (company)/company/dashboard/page.tsx   4-step wizard: JD → AI preview → pipeline → done
└── (panel)/panel/schedule/page.tsx        Slot list, mark selected/rejected + feedback
```

#### Shared components — `src/components/`

| File | What it is |
|---|---|
| `layout/TPOSidebar.tsx` | Fixed 256px left nav (6 links). Animated active pill via Framer `layoutId`. Shows user email + Sign out. **Every TPO page must wrap content in `ml-64`** or the sidebar overlaps it. |
| `layout/TopBar.tsx` | 64px header: title, subtitle, **live/offline WS indicator**, notification bell with unread dot. |
| `ui/MetricCard.tsx` | The KPI tile. Takes `title`, `value`, `icon`, optional `trend`, and an `accentColor` (blue/green/amber/purple/cyan/rose) that drives a coloured ring + glow. |
| `ui/AgentEventFeed.tsx` | Renders the live agent activity list. Maps `agent_name` → colour + label (JD Analyst = blue, Matcher = purple, TPO = rose…) and `event_type` → human sentence ("JD parsed & structured"). Relative timestamps via `date-fns`. |

#### The lib layer — `src/lib/` (this is the glue; read these three first)

**`api.ts`** — one axios instance + six typed API modules.
```
axios.create({ baseURL: NEXT_PUBLIC_API_URL, timeout: 30000 })
  │
  ├─ request interceptor  → attaches "Authorization: Bearer <token>" from localStorage
  └─ response interceptor → on 401: clear storage + redirect to "/"   (global auto-logout)

exports: authAPI · drivesAPI · studentsAPI · analyticsAPI · scheduleAPI · notificationsAPI
```
> **Gotcha already fixed — do not undo:** `uploadResume` passes a `FormData` and must
> **not** set `Content-Type` manually, or the multipart boundary is lost.

**`store.ts`** — three Zustand stores.

| Store | Holds | Notes |
|---|---|---|
| `useAuthStore` | `user`, `token`, `isAuthenticated`, `login()`, `logout()` | Wrapped in `persist` → survives refresh |
| `useDashboardStore` | `kpis`, `drives`, `agentEvents[]`, `isLoading` | `addAgentEvent` prepends and caps at 50 |
| `useNotificationsStore` | `notifications[]`, `unreadCount` | Drives the TopBar bell |

**`websocket.ts`** — two React hooks.

| Hook | Connects to | Feeds |
|---|---|---|
| `useTPOWebSocket()` | `/ws/dashboard` | `addAgentEvent` → the live feed. Returns `{ connected }` for the TopBar. |
| `useStudentWebSocket(studentId)` | `/ws/student/{id}` | `addNotification` → the bell |

Both: 25s ping keep-alive, auto-reconnect 3s after close.

---

### 5.2 Backend — `backend/app/`

#### Entry & infrastructure

| File | Responsibility |
|---|---|
| `main.py` | Creates the FastAPI app. **CORS** (localhost + a `https://.*\.vercel\.app` regex). Mounts `/uploads` as static files. Registers 7 routers. `/health` for Railway. `lifespan` startup runs `init_db()` + makes upload/chroma dirs. |
| `config.py` | Pydantic `Settings` — reads `.env`. Every knob lives here: DB URL, Gemini keys & model names, SendGrid/Twilio creds, upload dir, CORS frontend URL. |
| `database.py` | Async engine (`pool_size=10, max_overflow=20, pool_pre_ping`), `AsyncSessionLocal` factory, the declarative `Base`, `get_db()` FastAPI dependency, and `init_db()` (`create_all`). Also exports `async_session_factory` — **background tasks use this to get their own session.** |

> ⚠️ **There are no Alembic migrations.** `create_all` adds new *tables* but never new
> *columns*. Any change to an existing table needs a hand-written `ALTER TABLE` against
> the running DB.

#### API routers — 35 REST endpoints + 2 WebSockets

| Router | Prefix | Endpoints | Purpose |
|---|---|---|---|
| `auth.py` | `/api/auth` | 3 | `POST /login` (OAuth2 form → JWT), `POST /register`, `GET /me`. Also exports the **`get_current_user`** and **`require_role(*roles)`** dependencies every other router uses. |
| `drives.py` | `/api/drives` | 9 | The pipeline's home. Create drive, upload JD file, **run pipeline** (background), read drive/list, get shortlist, **PATCH approve shortlist (HUMAN GATE #1)**, **PATCH approve schedule (HUMAN GATE #2)**, get event log. |
| `students.py` | `/api/students` | 9 | CRUD + `GET /me` (resolves JWT → Student by email) + résumé upload + per-student schedule/matches. |
| `analytics.py` | `/api/analytics` | 4 | `dashboard` (KPIs), `skill-gap`, `readiness`, `drives/{id}`. Pure SQL aggregation — no AI. |
| `schedule.py` | `/api/schedule` | 5 | Create round, **auto-schedule (the real FCFS path)**, list slots, record result, detect conflicts. |
| `notifications.py` | `/api/notifications` | 5 | Send (bulk, background), list per student, mark read, **offline queue**, retry queue. |
| `websocket.py` | `/ws` | 2 | The `ConnectionManager` hub + `emit_agent_event()` / `notify_student_ws()` broadcast helpers. |

> **Route-order gotcha (already fixed — do not undo):** in `students.py`, `/me` and
> `/me/resume` are declared **above** `/{student_id}`. Otherwise FastAPI matches
> `/me` as a `student_id` of literally `"me"`.

#### The agent layer — `backend/app/agents/`

| Agent | AI? | What it actually does |
|---|---|---|
| **`jd_analyst.py`** | ✅ Gemini | `analyze_jd()` — sends the JD text with a strict "return JSON only" system prompt, extracts 15 structured fields (role, package_lpa, min_cgpa, max_backlogs, allowed_branches, required_skills, selection_process…). Strips markdown fences, `json.loads`. **Falls back to a regex extractor** if the LLM fails. Also `explain_match()` (why a student fits) and `generate_skill_gap_advice()`. |
| **`eligibility_agent.py`** | ❌ Pure rules | A registry of rule-checkers via a `@rule_checker("min_cgpa")` decorator: `min_cgpa`, `max_backlogs`, `allowed_branches`, `min_attendance`, `no_historical_backlogs`. Each returns `(passed, human_readable_reason)`. **`_is_edge_case()`** flags near-misses (within 0.3 CGPA, or exactly 1 backlog over) — these are the "exceptions" the TPO should review by hand. |
| **`matcher_agent.py`** | ✅ Embeddings | Turns each student into a text blob → embeds → stores in a per-drive ChromaDB collection → embeds the JD → cosine-similarity query → ranked list. Batches of 5 with retry/backoff. **Has a TF-IDF keyword fallback** if embeddings fail. Then `generate_all_explanations()` adds Gemini prose to the top 5. |
| **`scheduler_agent.py`** | ❌ Pure algorithm | `generate_time_slots()` chops the round window into duration+break blocks. `allocate_slots()` walks students first-come-first-serve, round-robins across panels & rooms, and calls `find_panel_conflicts` / `find_room_conflicts` before committing each booking. Returns `(allocated, conflicts)`. |
| **`notifier_agent.py`** | ❌ Templates | 5 message templates (shortlisted, reminder, not_shortlisted, schedule_confirmed, result_selected). Multi-channel: SendGrid email, Twilio SMS, Twilio WhatsApp, in-app. **If every channel fails it marks the message `offline_queued`** instead of losing it — that's the offline-resilience story. |
| **`supervisor.py`** | 🧠 Orchestrator | The LangGraph state machine that wires the above into one pipeline. See §8. |

#### Seed data — `backend/seed/`

- `generate_data.py` — Faker-based generator → writes `data.json`
- `data.json` — **10 companies, 200 students, 5 drives** (committed to git; the seeder needs it)
- `seed_db.py` — loads it + creates the 4 demo users, 20 panel members, 10 rooms + 1 virtual room, and a hand-written demo student "Arjun Sharma" (8.7 CGPA, 8 skills) linked to `student@college.edu`

> Run from the `backend/` directory — the data path is CWD-relative:
> `.\venv\Scripts\python seed/seed_db.py`

---

## 6. THE DATA MODEL — 15 TABLES

```
                          ┌───────────┐
                          │   users   │  id · email · hashed_password · role · is_active
                          └─────┬─────┘
            ┌───────────────────┼───────────────────┐
            │ user_id           │ user_id           │ user_id
      ┌─────▼─────┐      ┌──────▼──────┐     ┌──────▼───────┐
      │ companies │      │  students   │     │panel_members │
      └─────┬─────┘      └──────┬──────┘     └──────┬───────┘
            │                   │                   │
            │ company_id        │ student_id        │ panel_id
            │             ┌─────▼────────┐   ┌──────▼────────────┐
            │             │student_skills│   │panel_availability │
            │             └──────────────┘   └───────────────────┘
      ┌─────▼──────────────┐
      │  placement_drives  │  ★ THE HUB — jd_text, jd_parsed(JSON), status(enum), package
      └─────┬──────────────┘
            │
   ┌────────┼──────────┬───────────────┬──────────────┐
   │        │          │               │              │
┌──▼─────┐┌─▼────────┐┌▼────────────┐┌─▼──────────┐┌──▼─────────┐
│eligib. ││eligib.   ││match_scores ││interview_  ││agent_events│
│_rules  ││_results  ││             ││rounds      ││(AUDIT LOG) │
└────────┘└──────────┘└─────────────┘└─────┬──────┘└────────────┘
                                            │ round_id
                                    ┌───────▼─────────┐
                                    │ interview_slots │◄── room_id ── rooms
                                    └─────────────────┘◄── panel_id ── panel_members
                                              ▲
                                              │ student_id
                                        (students)

  notifications ── student_id ──► students
```

### The tables that carry the most meaning

| Table | Why it matters |
|---|---|
| **`placement_drives`** | The hub everything hangs off. `jd_text` (raw) → `jd_parsed` (AI JSON). Its **`status` enum is the pipeline's state machine**: `draft → jd_analyzed → eligibility_checked → matched → shortlist_pending → shortlist_approved → schedule_pending → scheduled → ongoing → completed`. The UI renders progress purely from this field. |
| **`eligibility_results`** | One row per student per drive. Carries `eligible`, `reason` (JSON of every rule + its verdict), and **`is_edge_case`** — the near-miss flag. |
| **`match_scores`** | The ranked shortlist. `score` (0–1 cosine), `rank`, `explanation` (Gemini JSON: strengths/gaps/verdict), `shortlisted` (bool), and crucially **`tpo_override` + `tpo_override_reason`** — the record of a human disagreeing with the AI. |
| **`agent_events`** | **The audit log, and the most under-used asset in the codebase.** Every agent step and every human decision appends a row: `event_type`, `agent_name`, `payload` (JSON), and **`actor`** (`ai` \| `tpo` \| `system`). This is a complete, queryable "who decided what and why" trail that is currently only rendered as a scrolling feed. |
| **`interview_slots`** | The scheduling output: student × round × panel × room × time window, plus `result` and `feedback` from the panel. |

**Conventions used throughout:** every PK is a `String` UUID (`gen_uuid()`), except seeded
students whose `id` **is their roll number** (`2024CS0001`) for easy lookup.
`Notification.extra_data` is named that way because **`metadata` is reserved by SQLAlchemy**.

---

## 7. THE CORE FLOW: A JD BECOMES AN INTERVIEW SCHEDULE

This is the single most important sequence in the system. Follow it end to end.

```
[1] COMPANY pastes a job description
     UI: (company)/dashboard  →  POST /api/drives/            → row in placement_drives (status=draft)
                              →  POST /api/drives/{id}/run-pipeline

[2] FastAPI queues a BackgroundTask and returns 202 immediately
     _run_pipeline_bg(drive_id)  opens its OWN DB session (the request's is gone)
     ├─ loads all 201 students (+ their skills)
     ├─ loads the drive's eligibility_rules
     └─ emits "pipeline_started" ──────────────► WS ──► TPO's live feed lights up

[3] LangGraph runs. Each node emits an event as it finishes:

     ┌ node_analyze_jd ─────────────► Gemini (~14s) ──► jd_parsed JSON
     │      emits "jd_analyzed"  {role, package}
     │
     ├ node_check_eligibility ─────► pure Python, instant
     │      201 students × 5 rules → eligible list + edge cases
     │      emits "eligibility_checked"  {total, eligible, edge_cases}
     │
     ├ node_match_candidates ──────► embed students → ChromaDB → query with JD
     │      then Gemini explains the top 5
     │      emits "matching_complete"  {candidates_ranked}
     │
     └ node_await_shortlist_approval ── ⏸ ── STOPS HERE
            auto-suggests top 20, emits "shortlist_pending"
            sets placement_drives.status = SHORTLIST_PENDING

[4] Results are persisted by _run_pipeline_bg after the graph returns:
     eligibility_results rows · match_scores rows · agent_events rows

[5] TPO sees "Review Shortlist" appear (WS event + a 4s poll as backstop)
     UI: (tpo)/drives → ShortlistModal → ranked candidates with AI explanations
     TPO ticks/unticks students, adds a note

         ★★ HUMAN GATE #1 ★★
     PATCH /api/drives/{id}/shortlist  { approved, shortlisted_student_ids, notes }
       → flips match_scores.shortlisted, stamps tpo_override + reason
       → status = SHORTLIST_APPROVED
       → agent_events row with actor="tpo"
       → emits "shortlist_approved" ──► WS

[6] TPO creates an interview round and auto-schedules
     POST /api/schedule/rounds                    { drive, round_type, window, duration }
     POST /api/schedule/rounds/{id}/auto-schedule
       → pulls shortlisted students, all panels, all rooms
       → allocate_slots(): FCFS + conflict detection
       → writes interview_slots rows
       → emits "schedule_created" ──► WS

         ★★ HUMAN GATE #2 ★★   (backend ready, UI not built — see §11)
     PATCH /api/drives/{id}/schedule/approve  → status = SCHEDULED

[7] Notifications go out
     POST /api/notifications/send → bulk_notify → SendGrid / Twilio / in-app
       any total failure → status "offline_queued" → retriable from the TPO UI

[8] PANEL records outcomes
     UI: (panel)/schedule → PATCH /api/schedule/slots/{id}/result { result, feedback }
       → interview_slots.result = "selected" → feeds placement KPIs & analytics

[9] STUDENT sees everything on their dashboard
     GET /api/students/me → profile + readiness + matches (with company names)
     GET /api/students/{id}/schedule → their interview slots
     WS /ws/student/{id} → live notification pings
```

---

## 8. THE AGENT LAYER IN DETAIL (LangGraph)

### Why LangGraph and not a plain `for` loop

A plain function chain can't **pause, persist, and resume** at a human decision point.
LangGraph models the pipeline as a graph of nodes over a shared typed state
(`PlacementState`), with a `MemorySaver` checkpointer keyed by `thread_id = drive_id`.
That's what makes "stop and wait for the TPO" a first-class concept.

### The state object — `PlacementState` (TypedDict)

Every node receives it and returns a partial dict that gets merged in.

```
drive_id, jd_text                       ← inputs
jd_parsed                               ← JD Analyst writes
students, rules                         ← preloaded from DB
eligibility_results, eligible_students  ← Eligibility Agent writes
match_results                           ← Matcher writes
shortlisted_student_ids                 ← auto-suggested top 20
tpo_shortlist_approved  (None = pending) ← HUMAN writes
schedule_summary, allocated_slots       ← Scheduler writes
tpo_schedule_approved   (None = pending) ← HUMAN writes
notifications_sent
agent_events[]                          ← every node appends
current_step, error
```

### The graph

```
        set_entry_point
              │
              ▼
      ┌───────────────┐
      │  analyze_jd   │  Gemini · ~14s
      └───────┬───────┘
              ▼
      ┌───────────────────┐
      │ check_eligibility │  rules · instant
      └───────┬───────────┘
              ▼
      ┌───────────────────┐
      │ match_candidates  │  embeddings + Gemini explanations
      └───────┬───────────┘
              ▼
    ◇ route_after_shortlist ◇   ── tpo_shortlist_approved is True? ──┐
              │ no                                                   │ yes
              ▼                                                      ▼
  ┌──────────────────────────┐                          ┌─────────────────────┐
  │ await_shortlist_approval │  ⏸ HUMAN GATE #1         │ schedule_interviews │
  └────────────┬─────────────┘                          └──────────┬──────────┘
               ▼                                                    ▼
              END  ← resume via PATCH API                ◇ route_after_schedule ◇
                                                              │            │
                                                    ┌─────────▼──┐    ┌────▼────────────┐
                                                    │await_sched.│⏸#2 │send_notifications│
                                                    └─────┬──────┘    └────┬────────────┘
                                                          ▼                ▼
                                                         END              END
```

### ⚠️ The structural truth you must know

**In practice the graph only ever executes the first four nodes.** It hits
`await_shortlist_approval → END` and `resume_pipeline()` — the function that would
re-enter the graph — is **defined but never called from anywhere in the codebase**.

The nodes below the first gate (`schedule_interviews`, `await_schedule_approval`,
`send_notifications`) are **unreachable dead code**. Real scheduling happens through a
completely separate REST path: `POST /api/schedule/rounds/{id}/auto-schedule` in
`schedule.py`, which calls `allocate_slots()` directly without touching LangGraph.

**How to talk about this honestly:** *"It's an agent pipeline with a human approval gate,
plus operator-triggered actions after that gate."* That's a legitimate, defensible design.
Do **not** describe it as one continuous autonomous graph — a judge who asks "show me the
agent resuming" will find that it doesn't.

---

## 9. THE REAL-TIME LAYER (WebSocket)

### Server side — `api/websocket.py`

```
ConnectionManager
  active: { room_name -> [WebSocket, ...] }

  rooms in use:
    "tpo_dashboard"        ← every TPO browser tab
    "student_{id}"         ← one room per student

  connect() / disconnect() / broadcast(room, msg) / broadcast_all(msg)
    broadcast() collects dead sockets and prunes them after the send loop
```

Two helpers are called from all over the backend:

| Helper | Broadcasts to | Message shape |
|---|---|---|
| `emit_agent_event(event_type, payload, drive_id, agent_name)` | `tpo_dashboard` | `{type:"agent_event", event_type, agent_name, drive_id, payload}` |
| `notify_student_ws(student_id, notification)` | `student_{id}` | `{type:"notification", ...}` |

### Who emits what

| Emitter | Events |
|---|---|
| `supervisor.py` — every node, inline via `_emit()` | `jd_analyzed`, `eligibility_checked`, `matching_complete`, `shortlist_pending`, `schedule_created`, `schedule_pending`, `notifications_queued` |
| `drives.py` `_run_pipeline_bg` | `pipeline_started`, `pipeline_error` |
| `drives.py` approval endpoints | `shortlist_approved/rejected`, `schedule_approved/rejected` (actor = `human_tpo`) |
| `schedule.py` `auto_schedule_round` | `schedule_created` |

### Client side — the belt-and-braces design

The TPO drives page uses **three** mechanisms deliberately:

1. **WebSocket** — instant events into the feed
2. **A 4-second poll** of `GET /api/drives/` — a fallback kept on purpose, so the demo
   still works if the WS connection dies
3. **WS-triggered refetch** — any live event also fires an immediate `fetchDrives()`, so
   the table updates faster than the poll interval

> Keep the poll. It is cheap insurance against a flaky conference network.

---

## 10. AUTH, ROLES, AND THE REQUEST LIFECYCLE

### Login

```
POST /api/auth/login   (OAuth2PasswordRequestForm: username=email, password)
      │
      ├─ SELECT user WHERE email = ...
      ├─ bcrypt verify  (passlib; bcrypt PINNED to 4.0.1 — 5.x breaks passlib)
      └─ jwt.encode({sub: user.id, role: user.role, exp: now+60min}, SECRET_KEY, HS256)
             │
             ▼
      { access_token, token_type, role, user_id }
             │
   frontend: localStorage["access_token"] = token
             Zustand useAuthStore persists user + isAuthenticated
             router pushes to the role's landing page
```

### Every subsequent request

```
Browser ──axios request interceptor──► "Authorization: Bearer <jwt>"
                                              │
FastAPI dependency chain:
   oauth2_scheme  → pulls the raw token out of the header
   get_current_user → jwt.decode → SELECT user by sub → checks is_active → returns User
   require_role(TPO, COMPANY) → asserts user.role ∈ roles, else 403
                                              │
                                        route handler
```

If anything returns **401**, the axios *response* interceptor clears localStorage and
bounces the user to `/`. One rule, applied globally.

---

## 11. REALITY OVERLAY — WHAT'S REAL VS. THEATER

**This is the section to internalise.** The backend is genuinely strong. The problem is
that several screens display hardcoded data instead of calling it. Verified by direct
execution on 2026-08-23.

### Legend
🟢 real end-to-end · 🟠 backend real, UI partial · 🔴 UI shows fabricated data

| Surface | State | The specific line |
|---|---|---|
| Login, JWT, 4 roles | 🟢 | — |
| TPO dashboard KPIs | 🟠 | Real query, but seed data makes every number **0** (no slots, all drives `DRAFT`) |
| Drives page + pipeline + HITL gate #1 | 🟢 | The genuine centrepiece. This one is real. |
| Eligibility engine | 🟠 | Runs for real; **no endpoint ever reads `eligibility_results` back** |
| Skill matching | 🟠 | Real ranking — but via **TF-IDF keyword overlap**, never vectors (see below) |
| Analytics (skill gap, readiness) | 🟢 | Real SQL aggregation. One mocked trend chart. |
| **JD extraction (company wizard)** | 🔴 | `company/dashboard/page.tsx:97` — waits 5s, then renders a **hardcoded TCS parse**. Parsing takes ~14s, so the fake almost always wins. |
| **TPO schedule page** | 🔴 | `useState(DEMO_SLOTS)` — never fetches. "Create Round" **422s** (omits required datetimes). |
| **Panel page** | 🔴 | Falls back to `DEMO_SLOTS`, API deliberately skipped |
| **Notifications send** | 🔴 | Posts `{channel, subject, message, recipient_type}`; API wants `{student_ids, template_id, data}` → **422 every time** |
| **Student "AI Skill Gap Advice"** | 🔴 | A hardcoded 3-item array **badged "Gemini Powered"**. Meanwhile the real `generate_skill_gap_advice()` exists in `jd_analyst.py` and is **called by nothing**. |
| HITL gate #2 | 🔴 | Endpoint works; `approveSchedule` has **zero callers** — the demo dead-ends after gate #1 |
| Exceptions panel | 🔴 | `is_edge_case` computed, stored, **never displayed** |

### The two findings that matter most

**1. ChromaDB has never been populated. Not once.**
Verified against the live API key: `models/embedding-001` (configured) and
`text-embedding-004` (claimed in DEPLOYMENT.md) are both **retired → 404**. And
`langchain-google-genai==1.0.6` hangs 60s on *every* embedding model. Measured on the
real code path:

```
index_students_for_drive:  184.9s   embedded_ok=False
match_students_to_jd:        0.0s   → TF-IDF fallback
```

So each pipeline run **freezes ~3 minutes** after "Eligibility Done", then silently
degrades to bag-of-words + a CGPA bonus. The fix is real and cheap: `gemini-embedding-001`
works via **direct REST in 1.0 second** (3072-dim). Bypass langchain for embeddings.

**2. Any logged-in student can rewrite any student's CGPA.**
`PUT /api/students/{student_id}` is guarded only by `get_current_user` — no ownership
check, no role check. Setting CGPA to 10 defeats the entire eligibility engine. Related:
`/uploads` is mounted with **no auth** and filenames are deterministic
(`resume_{roll_no}.pdf`), so any résumé downloads without logging in.

---

## 12. TARGET STATE — WHERE THIS IS GOING

After the fix list in [AGENTS.md](AGENTS.md), the same diagram becomes true:

```
BEFORE                                   AFTER
──────────────────────────────────────   ──────────────────────────────────────
Matcher → 185s stall → TF-IDF            Matcher → 2s → real 3072-dim vectors
Company wizard → fake TCS parse          Company wizard → polls until real jd_parsed
Schedule page → DEMO_SLOTS               Schedule page → real slots from the FCFS agent
Panel page → DEMO_SLOTS                  Panel page → real assigned slots
Notifications → 422                      Notifications → real send + offline queue
Demo dead-ends after gate #1             Gate #2 wired → full JD-to-schedule story
Skill advice → hardcoded "Gemini Powered" Skill advice → actual generate_skill_gap_advice()
eligibility_results → written, unread    Exceptions panel → "12 borderline, review these"
agent_events → a scrolling feed          Audit trail → "who decided what, and why"
Dashboard KPIs → all zeros               Seeded completed drive → live numbers
Any student can edit any CGPA            Role-scoped, CGPA is TPO-only
```

### The three additions worth building (and nothing else)

| Addition | Cost | Why it wins points |
|---|---|---|
| **Wire HITL gate #2** | Low — endpoint exists | Without it the demo dead-ends. Lands the objective sentence twice. |
| **Exceptions panel** | Low — data exists | Required feature #7 says "pending actions **and exceptions**". `is_edge_case` is already computed. |
| **Audit trail view** | Low — data exists | `agent_events.actor` already separates `ai` from `tpo`. Explainability + human control, free. |

> **Do not add anything else.** The project is ahead on code and behind on truth. Every
> hour spent on new surface is an hour not spent making a required feature real.

---

## 13. DEPLOYMENT TOPOLOGY

```
        Developer laptop                    Production
   ─────────────────────────         ─────────────────────────────
   next dev      :3000               Vercel  (root dir: frontend/)
   uvicorn       :8000                 NEXT_PUBLIC_API_URL = https://…railway.app
   docker: postgres :5432              NEXT_PUBLIC_WS_URL  = wss://…railway.app
   docker: redis :6379  ← unused             │
   ./chroma_db   (disk)                      │ HTTPS + WSS
   ./uploads     (disk)                      ▼
                                     Railway (root dir: backend/)
                                       uvicorn app.main:app --host 0.0.0.0 --port $PORT
                                       healthcheck: /health
                                       ├── Railway PostgreSQL plugin → DATABASE_URL
                                       ├── /tmp/uploads      ⚠ ephemeral
                                       └── /tmp/chroma_db    ⚠ ephemeral
```

### Required production environment variables

| Variable | Note |
|---|---|
| `GEMINI_API_KEY` | Real key |
| `SECRET_KEY` | **Currently a literal placeholder in `.env`.** Must be a real random 32+ char string. |
| `DATABASE_URL` | Auto-set by the Railway Postgres plugin |
| `FRONTEND_URL` | The real Vercel URL — **CORS depends on it** |
| `APP_ENV` | `production` (also turns off SQL echo) |
| `UPLOAD_DIR` / `CHROMA_PERSIST_DIR` | `/tmp/uploads`, `/tmp/chroma_db` |

### The deploy order that avoids a chicken-and-egg CORS problem

```
1. Fix the 2 TypeScript errors           (Vercel build fails without this)
2. Deploy Railway backend  → note its URL
3. railway run python seed/seed_db.py    (from backend/)
4. Deploy Vercel frontend with the Railway URL → note its URL
5. Go back to Railway, set FRONTEND_URL to the Vercel URL
6. Smoke-test all 4 roles on the LIVE urls
```

> **Known limitation:** Railway's free tier has ephemeral disk. Uploaded résumés and the
> ChromaDB index are wiped on every restart/redeploy. Acceptable for a demo — just don't
> be surprised, and re-run the pipeline before you present.

---

## 14. GLOSSARY

| Term | Meaning |
|---|---|
| **TPO** | Training & Placement Officer — the college staff member who runs placements. The admin persona. |
| **Drive** | One company's hiring campaign at the college. The central object. |
| **JD** | Job Description — the raw text a company submits. |
| **HITL** | Human-in-the-Loop — a point where the AI stops and waits for a person to approve. |
| **Shortlist** | The ranked set of candidates the AI proposes for interviews. |
| **Round** | One stage of interviewing (aptitude / coding / technical / HR / GD / final). |
| **Slot** | A single booked interview: one student × one panel × one room × one time window. |
| **Panel** | An interviewer (usually company-side) who conducts interviews and records results. |
| **FCFS** | First-Come-First-Serve — the slot allocation strategy. |
| **Edge case** | A student who *just* missed eligibility (within 0.3 CGPA, or 1 backlog over) and deserves human review. |
| **Readiness score** | 0–100 measure of how prepared a student is for placement. |
| **Embedding** | A text turned into a list of numbers, so "similar meaning" becomes "close together". |
| **Cosine similarity** | How close two embeddings point in the same direction. 1.0 = identical. |
| **TF-IDF** | A pre-neural keyword-overlap scoring method. The current fallback — and, right now, the only path. |

---

*Written 2026-08-23 (Day 3) from a verified read of the code at commit `d5b8318`.*
*Section 11 was confirmed by direct execution — REST probes against the live Gemini key,*
*`tsc --noEmit`, and timed runs of the real matcher — not inferred from the source.*
