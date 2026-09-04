# CLAUDE.md — PlacePilot AI (AI Campus Placement Agent)

Single source of truth for this repo. Supersedes AGENTS.md and AGENTIC_OVERHAUL.md
(deleted 2026-08-27 — their content is folded in here, denser). If either file
somehow reappears, this one wins.

## Project context
Solo college project — one person built and tested every part of this, start to
finish. It was originally submitted to a college hackathon (2026-08-29); that
event is over and is no longer what this is for. Current goal: make it stand up
to review by experienced engineers as a portfolio project.
- Working standard: *"if someone opens the live URL right now with no setup,
  does this feature actually work?"* — localhost-only is not done.

## Who you're working with
Beginner/vibe-coder, not a trained developer, needs to be able to re-explain
every feature confidently to someone technical. Direct, no fluff — wants to
understand, not just be told.
- **Every technical explanation: plain English first, then the real term.**
  e.g. "we turn profiles into lists of numbers that capture meaning — an
  *embedding* — then compare them mathematically. That's *cosine similarity*."
- When adding a feature: say what it does in 1 sentence, which layer changes,
  any tradeoff, and exactly what to click to verify.
- When something breaks: what broke (plain English) → what the fix is → what
  they should see now. Never silently fix without explaining.
- Never fabricate data/results to make something look done. If a path
  genuinely doesn't work yet, say so plainly — candour is the whole point.

## Stack (as actually built, not as originally planned)
- **Frontend:** Next.js 14 App Router, TS, Tailwind. PlacePilot design system —
  light theme, dense/editorial, NOT the old dark glassmorphism.
- **Backend:** FastAPI, async SQLAlchemy, PostgreSQL (Cloud SQL in prod).
- **LLM:** Vertex AI Gemini — NOT AI Studio free tier (20 req/day ceiling
  would kill a live demo). `gemini-2.5-flash` for the orchestrator (function
  calling, verified live) and one-shot JSON agents; `gemini-3.5-flash` /
  `-flash-lite` elsewhere.
- **Deploy:** 100% Google Cloud Run (both services) + Cloud SQL + Artifact
  Registry. No Railway/Vercel — DEPLOYMENT.md is stale, ignore it.
- **No Alembic.** `create_all` only adds new *tables*, never new columns on
  existing ones. Don't add columns to existing models without a manual
  `ALTER TABLE` on the live Cloud SQL DB — prefer stashing new state inside an
  existing JSON column instead (see `AgentRun.state_json` below).

## Deploy — GCP project `placement-agent-22587`, region `us-central1`
| Service | URL |
|---|---|
| `placement-backend` | https://placement-backend-891885517174.us-central1.run.app |
| `placement-frontend` | https://placement-frontend-891885517174.us-central1.run.app |

Images: `us-central1-docker.pkg.dev/placement-agent-22587/placement-repo/{backend,frontend}:vN` (increment N each deploy).

```bash
# Backend
gcloud builds submit --tag=us-central1-docker.pkg.dev/placement-agent-22587/placement-repo/backend:vN --region=us-central1 backend/
gcloud run deploy placement-backend --image=us-central1-docker.pkg.dev/placement-agent-22587/placement-repo/backend:vN --region=us-central1

# Frontend — NEXT_PUBLIC_* vars are baked in at BUILD time (Next.js inlines
# them), not runtime env. Omitting the substitutions ships a frontend that
# silently can't reach the API.
gcloud builds submit --config=frontend/cloudbuild.yaml --region=us-central1 \
  --substitutions=_API_URL=https://placement-backend-891885517174.us-central1.run.app,_WS_URL=wss://placement-backend-891885517174.us-central1.run.app,_IMAGE=us-central1-docker.pkg.dev/placement-agent-22587/placement-repo/frontend:vN \
  frontend/
gcloud run deploy placement-frontend --image=us-central1-docker.pkg.dev/placement-agent-22587/placement-repo/frontend:vN --region=us-central1
```

`gcloud run deploy` is treated as a confirm-first action by the harness — expect
to ask before running it, even mid-session.

**Local dev:** no local Postgres/Docker on this machine. Only run the frontend
locally, pointed at the deployed backend, on **port 3000 or 3001** (`CORS_ORIGINS`
in `backend/app/main.py` is a fixed list):
```bash
cd frontend && NEXT_PUBLIC_API_URL=https://placement-backend-891885517174.us-central1.run.app \
  NEXT_PUBLIC_WS_URL=wss://placement-backend-891885517174.us-central1.run.app npx next dev -p 3000
```

**Credentials (seeded):**
| Role | Email | Password |
|---|---|---|
| TPO | tpo@college.edu | tpo@123 |
| Student | student@college.edu | student@123 |
| Company | hr@tcs.com | company@123 |
| Panel | panel@company.com | panel@123 |

## Architecture — the agentic core
`orchestrator.py` is one generic agent-loop engine (Gemini function calling
over Vertex) dispatched by a **`kind`** string stored in `AgentRun.state_json`
(not a DB column — no migration path, see above):
- **`"shortlist"`** (`tools.py`): `get_drive_context → parse_jd →
  check_eligibility → rank_candidates → ask_human`. Model picks the tool and
  args each step; two different drives produce two different traces.
- **`"schedule"`** (`schedule_tools.py`): `get_schedule_context →
  propose_schedule → validate_schedule → (re-plan on violation) →
  commit_schedule`. **The closed loop**: `validate_schedule` checks the
  proposal against *every other committed slot, across every drive/round* —
  the old deterministic `auto-schedule` endpoint (removed) only ever checked
  conflicts within its own batch, so cross-drive panel/room double-bookings
  went undetected. The model fixes a violation itself (exclude the named
  panel/room id, or extend the window) and re-validates; only commits on zero
  violations.

`ask_human` is a tool, not a hardcoded gate — calling it pauses the run and
persists full state to the `agent_runs` Postgres table, so it survives Cloud
Run container recycling (verified: killed the container mid-pause, resumed
correctly). Resuming injects the human's answer as a `functionResponse` and
continues the loop.

**Auditor** (`auditor_agent.py`): a second, independent Gemini call sanity-
checks the shortlist's actual numbers (not the orchestrator's narration of
them) right before `ask_human` fires. Degrades to `"clear"` on failure rather
than blocking.

**Analyst Agent** (`analyst_agent.py`, `POST /api/analytics/ask`): TPO types a
free-text question → model generates SQL → Python validates it (single
SELECT only, table allowlist, PII column blocklist, no `SELECT *`, LIMIT 100)
→ executes → second model call summarizes the real returned rows. TPO-only.

**`vertex_json.py`** (shared one-shot JSON helper — Auditor, Analyst SQL/
summary, Panel agent prep/debrief): `gemini-2.5-flash` is a **thinking**
model and can emit a `"thought": true` part before the real answer part —
always scan all parts and skip thought parts, never assume `parts[0]` is the
answer. (This was a real bug, fixed 2026-08-27.)

**Trace UI**: `AgentTrace` rows (`kind`: thought/tool_call/observation/
decision/violation/ask_human/audit) render generically regardless of which
`kind` of run produced them — adding a new agent profile needs **zero**
frontend trace-viewer changes. The agent dock (`/api/drives/agent-runs/live`)
surfaces any RUNNING/PAUSED run across all drives the same way.

## Scope already decided — don't re-litigate
**Built:** agentic orchestrator + tool registry (two profiles: `shortlist`,
`schedule`), durable `ask_human`, Auditor, Analyst Agent, Onyx free-text
sidebar, scheduling closed loop with cross-round validation.
**Built then removed (2026-09-04):** agent-to-agent schedule negotiation and
the Onyx supervisor profile that dispatched it. It burned 12–18 model steps
plus a Company Agent call to reach the schedule the plain `schedule` agent
reaches in ~4, and by design it could not commit anything — so nothing
depended on it. Don't rebuild it; the `schedule` profile *is* the scheduler.
**Never built** (still fine ideas): NL constraint steering, preference memory,
autonomous night job, Digital Twin no-show simulation, reflection loop,
self-proposed eligibility rules.

## Gotchas — do not undo
- `bcrypt==4.0.1` pinned (5.x breaks passlib).
- SQLAlchemy reserves `metadata` — models use `extra_data` instead.
- Résumés: `GET /api/students/{id}/resume`, JWT via `?token=` query param
  (plain `<a href>` can't set headers). No public `/uploads` static mount.
- WebSocket (`/ws/*`): requires `?token=<jwt>`, checked before `accept()`.
- `_render_template` (notifications) uses `.format_map(defaultdict(lambda:"-"))`
  — don't revert to `.format(**data)`, it raises `KeyError` on missing fields.
- **Never pass a `/`-leading value to `gcloud` from Git Bash.** MSYS rewrites
  it to a Windows path *before gcloud sees it*, silently. This is why
  `UPLOAD_DIR` sat at `C:/Users/mouni/AppData/Local/Temp/uploads` on the live
  Linux container for a week: the 2026-08-27 "fix" ran
  `--update-env-vars UPLOAD_DIR=/tmp/uploads` from Git Bash, which mangled it
  on the way out and reported success. Genuinely fixed 2026-09-04 by running
  the same command from PowerShell. Use PowerShell (or `MSYS_NO_PATHCONV=1`)
  for any gcloud flag whose value starts with `/`, and always read the value
  back off the serving revision afterwards — the deploy exits 0 either way.
- Embeddings: `gemini-embedding-001` via direct `httpx` REST call, not
  langchain (`langchain-google-genai` hangs 60s→504 on every model). TF-IDF
  is kept as a real fallback, not the only path.

## Q&A cheat sheet (interviews, reviews, demos)
| They ask | Say |
|---|---|
| "Is this actually agentic, or a workflow?" | Run the same drive twice with different constraints — two different execution traces. The model picks the tool and its arguments each step; here's the trace. |
| "What do the sub-agents do?" | Specialists with their own tools/prompts. The Auditor's whole job is to disagree with the others — it checks the shortlist's real numbers before a human signs off. |
| "What happens when it gets something wrong?" | Watch the scheduler: it proposes, validates against the whole calendar, and re-plans on its own when it finds a conflict — then tells you what it traded off. |
| "Where's the human in the loop?" | `ask_human` is a tool the agent chooses to call, not a hardcoded gate — and it's a durable pause: the run survives a container restart. |
| "Is it production-grade?" | JWT auth, 4 roles, WebSocket auth, authenticated résumés, deployed on Cloud Run + Cloud SQL + Vertex AI. |
| "Can it answer something you didn't pre-build a screen for?" | The Analyst Agent — ask it any placement-data question, it writes the SQL live, shows it to you, runs it read-only, and answers from the real rows. |

## Doc map
- `MY_SYSTEM_DESIGN.md` / `SYSTEM_DESIGN.md` — beginner-friendly architecture
  diagrams, not kept in sync with every change; verify against code first.
- `problem statement.md` — original hackathon brief.
- Everything else that used to be in AGENTS.md / AGENTIC_OVERHAUL.md is above.
