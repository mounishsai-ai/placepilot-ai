# PlacePilot AI

An agentic campus-placement system. Gemini agents take a placement drive from a raw
job description through candidate screening to a conflict-free interview schedule —
choosing their own tools at each step, and stopping to hand every irreversible
decision to a human.

**Live:** https://placement-frontend-891885517174.us-central1.run.app

| Role | Email | Password |
|---|---|---|
| TPO (placement officer) | `tpo@college.edu` | `tpo@123` |
| Student | `student@college.edu` | `student@123` |
| Company HR | `hr@tcs.com` | `company@123` |
| Interview panel | `panel@company.com` | `panel@123` |

Selecting a role on the sign-in page fills these in. The data behind the demo is
seeded, not real student records — see [Limitations](#what-this-does-not-solve).

<!-- TODO: record a ~90s screen capture of the JD-upload -> trace -> schedule flow
     and embed it here. It outlives the hosted demo, which runs on trial credits. -->

---

## What this actually is

A working system, deployed, built solo as a college project. It is not production
software for a real placement cell, and the
[Limitations](#what-this-does-not-solve) section says plainly where that line falls.

The part worth reviewing is not the four portals or the CRUD around them. It is two
specific problems that turned out to be harder than they looked, and how they are
solved.

## Problem 1 — an agent that survives being killed

An agent that pauses to ask a human a question has a state problem. The run is
mid-conversation with the model: there is a message history, a pending tool call,
and a partially-built result. On Cloud Run the container serving that run can be
recycled at any moment, and the next request may land on a different instance
entirely.

Holding that state in memory means the pause is a lie — the run dies silently and
the TPO waits forever for a question that no longer exists.

So `ask_human` is not a hardcoded checkpoint in the control flow. **It is a tool the
model can choose to call**, and calling it serialises the entire run — message
history, tool results, pending question — into the `agent_runs` table in Postgres
before the process yields. Resuming injects the human's answer back as a
`functionResponse` and the loop continues from exactly where it stopped.

This was verified by killing the container mid-pause and confirming the run resumed
correctly on a fresh instance — not assumed from the code.

The consequence worth noticing: because the pause is a tool rather than a fixed
stage, *the model decides when a human is needed*. Two drives with different
constraints produce different traces, and one may ask where the other does not.

## Problem 2 — a scheduler that catches its own mistakes

The first version allocated interview slots first-come-first-served and checked for
conflicts within the batch it was placing. That is the obvious approach and it has a
hole: it never looks at slots committed by *other* drives. Two drives scheduling
independently would each produce an internally-valid schedule that double-booked the
same panel member or room.

The fix is a closed loop rather than a better allocator:

```
get_schedule_context → propose_schedule → validate_schedule
                            ↑                    │
                            └──── re-plan ───────┘   (on violation)
                                                 │
                                                 ↓  (zero violations)
                                          commit_schedule
```

`propose_schedule` still uses first-come-first-served internally — that part is fine,
and it is fast. What changed is that its output is now a *proposal*, not a result.
`validate_schedule` checks that proposal against every slot already committed across
every drive and every round. On a violation the model reads which panel or room
clashed and calls `propose_schedule` again — excluding that resource, or widening the
window — then re-validates. Nothing is written until validation returns clean.

The model chooses the fix itself; the recovery strategy is not coded as a branch.

## Architecture

`orchestrator.py` is a single Gemini function-calling loop. It is not two agents —
it is one engine, and which agent it becomes is decided by a **profile**: a system
prompt plus a tool list, selected by a `kind` string. Adding an agent is a dictionary
entry, not new engine code.

### Loop agents (multi-step, model-driven)

| Profile | Tools | Job |
|---|---|---|
| `shortlist` | `get_drive_context`, `parse_jd`, `check_eligibility`, `rank_candidates`, `select_candidates`, `ask_human` | JD → ranked, human-approved shortlist |
| `schedule` | `get_schedule_context`, `propose_schedule`, `validate_schedule`, `commit_schedule`, `ask_human` | Conflict-free interview schedule |

Both profiles run on the same engine function. The difference between them is
entirely data — a system prompt and a list of tools — which is why adding a third
would not touch the loop itself.

An earlier version added two more profiles, in which an agent acting for the TPO
negotiated the schedule with a second agent acting for the company. It was
removed: it spent 12–18 model steps and an extra judgement call arriving at the
schedule the `schedule` agent above reaches in about four, and by design it could
not commit anything, so nothing depended on it.

### One-shot specialists (single structured judgment)

| Agent | Job |
|---|---|
| **Auditor** | An independent second model call that fact-checks the shortlist's *real numbers* — not the orchestrator's narration of them — immediately before a human is asked to approve. Its job is to disagree. Degrades to "clear" on failure rather than blocking the run. |
| **Analyst Agent** | Plain-English question → generated SQL → **validated in Python** (single `SELECT` only, table allowlist, PII column blocklist, no `SELECT *`, forced `LIMIT`) → executed read-only → answered from the rows actually returned. TPO only. |
| **Panel Agent** | Briefs an interviewer before a slot, structures their debrief after, and cleans up voice-dictated notes. |
| **Onyx** | A free-text assistant reachable from anywhere in the TPO portal. It has no data access of its own — its single tool hands the question to the Analyst. No `ask_human` pause, because the human is already in the conversation. |

### Models, and why

Two different auth paths, chosen per workload rather than uniformly:

| Model | Access | Used for | Why this one |
|---|---|---|---|
| `gemini-2.5-flash` | Vertex AI (ADC) | Orchestrator loop, and every one-shot JSON agent | Native function calling, verified live. On Vertex rather than the AI Studio free tier because that tier's daily request ceiling would have killed a live demo mid-run. |
| `gemini-3.5-flash` | AI Studio key | JD parsing | Higher quality on this one task; a newer model measured ~27s/call against ~5.7s here. |
| `gemini-3.5-flash-lite` | AI Studio key | Match explanations, résumé parsing | High call volume, low reasoning demand. |
| `gemini-embedding-001` | Vertex AI | Candidate ranking | Called over direct `httpx` REST rather than LangChain, which hung to a 504 on every model. TF-IDF is kept as a real fallback, not a stub. |

`gemini-2.5-flash` is a thinking model and can emit a `"thought": true` part *before*
the answer part. `vertex_json.py` scans all parts and skips thought parts —
`parts[0]` is not reliably the answer. This was a real bug.

### Trace UI

Agent trace rows (`thought` / `tool_call` / `observation` / `decision` / `violation`
/ `ask_human` / `audit`) render generically, independent of which profile produced
them. Adding a new agent needs zero frontend trace-viewer changes.

The Control Tower page (`/tpo/drives/[id]/agent`) derives its stage display *from the
trace itself* rather than tracking parallel state, so what it shows cannot drift from
what the agent actually did.

---

## Running it

The system runs without any LLM key — embeddings fall back to TF-IDF and the
LLM-dependent features degrade rather than crash — but the agent loops need one to
do anything interesting.

### With Docker (whole stack)

```bash
cp backend/.env.example backend/.env        # add GEMINI_API_KEY here for the full path
docker compose up --build
docker compose exec api python -m seed.seed_db
```

Then open http://localhost:3000 and sign in with any role above.

### Manually

Requires Python 3.11+, Node 18+, and PostgreSQL 14+.

#### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                # then fill in DATABASE_URL and keys
python -m seed.seed_db                              # seeds demo users, students, drives
uvicorn app.main:app --reload --port 8000
```

API docs at `http://localhost:8000/api/docs`.

#### Frontend

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 \
NEXT_PUBLIC_WS_URL=ws://localhost:8000 \
npm run dev
```

`NEXT_PUBLIC_*` variables are inlined by Next.js **at build time**, not read at
runtime — a production build without them ships a frontend that cannot reach the API.

### Deployment

Both services run on Google Cloud Run with Cloud SQL for Postgres and Vertex AI for
inference. Build and deploy commands are in `CLAUDE.md`.

---

## What this does not solve

Written plainly, because the gap between this and a system a real placement cell
could depend on is the most useful thing to be clear about.

**It does not integrate with how companies actually recruit.** Large recruiters —
TCS, Cognizant and others — run their own candidate portals with their own processes,
timelines and formats. A real deployment would need to reconcile with those systems,
and this one does not attempt it. It assumes the college is the system of record,
which is not true.

**It models a clean process that real placement seasons do not follow.** Drives get
postponed. Panels take leave. Rounds get added after the fact. Students are pulled
into a second company's process mid-schedule. The scheduler assumes a stable window
and a fixed panel roster; the moment either changes, its plan is stale and there is
no re-planning trigger.

**Single tenant.** One college, one placement cell. No organisation boundary exists
anywhere in the data model.

**The demo data is seeded, not real.** Students, drives and companies are generated
fixtures. No screen displays a number the system did not compute from that data — but
the data itself is synthetic.

**Auth is demo-grade.** Shared credentials with weak passwords, printed on the
sign-in page. JWT with 4 roles and authenticated WebSockets are implemented, but
nothing here has been through a security review, and the credential model assumes
demonstration rather than real users.

**Résumé storage is ephemeral.** Uploads land on the container filesystem
(`/tmp/uploads`) and are lost when the container recycles. Real use needs object
storage; this was not worth doing for a demo.

**No migrations.** SQLAlchemy `create_all` only creates *new tables* — it will not add
a column to an existing one. Schema changes against a live database currently require
a manual `ALTER TABLE`. Alembic is the correct fix and is not wired up.

**Not load tested.** Every path here has been exercised by hand, by one person.
No concurrency testing, no load profile, no idea where it breaks under real
simultaneous use.

**The hosted demo runs on trial credits** and will stop working when they expire.

---

## Stack

**Backend** — FastAPI, async SQLAlchemy, PostgreSQL, ChromaDB, Vertex AI + Gemini,
JWT auth, WebSockets
**Frontend** — Next.js 14 (App Router), TypeScript, Tailwind, Framer Motion, Recharts,
React Three Fiber
**Infrastructure** — Google Cloud Run, Cloud SQL, Artifact Registry

## Layout

```
backend/app/
  agents/          orchestrator loop, tool registries, one-shot specialists
    orchestrator.py    the single function-calling engine + agent profiles
    tools.py           shortlist tool registry
    schedule_tools.py  scheduling tools, incl. the cross-drive validator
    auditor_agent.py, analyst_agent.py, panel_agent.py
    vertex_json.py     shared one-shot JSON helper
  api/             REST + WebSocket routes
  models/          SQLAlchemy models
frontend/src/
  app/             App Router pages, one route group per role
  components/      shared UI, agent trace viewer, 3D architecture map
```

## Author

Built by **N. Mounish Sai** — design, backend, agent architecture, frontend and
deployment. Solo project.
