# PlacePilot AI

An agentic campus-placement system. Gemini agents take a placement drive from a raw
job description through candidate screening to a conflict-free interview schedule —
choosing their own tools at each step, and stopping to hand every irreversible
decision to a human.

<!-- TODO: embed the ~90s demo video here (JD upload -> agent trace -> schedule). -->

**Runs on a Gemini API key and any Postgres database** — no Google Cloud project
required. See [Running it](#running-it); setup is three values in a `.env` file.

After seeding, sign in as any of these (the sign-in page fills them in for you):

| Role | Email | Password |
|---|---|---|
| TPO (placement officer) | `tpo@college.edu` | `tpo@123` |
| Student | `student@college.edu` | `student@123` |
| Company HR | `hr@tcs.com` | `company@123` |
| Interview panel | `panel@company.com` | `panel@123` |

The seed data is generated fixtures, not real student records — see
[Limitations](#what-this-does-not-solve).

---

## What this actually is

A working system, built solo as a college project. It is not production
software for a real placement cell, and the
[Limitations](#what-this-does-not-solve) section says plainly where that line falls.

The part worth reviewing is not the four portals or the CRUD around them. It is two
specific problems that turned out to be harder than they looked, and how they are
solved.

## Problem 1 — an agent that survives being killed

An agent that pauses to ask a human a question has a state problem. The run is
mid-conversation with the model: there is a message history, a pending tool call,
and a partially-built result. On any container platform the process serving that
run can be recycled at any moment, and the next request may land on a different
instance entirely.

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
load context → propose → validate ──┐
                  ↑                 │  violations: drop the contested
                  └──── re-plan ────┘  panel/room, or widen the window
                                    │
                                    ↓  zero violations
                                 commit
```

`propose` is first-come-first-served and that part is fine — it is fast, and its
output is a *proposal*, not a result. `validate` checks that proposal against
every slot already committed across every drive and every round, which the
allocator cannot do because it only ever sees the students in front of it. On a
violation the contested resource is excluded and the proposal is rebuilt; if
everyone fits but the window is tight, the window widens in fixed steps.
Nothing is written until validation returns clean.

**This deliberately does not use a model.** An earlier version ran the same loop
as a Gemini agent, with the model choosing what to retry after each failure.
Measured against each other on the same round, the model reached the same window
in over fifteen seconds and then stopped to ask a human; the loop below reaches
it in ~200ms, gives the same answer every time, and cannot fail on a rate limit.
The model was never allocating anything — it was picking between "drop that
panel" and "extend the window", which is a closed set worth writing out.

The judgement that remains is a human's: the schedule is committed as *pending*,
and a TPO confirms it.

## Architecture

`orchestrator.py` is a single Gemini function-calling loop. It is not two agents —
it is one engine, and which agent it becomes is decided by a **profile**: a system
prompt plus a tool list, selected by a `kind` string. Adding an agent is a dictionary
entry, not new engine code.

### Loop agents (multi-step, model-driven)

| Profile | Tools | Job |
|---|---|---|
| `shortlist` | `get_drive_context`, `parse_jd`, `check_eligibility`, `rank_candidates`, `select_candidates`, `ask_human` | JD → ranked, human-approved shortlist |

A profile is data — a system prompt and a list of tools — so adding one does not
touch the loop itself. There is one, because scheduling was moved to plain code
once it was clear the model there was only choosing between two fixed retries.

Two other profiles existed and were removed. One had an agent acting for the TPO
negotiate the schedule with a second agent acting for the company: 12–18 model
steps and an extra judgement call to reach a schedule plain code now produces in
milliseconds, and by design it could not commit anything, so nothing depended on
it. The scheduling profile went the same way, for the same reason.

### One-shot specialists (single structured judgment)

| Agent | Job |
|---|---|
| **Auditor** | An independent second model call that fact-checks the shortlist's *real numbers* — not the orchestrator's narration of them — immediately before a human is asked to approve. Its job is to disagree. Degrades to "clear" on failure rather than blocking the run. |
| **Analyst Agent** | Plain-English question → generated SQL → **validated in Python** (single `SELECT` only, table allowlist, PII column blocklist, no `SELECT *`, forced `LIMIT`) → executed read-only → answered from the rows actually returned. TPO only. |
| **Panel Agent** | Briefs an interviewer before a slot, structures their debrief after, and cleans up voice-dictated notes. |
| **Onyx** | A free-text assistant reachable from anywhere in the TPO portal. It has no data access of its own — its single tool hands the question to the Analyst. No `ask_human` pause, because the human is already in the conversation. |
| **Shortlist selector** | "Top 15 CSE and IT students with CGPA above 7.5" → a filter spec, **applied in Python**. The model never sees the candidates and never names a student, so who gets shortlisted stays repeatable and auditable. It moves checkboxes; the TPO still approves. |

### Models, and why

| Model | Used for | Why this one |
|---|---|---|
| `gemini-3.5-flash` | Orchestrator loop and every one-shot JSON agent | The only model here that has to do function calling. |
| `gemini-3.5-flash` | JD parsing | Higher quality on this one task; a newer model measured ~27s/call against ~5.7s here. |
| `gemini-3.5-flash-lite` | Match explanations, résumé parsing | High call volume, low reasoning demand. |
| `gemini-embedding-001` | Candidate ranking | Called over direct `httpx` REST rather than LangChain, which hung for 60s then 504'd on every model tried. TF-IDF is kept as a real fallback, not a stub. |

The agent loop was originally built and verified against `gemini-2.5-flash`, and
it is *not* the model here. That one is retired on
`generativelanguage.googleapis.com` and returns 404 for keys issued after its
cutoff — so a repo meant to be cloned cannot use it, whatever the code was
developed on.

### Two backends behind one interface

The same models are reachable two ways: an **API key** against
`generativelanguage.googleapis.com`, or **Gemini Enterprise Agent Platform** (Google Cloud's
platform, called Vertex AI until Cloud Next 2026) with a Google Cloud bearer token. `LLM_BACKEND`
picks; the default uses the key whenever one is set, because that is what a
clone of this repo can authenticate. Gemini Enterprise is opt-in, and worth it only
because the free key tier is tight enough to 429 partway through one drive.

`gemini_transport.py` is the only module that knows which is which. The two are
less symmetric than they look:

- **`generateContent` is byte-identical** on both, so the agent loop needed no changes.
- **Embeddings are not.** Gemini Enterprise uses `:predict` with an `instances` list; the key
  path uses `:batchEmbedContents` with a `requests` list, nests the vector
  differently, and caps a batch at 100 where Gemini Enterprise has no limit.
- **The models differ.** `gemini-2.5-flash` is what the loop was verified on and
  Gemini Enterprise still serves it, but it is retired on the key endpoint.

That embedding asymmetry caused a real bug: a batch size tuned for Gemini Enterprise made
every call 400 on the key path, and since ranking falls back to TF-IDF on any
exception, shortlists silently degraded from semantic to keyword matching with
nothing on screen to say so. The trace now records which ranking actually ran.

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

You need two things: **a Postgres database** and **a Gemini API key** from
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free to create,
no card required. Any Postgres 14+ works, local or hosted.

The free tier's limits are tight, and Google no longer publishes them — you can
see yours at [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit).
One drive end to end is comfortably within them; running several back to back
will likely want billing enabled on the key.

The app also runs with no key at all: embeddings fall back to TF-IDF and the
LLM-dependent features degrade rather than crash. The agent loops need one to do
anything interesting.

### With Docker (everything at once)

```bash
cp backend/.env.example backend/.env     # add GEMINI_API_KEY
docker compose up --build
docker compose exec api python -m seed.seed_db
```

Then open http://localhost:3000. Postgres, API and frontend all come up
together; nothing else needs installing.

Note the API is published on host port 8000 and Postgres on **5433** — 5432 is
left free so this does not collide with a Postgres you already run.

### Manually

Requires Python 3.11+, Node 18+ and PostgreSQL 14+.

#### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                # fill in the three required values
python -m seed.seed_db                              # seeds demo users, students, drives
uvicorn app.main:app --reload --port 8000
```

The three required values in `.env` are `DATABASE_URL`, `SYNC_DATABASE_URL` and
`GEMINI_API_KEY`. Nothing else has to be set.

API docs at `http://localhost:8000/api/docs`.

#### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local     # defaults to a backend on localhost:8000
npm run dev
```

`NEXT_PUBLIC_*` variables are inlined by Next.js **at build time**, not read at
runtime — a production build without them ships a frontend that cannot reach the API.

### Deployment

Nothing here is tied to a particular host: it needs a container runtime, a
Postgres database and an API key, so it deploys anywhere that offers the three.

There is no hosted instance to visit. A demo running on trial credits stops
working the moment they lapse, and a dead link is worse than none — so the
video above and this repo are the artifact.

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

---

## Stack

**Backend** — FastAPI, async SQLAlchemy, PostgreSQL, ChromaDB, Gemini API,
JWT auth, WebSockets
**Frontend** — Next.js 14 (App Router), TypeScript, Tailwind, Framer Motion, Recharts,
React Three Fiber
**Runs on** — Docker Compose (Postgres + API + frontend), or any container
runtime with a Postgres and a Gemini API key

## Layout

```
backend/app/
  agents/          orchestrator loop, tool registries, one-shot specialists
    orchestrator.py    the single function-calling engine + agent profiles
    tools.py           shortlist tool registry
    schedule_tools.py  the deterministic scheduler + cross-drive validator
    shortlist_selector.py  plain-English instruction -> filter spec
    auditor_agent.py, analyst_agent.py, panel_agent.py
    gemini_json.py     shared one-shot JSON helper
    gemini_transport.py  where a Gemini call goes and how it authenticates
  api/             REST + WebSocket routes
  models/          SQLAlchemy models
frontend/src/
  app/             App Router pages, one route group per role
  components/      shared UI, agent trace viewer, 3D architecture map
```

## Author

Built by **N. Mounish Sai** — design, backend, agent architecture and
frontend. Solo project.
