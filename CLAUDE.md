# CLAUDE.md — PlacePilot AI

Single source of truth for this repo. Current state only: what is here now and
what will break if you change it.

## What this is
An agentic campus-placement system. A drive goes from a raw job description
through eligibility and ranking to a conflict-free interview schedule, stopping
to hand every irreversible decision to a human.

Solo project.

**Never fabricate data or results to make something look finished.** If a path
does not work, say so. Every number on screen must be computed from real data —
no hardcoded stats, no placeholder trends. This is the standard the whole repo
is held to.

## Stack
- **Frontend:** Next.js 14 App Router, TypeScript, Tailwind. Light theme,
  dense/editorial. Glass surfaces use `backdrop-filter` plus an SVG
  displacement filter (`LiquidGlassFilter`); the ambient wash on `body::before`
  exists so there is something to refract.
- **Backend:** FastAPI, async SQLAlchemy, PostgreSQL.
- **LLM:** Gemini via `generativelanguage.googleapis.com` with a
  `GEMINI_API_KEY`. `gemini_transport.py` is the only module that knows the URL
  or the auth header.
  `LLM_BACKEND=vertex` plus a GCP project and ADC is an optional second path;
  it exists because the free key tier rate-limits partway through a drive.

**`ORCHESTRATOR_MODEL` is `gemini-3.5-flash`, not `gemini-2.5-flash`.** The loop
was built on 2.5-flash, but that model is retired on this endpoint and 404s for
newer keys. Don't "restore" it.

**No hosted instance, deliberately.** The artifact is this repo plus a demo
video. Don't add a "Live:" URL.

**No Alembic.** `create_all` adds new *tables* only, never new columns on
existing ones. Put new state inside an existing JSON column instead — see
`AgentRun.state_json`, which is where both `kind` and a failed run's `error`
live for exactly this reason.

## Running it
```bash
docker compose up --build
docker compose exec api python -m seed.seed_db
```
Frontend `localhost:3000`, API `localhost:8000`, Postgres host port **5433**
(not 5432 — that collides with any other Postgres you run).

**Code changes need `docker compose up -d --build <service>`.** A plain restart
does not pick them up: the image COPYs the source rather than mounting it.

`docker-compose.override.yml` is gitignored and is what puts this machine on
the optional Vertex path by mounting the host's ADC file into the container.

**Seeded credentials:**
| Role | Email | Password |
|---|---|---|
| TPO | tpo@college.edu | tpo@123 |
| Student | student@college.edu | student@123 |
| Company | hr@tcs.com | company@123 |
| Panel | panel@company.com | panel@123 |

## Architecture

**The agent loop** (`orchestrator.py`) is one generic Gemini function-calling
engine. One profile: `shortlist` (`tools.py`) — `get_drive_context → parse_jd →
check_eligibility → rank_candidates → select_candidates → ask_human`. The model
picks the tool and its arguments each step, so two drives produce two traces.

**`ask_human` is a tool, not a hardcoded gate.** Calling it serialises the whole
run to the `agent_runs` table before yielding, so the pause survives the process
holding it. Resuming injects the answer back as a `functionResponse`.

**Scheduling is not an agent** (`schedule_tools.schedule_round`). Same closed
loop — propose → validate → re-plan → commit — in plain Python, ~200ms and
repeatable. `propose` is FCFS; `validate` is the part that matters, checking a
proposal against *every committed slot across every drive and round*, which the
allocator cannot do because it only sees the students in front of it. Re-planning
excludes contested resources or widens the window, bounded by `_MAX_ATTEMPTS`.
Don't reinstate a `schedule` orchestrator profile.

**Auditor** (`auditor_agent.py`): an independent second model call that checks
the shortlist's real numbers, not the orchestrator's narration of them, before
`ask_human` fires. Degrades to `"clear"` rather than blocking.

**Analyst** (`analyst_agent.py`, `POST /api/analytics/ask`): question → generated
SQL → **validated in Python** (single SELECT, table allowlist, PII column
blocklist, no `SELECT *`, forced LIMIT) → read-only execution → answered from the
rows returned. Counting people means `COUNT(DISTINCT student_id)`; the per-drive
tables hold one row per student per drive.

**Onyx sidebar** (`onyx_chat.py`): free-text assistant with one tool,
`ask_analyst`. No data access of its own.

**Shortlist by instruction** (`shortlist_selector.py`): plain English → a filter
spec → **applied in Python**. The model never sees candidates and never names a
student. Actions are set operations on a filter describing who *remains*:
`replace`, `add` (scope: not yet selected, so "10 more" means the next ten),
`keep` (scope: already selected). There is deliberately no "remove" — it reads
naturally and inverts in code.

**Where the model is allowed to decide:** which tool to call, how to read a
sentence, and how to phrase prose. Never a number that reaches a screen, who is
eligible, or who gets scheduled. Those are SQL and Python, because they have to
be auditable and repeatable.

**Analytics are deterministic SQL.** No LLM computes a figure that gets
displayed.

## Gotchas — do not undo
- `bcrypt==4.0.1` pinned; 5.x breaks passlib.
- SQLAlchemy reserves `metadata`; models use `extra_data`.
- Résumés: `GET /api/students/{id}/resume`, JWT via `?token=` query param — a
  plain `<a href>` cannot set headers. No public `/uploads` mount.
- WebSockets (`/ws/*`) require `?token=<jwt>`, checked before `accept()`.
- `_render_template` uses `.format_map(defaultdict(lambda: "-"))`. Reverting to
  `.format(**data)` raises `KeyError` on any missing field.
- Embeddings go over direct `httpx` REST, not LangChain, which hangs 60s then
  504s. TF-IDF is a real fallback, and `matching_complete` records
  `ranking_method` so a silent downgrade is visible.
- `MAX_EMBED_BATCH` is 100 — `batchEmbedContents` rejects more. Ranking falls
  back to TF-IDF on any exception, so exceeding it degrades results silently.
- **Background tasks must open their own DB session** via
  `async_session_factory`. A task closing over the request's `db` pins that
  connection after FastAPI closes the session and can exhaust the pool, which
  surfaces as unrelated pages timing out.
- `gemini-2.5-flash` is a thinking model: scan all parts and skip `"thought"`
  parts. Never assume `parts[0]` is the answer.
- SendGrid and Twilio keys are optional. Without them notifications are still
  created and shown; only delivery fails, and it fails loudly in the logs.
- SQL echo is off unless `SQL_ECHO=true`.

## Doc map
- `README.md` — the front door: the hard problems, architecture, setup, and an
  explicit limitations section. Keep it honest.
- `MY_SYSTEM_DESIGN.md`, `SYSTEM_DESIGN.md`, `problem statement.md` exist on
  this machine but are untracked and gitignored. Stale; don't cite them.
