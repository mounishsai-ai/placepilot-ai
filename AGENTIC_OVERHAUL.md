# AGENTIC OVERHAUL — Architecture Plan
### From "workflow with LLM calls" → real agentic platform

**Written:** 2026-08-26 · **Deploy deadline:** Aug 28 afternoon · **Judging:** Aug 29
**Budget:** ~2.5 working days · **Repo status:** nothing deployed yet

---

## 0. THE ONE HARD CONSTRAINT (read before anything else)

You have **~2.5 working days** and **zero deployed URLs**. AGENTS.md's own rule —
*"if a judge opened this URL right now, would it work?"* — means a live-but-plain
app beats a brilliant-but-unreachable one, every single time.

**So step zero is non-negotiable:**

> **Deploy the CURRENT code tonight. Tag it. That is your insurance policy.**
> Only after there is a working live URL do we touch the orchestrator.

If the overhaul goes sideways on Aug 28 morning, you roll back to the tag and you
still have a working submission. Without that tag, the overhaul gambles your
entire hackathon on one branch.

**The good news that makes the overhaul survivable:** the thing that needs
replacing is *small*. Your database schema is genuinely good. Your sub-agent
functions (`jd_analyst`, `eligibility_agent`, `matcher_agent`, `scheduler_agent`,
`notifier_agent`) are genuinely good and become **tools** almost unchanged. The
only broken piece is the ~300 lines in the middle: `supervisor.py`.

---

## 1. THE DIAGNOSIS — why this is not yet "agentic AI"

You asked: *"LLM at the core with subagents, but not for name's sake?"*
Here is the honest answer, using your own code as evidence.

**Plain English:** right now your "agent" is a to-do list that a human wrote. The
AI fills in some blanks, but it never decides what to do next.

**The real term:** `supervisor.py` is a **deterministic DAG** (a fixed flowchart)
with LLM calls embedded in the boxes. It is not an agent loop.

### The four proofs, straight from your file

| Your code | What it means |
|---|---|
| `graph.add_edge("analyze_jd", "check_eligibility")` | The order is hardcoded. **Every drive produces an identical execution trace.** Nothing is decided. |
| `route_after_shortlist()` → `if state.get("tpo_shortlist_approved") is True` | This is your "decision node." It's an `if` statement. The model is never consulted. |
| The LLM does exactly 2 things | Parse a JD into JSON, and write explanation prose. It **never selects an action**. |
| `resume_pipeline()` | **Dead code.** Never called. The graph ends at `await_shortlist_approval → END`; scheduling is a separate REST call that never re-enters the graph. |

### The question that kills you in the demo

A judge who knows this space asks one question:

> **"What does the model decide about its own next step?"**

Right now the truthful answer is **"nothing."** That is the definition of
"subagents for name's sake," and it is exactly what this competition judges.
Everything below exists to change that answer.

---

## 2. WHAT "REAL AGENTIC" MEANS — the 5-test definition

Don't design toward a vibe. Design to pass five falsifiable tests. Pass them and
you *are* agentic by construction — and each one doubles as a demo beat.

| # | Test | Now | Target |
|---|---|---|---|
| **1** | Do two different inputs produce two different **execution traces** — not just different outputs? | ❌ identical every run | ✅ agent plans per-drive |
| **2** | Does the **model** choose the tool and its arguments, or does code call the function? | ❌ code calls | ✅ model emits tool calls |
| **3** | Is there **one closed loop** a judge can watch fire — attempt → validator finds violation → agent re-plans? | ❌ none | ✅ the scheduling loop |
| **4** | Does something learned in run N **change behaviour in run N+1**, visibly? | ❌ no memory | ✅ preference memory |
| **5** | Can the human **steer in natural language**, not just approve/reject? | ❌ 2 boolean gates | ✅ NL constraint steering |

**The single best demo moment is #5 crossed with #3:**

> The TPO types *"too few ECE students, and Friday is out."*
> The agent re-plans shortlist **and** schedule, then **states the tradeoff it
> made and what it gave up.**

That is legible agency. It is not a gimmick, and no other team will have it.

---

## 3. TARGET ARCHITECTURE — "The Placement Control Tower"

The metaphor is deliberate and also literally true: you are coordinating people,
rooms, panels and time slots against hard constraints. That is air traffic
control. Every decision below inherits from that.

### 3.1 Layer 1 — The Tool Registry (the foundation)

**Plain English:** we stop calling our Python functions from Python. Instead we
*describe* them to Gemini, and Gemini decides which one to call and with what
arguments.

**The real term:** **function calling / a tool registry.** This single change is
what converts "workflow" into "agent."

Almost all of these wrap code you already have:

```
── Data tools ────────────────────────────────────────
query_students(filters)          -> SQL over students table
get_drive(drive_id)              -> drive + rules + status
read_resume(student_id)          -> Document AI extraction

── Reasoning tools (wrap existing agents) ────────────
parse_jd(text)                   -> jd_analyst.analyze_jd
check_eligibility(drive, rules)  -> eligibility_agent.run_bulk_eligibility
rank_candidates(drive, weights)  -> matcher_agent  (weights now MODEL-CHOSEN)
explain_match(student, drive)    -> jd_analyst.explain_match

── Action tools ──────────────────────────────────────
propose_schedule(round, cons)    -> scheduler_agent.allocate_slots
validate_schedule(schedule)      -> NEW: returns a list of violations
commit_schedule(schedule)        -> writes InterviewSlot rows
send_notification(...)           -> notifier_agent
file_exception(kind, ref, why)   -> writes exceptions  (feature #7!)

── Agentic tools (the ones that create agency) ───────
search_company_intel(name)       -> Gemini + Google Search grounding
recall_precedent(query)          -> preference / episodic memory
ask_human(question, options)     -> ⭐ HITL AS A TOOL
```

> ⭐ **`ask_human` as a tool is the elegant move.** Today your human gates are
> hardcoded nodes in a flowchart. Make "ask the human" a *tool the agent can
> choose to call*, and HITL upgrades from an if-statement into a genuine
> decision: **the agent decides when it needs you.** Same two approval gates in
> the demo — a completely different answer when a judge asks how they work.

> 🚨 **PREREQUISITE — do this BEFORE `ask_human`, or it is theatre.**
> `build_placement_graph()` currently uses `MemorySaver()` — an **in-process**
> checkpointer. `ask_human` requires the agent loop to **suspend** and resume
> possibly hours later when the TPO answers. On Cloud Run (which scales to zero
> and recycles containers) that in-memory state is **gone**. `min-instances=1`
> lowers the odds; it does not guarantee the container survives from "agent asks"
> to "TPO answers."
>
> **Failure mode:** perfect on localhost, perfect in your first rehearsal, then a
> judge approves 20 minutes later and the run has vaporised.
>
> **Fix (≈1.5h):** an `agent_runs` table in the Postgres you already have —
> `(id, drive_id, status, state_json, pending_question, created_at)`. Resume =
> load state → inject the human's answer → continue the loop.
>
> **Verify it exactly like this:** kill the backend container while a run is
> paused, restart it, confirm the run still resumes. If that test fails,
> `ask_human` is the very thing you're trying to escape — a gate that only looks
> agentic.

### 3.2 Layer 2 — Orchestrator + four real sub-agents

**Plain English:** one lead agent that plans, and four specialists it hands work
to. Each specialist has its own tools and its own think-act loop.

```
                    ┌──────────────────────────┐
                    │   ORCHESTRATOR (Pro)     │
                    │  plans · delegates ·     │
                    │  re-plans on failure     │
                    └────────────┬─────────────┘
       ┌────────────────┬────────┴───────┬──────────────────┐
       ▼                ▼                ▼                  ▼
┌───────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────────┐
│  SOURCING     │ │ LOGISTICS   │ │   COMMS     │ │ ⚖  AUDITOR       │
│  eligibility  │ │ schedule    │ │  notify     │ │ adversarial      │
│  + ranking    │ │ rooms/panel │ │  escalate   │ │ checks OTHERS    │
│  tunes weights│ │ ↺ VALIDATOR │ │ tone/channel│ │ files exceptions │
└───────────────┘ └─────────────┘ └─────────────┘ └──────────────────┘
```

**These are real sub-agents, not renamed functions.** Each one:

- gets its own **system prompt and its own subset of tools**
- runs **its own loop** — it can call a tool, read the result, then call another
- can **fail and report back**, and the orchestrator re-plans around it

**⚖ The Auditor is your differentiator.** It is an agent whose *job is to
disagree with the other agents.* It reads the shortlist and the schedule and
asks: is this skewed toward one branch? did we drop an edge case? is a panel
member double-booked across drives? did we cut a student with a strong resume
over a 0.1 CGPA miss?

Two reasons to build it first among the sub-agents:

1. **It is unmistakably agentic.** "One AI reviews another AI's work and files
   objections" cannot be mistaken for a workflow.
2. **It fills your empty feature #7.** AGENTS.md says `is_edge_case` is
   "computed, stored, never read." The Auditor's output *is* the exceptions
   panel. A gap becomes a headline feature.

### 3.3 Layer 3 — The closed loop (the centrepiece)

**Plain English:** the agent tries to build a schedule, a strict rule-checker
tells it what it got wrong, and it tries again — on its own.

```
 Logistics Agent
      │  propose_schedule()
      ▼
 ┌─────────────────┐   violations found   ┌──────────────────────┐
 │ validate_       │─────────────────────▶│ agent reads the      │
 │ schedule()      │                      │ violations, re-plans │
 │ (deterministic) │◀─────────────────────│ with new constraints │
 └────────┬────────┘        retry         └──────────────────────┘
          │ clean
          ▼
    commit_schedule()     ── or, if stuck after N tries ──▶ ask_human()
```

The validator is **deterministic Python, not an LLM** — that is what makes it
trustworthy. Hard constraints: no student double-booked, no panel double-booked,
no room double-booked, panel availability respected, round window respected.

**What the judge literally sees, live:**

> Attempt 1 → 3 clashes · Attempt 2 → 1 clash · agent relaxes a *soft* constraint
> and says *"I moved 2 interviews past 5 PM to clear the Room B conflict — that's
> outside preferred hours, flagging it"* → Attempt 3 clean.

That one sequence passes tests #1, #2 and #3 at once.

### 3.4 Layer 4 — Memory that changes behaviour (test #4)

**Plain English:** the agent remembers what you overruled last time, pre-adjusts
next time, and tells you it did.

- **Episodic memory** — every TPO override is recorded: *"TPO removed 4 students
  below 7.5 CGPA from the TCS shortlist."*
- **Semantic memory** — those get distilled into a policy hint.
- **Applied, visibly** — next drive, the dashboard shows a **"Learned from you"**
  card:
  > *"Across your last 3 product-company drives you consistently cut candidates
  > below 7.5 CGPA. I pre-weighted CGPA higher for this shortlist. **Undo this?**"*

Storage: an `agent_memory` table in the same Postgres — no new infrastructure,
about an hour of work. The *visible* part is what scores.

### 3.5 Layer 5 — Natural-language steering (test #5)

One input box on the drive console. The TPO types (or speaks) a constraint:

> *"Too few ECE students, and Friday is out."*

The orchestrator turns that into constraint deltas, re-runs only the affected
sub-agents, then **reports the diff and its cost**:

> *"Raised ECE representation from 3 to 8 by relaxing the CGPA floor to 7.2 for
> ECE only. Removed all Friday slots — that pushed 6 interviews into Saturday
> morning and I need one more panel member. Net: shortlist quality 0.81 → 0.78.
> Accept, or should I protect quality instead?"*

**This is the moment you win the room.** Rehearse this exact interaction.

### 3.6 Layer 6 — The Night Shift (true autonomy)

**Plain English:** at 2 AM, with nobody logged in, the agent wakes up on its own
and does a patrol.

Cloud Scheduler → Cloud Run Job → the agent runs with **no user present** and
scans for unfilled panel slots, students missing resumes, drives stalled at a
gate, no-show risk, students with zero applications, expiring deadlines. It files
exceptions, drafts the notifications, and queues them for morning approval.

The TPO opens the dashboard at 9 AM to:

> **"While you were away:** I found 7 issues, resolved 4 myself, and need you on 3."

**Why this earns its ~3 hours:** every other team's AI runs when a user clicks a
button. Yours runs when nobody is watching. That is a *category* difference — and
it closes two gaps AGENTS.md already flags open (no reminder scheduler;
exceptions never surfaced).

---

## 4. "SCI-FI / ALIEN TECH" — ranked, with the cut line drawn

Ranked by **(impact × wow) ÷ risk**, with an honest cut line for 2.5 days.

### ✅ BUILD — this is the win condition

| Idea | Why it wins | Cost |
|---|---|---|
| **The Control Tower trace UI** | Live spatial view: students flow as particles through pipeline stages, agents glow when active, tool calls pulse along the edges. **Not decoration — it IS the execution trace.** | 5h |
| **NL steering + tradeoff report** | Test #5 × #3. The single best moment. | 3h |
| **Scheduling closed loop** | Test #3. Watchable, undeniable. | 3h |
| **⚖ Auditor sub-agent** | Real multi-agent, and fills empty feature #7. | 2h |
| **Night Shift agent** | A different category from every other submission. | 3h |
| **"Learned from you" memory** | Test #4, and cheap. | 1.5h |

### 🟡 HIGH VALUE, CHEAP — build if Day 2 morning is on schedule

| Idea | Why | Cost |
|---|---|---|
| **Voice co-pilot (Gemini Live API)** | Hold a key, talk to the tower: *"who dropped off the shortlist and why?"* It answers in audio **and drives the UI**. Live API shows **unlimited RPM** in your quota table. Feels genuinely alien in a placement app. | 4h |
| **Company intel via Search grounding** | The agent researches the recruiter live and briefs the TPO with citations. A real, verifiable tool call. | 1.5h |
| **TTS morning briefing** | 45-second audio digest auto-plays on dashboard load. Pure wow, near-zero risk. | 1h |
| **Document AI resume parsing** | Replaces `pypdf`. A real Google Cloud service on the stack diagram. | 2h |

### 🔵 IF THE MIRACLE HAPPENS (Day 3 buffer only)

- **No-show simulation** — before committing, Monte-Carlo the schedule against the
  historical no-show rate: *"at 15% no-show you'll have 4 idle panel-hours in Room
  B — want me to overbook slot 7?"* Genuinely predictive.
- **Counterfactual replay** — *"what if the CGPA cutoff had been 7.0?"* Replay the
  pipeline, diff the outcome, agent explains the delta.
- **AI mock interview (Live API)** scoring into `placement_readiness_score` — closes
  the analytics loop so feature #8 stops being a static chart.
- **Agent-to-agent negotiation** — a Company Agent and a College Agent argue over
  drive terms in a visible transcript until they converge.

---

## 4.5 🛸 THE "WOW ARCHITECTURE" TIER — bigger swings

These are not extra features bolted on. Each one is a **change in what the system
is capable of**, and each is very hard to fake — which is exactly why they score.

### 🥇 #1 — The Analyst Agent (an agent that writes its own code)

**Plain English:** the judge asks a question nobody built a screen for, and the AI
writes the database query itself, runs it, and answers.

**The real term:** **tool-use with code generation / a text-to-SQL agent.**

> Judge types: *"Which branch has the worst offer-conversion rate this year, and is
> it CGPA or skills driving it?"*
>
> No endpoint exists for that question. The agent **writes the SQL**, runs it
> against the real database, reads the numbers, reasons about the cause, and draws
> the chart. **And it shows you the SQL it wrote**, so you can check it.

**Why this is the single biggest wow available to you:** every other demo answers
questions the team pre-built. Yours answers questions **the judge invents on the
spot.** That cannot be staged, and a judge knows it instantly.

**Safety rails (mention these — they turn a "risky" look into a "senior" look):**
- a **read-only** database user — the agent physically cannot write or delete
- a query timeout and a row cap
- an allowlist of tables it may touch
- the SQL is displayed before it runs

**Cost: ~3h.** Highest wow-per-hour on this entire document.

### 🥈 #2 — Two agents that negotiate (visible, opposing objectives)

**Plain English:** two AIs with *different bosses* argue until they agree.

- The **Company Agent** wants: top talent, fewest interview days, senior panels.
- The **College Agent** wants: maximum placements, no clashes with exams, fairness
  across branches.

They exchange proposals for 3–4 rounds in a transcript the TPO watches, and
converge on terms both accept. The TPO approves the final deal.

This is real multi-agent behaviour — not one model wearing four hats — and it is
genuinely dramatic to watch. **Cost: ~3h.**

### 🥉 #3 — The agent checks its own work before acting (reflection)

**Plain English:** before it does anything, it writes a plan, then criticises its
own plan, then fixes it — and you see all three steps.

**The real term:** a **reflection loop**. It's ~30 lines around your orchestrator,
and it makes the trace dramatically more impressive because the judge watches the
agent **catch its own mistake** before it happens. **Cost: ~1h. Best cheap win here.**

### #4 — The Digital Twin (predicting before committing)

Before committing a schedule, simulate it 500 times against your historical
no-show rate:

> *"At a 15% no-show rate you'll lose about 4 idle panel-hours in Room B. Want me
> to overbook slot 7?"*

Nobody else will predict. Everyone else reports. **Cost: ~2h.**

### #5 — Rules the agent learns and proposes itself

The agent notices patterns in past TPO decisions and **proposes a new eligibility
rule**, in writing, for approval:

> *"In your last 4 drives you always waived the backlog rule for students with
> CGPA above 8.5. Should I make that an official rule? [Approve] [Never ask again]"*

The system's own logic improves from use. **Cost: ~2h.**

---

> ⚠️ **These are TRADES, not additions.** Your constraint is **hours, not API
> quota**. If you want the wow tier, the honest swap is:
>
> **Add the Analyst Agent (3h) + reflection loop (1h) → drop the Night Shift (3h)
> and the voice co-pilot (4h).**
>
> That nets you *more* wow for *fewer* hours. Reflection especially — 1 hour to
> make every other feature look smarter.

---

### ❌ CUT — do not touch

**Veo video** (slow, expensive, adds nothing) · **Computer Use** (far too fragile
live) · **full WebGL 3D** (eats a day, breaks on the judge's laptop) · **image
generation** beyond one pre-rendered poster · **rewriting `models.py`** (it's
good — leave it alone).

---

## 5. THE $300 GCP PLAN — and one honest correction

### The correction you need first

**The credits' real job is not to be burned. It is to remove a ceiling that would
otherwise make this entire architecture undemonstrable.**

Look at your own quota table: `GEMINI_MODEL_PRO = "gemini-3.6-flash"` is
**20 requests per DAY** on the AI Studio free tier. An LLM-orchestrated agent
makes 15–40 model calls in a *single* pipeline run. **On free tier you get roughly
one demo run per day** — and then it dies in front of the judge.

> **Priority zero, before any code: move Gemini calls to Vertex AI on the billing
> account with the $300 attached.** Your constraint holds — the free trial credit
> covers **first-party Gemini models on Vertex**, not Model Garden partner models.
> That's fine; Gemini is all you need.

You cannot meaningfully spend $300 in three days and you shouldn't try. Realistic
burn for the whole hackathon window is **$30–70**. The remaining ~$230 is 90 days
of runway *after* you win — present that to judges as sustainability, not waste.

### Services to put on the stack (each one is also a slide)

| Service | Used for | Why it's a judge point |
|---|---|---|
| **Vertex AI (Gemini Pro + Flash)** | Orchestrator + 4 sub-agents | No rate ceiling; enterprise endpoint |
| **Cloud Run** | FastAPI backend | Scales to zero, **no Railway build-size limit** — permanently fixes your torch/2.5 GB problem |
| **Cloud Run** or **Firebase Hosting** | Next.js frontend | One cloud, one bill |
| **Cloud SQL (Postgres)** | DB + the `agent_runs` durable-state table | Survives container recycling — the thing that makes `ask_human` real |
| ~~**pgvector migration**~~ | ~~replace ChromaDB~~ | ❌ **CUT — see below** |
| **Cloud Scheduler + Cloud Run Jobs** | The Night Shift agent | This is what makes autonomy real |
| **Cloud Storage** | Resumes | Replaces local `uploads/`, which cannot survive a container restart |
| **Document AI** | Resume parsing | Replaces `pypdf` |
| **Gemini Live API** | Voice co-pilot | Unlimited RPM |
| **Gemini TTS** | Morning briefing | Cheap wow |
| **Search grounding** | Company intel | Verifiable tool call |
| **Cloud Logging / Trace** | Agent observability | "We can trace every agent decision in production" |

> ❌ **CUT: the pgvector migration.** It directly contradicts §0. "Deploy the
> current code tonight, ship nothing new" and "delete ChromaDB, migrate to
> pgvector" cannot both happen tonight. No judge scores it — matching already
> works via Chroma or the TF-IDF fallback. **Deploy tonight with whatever DB
> config already runs.** Vector tidiness is not a feature. Revisit after Aug 29.

> ⚙️ Set Cloud Run **`min-instances=1`** on both services before the demo. A cold
> start in front of a judge reads as "broken," and it costs pennies. (This is a
> polish measure, *not* a substitute for the `agent_runs` table — see §3.1.)

> ⚠️ **Verify the exact Vertex model IDs** in Model Garden before wiring them. Your
> AI Studio names map closely but are not always identical, and one bad model
> string is a silent 404 — which is exactly how your embeddings broke the first
> time (AGENTS.md §3.2).

---

## 6. BUILD ORDER — neither frontend-first nor backend-first

You asked which. **The honest answer: neither. Contract first, then one vertical
slice.**

Here's why. **Your demo *is* the trace.** What a judge stares at is the agent's
stream of thoughts, tool calls and decisions. So the artifact that must exist
before anything else is the **shape of an agent event**.

- *Backend-first* hides whether the trace is legible until it's too late to change it.
- *Frontend-first* means designing for events you haven't defined yet.
- **Contract-first** lets both sides move in parallel against a fixed schema.

### Step 1 — Define the trace event schema (30 min, do this first)

```jsonc
{
  "run_id": "...", "drive_id": "...", "seq": 14,
  "agent": "logistics",          // orchestrator | sourcing | logistics | comms | auditor
  "kind": "thought",             // thought | tool_call | observation | decision
                                 // | violation | replan | ask_human | handoff
  "summary": "Room B is double-booked at 14:30",   // one line, human-readable
  "detail": { },                 // tool name, args, raw result
  "confidence": 0.82,
  "cost_ms": 1840, "tokens": 512,
  "ts": "2026-08-27T14:30:11Z"
}
```

Everything else — the WebSocket, the Control Tower UI, the audit trail, the
`agent_events` table you already have — keys off this one object.

### Step 2 — ONE vertical slice, end to end, deployed

Orchestrator + 6 tools + trace UI, for **a single drive**. Deploy it. Prove the
loop is legible before building breadth.

### Step 3 — Breadth across the eight required features

Only after the slice is live.

---

### ⚠️ THE BUDGET REALITY CHECK — decide the cuts NOW, not at hour 15

Add up §4's "BUILD" tier as written: 5 + 3 + 3 + 2 + 3 + 1.5 = **17.5 hours** — and
the largest single item, the **tool registry + orchestrator rewrite (5–6h)**, isn't
even in that number. Plus tonight's first-ever GCP deploy. Plus the `agent_runs`
table (1.5h).

Against roughly **21 working hours** if nothing breaks. Things will break.

**So decide the cut order now.** If you decide at hour 15 you'll cut whatever is
nearest, instead of whatever matters least. Ranked by *tests-passed per hour*:

| Tier | Contents | Hours |
|---|---|---|
| 🟥 **CORE — passes all five tests** | `agent_runs` durable state → tool registry + orchestrator → `validate_schedule()` + re-plan loop → **trace register UI** → "Learned from you" card → NL steering | **~12h** |
| 🟧 **First additions if Day 1 ends early** | Auditor (2h, fills feature #7) · Night Shift (3h, the category differentiator) | +5h |
| 🟨 **Only if genuinely ahead** | Voice co-pilot · Search grounding · TTS briefing | +6h |

> **Trim inside the core:** the Control Tower at 5h *with particle flows* is the
> wrong 5 hours. **The scrolling trace register alone** — timestamped, dense,
> flight-strip styled — is ~2h and carries most of the effect. Particles are
> decoration layered on a trace that has to be legible first. Build the register;
> add particles only with time left over.

> **Test #1 falls out free** the moment the orchestrator exists — you don't budget
> for it.

### 📁 Scope surface — it's five files, not one

"~300 lines in the middle" undersells it slightly. Replacing `supervisor.py` also
touches:

- `app/api/drives.py` — the call sites that start/resume the pipeline
- `app/api/websocket.py` — the `emit_agent_event` payload shape
- `frontend/src/components/ui/AgentEventFeed.tsx` — renders the new event kinds
- `app/models/models.py` — the `agent_events` table + the new `agent_runs` table

Still very doable. But budget for **five files**, so you aren't surprised at hour 6.

### The hour-by-hour (2.5 days — be ruthless)

**🌙 TONIGHT (Aug 26) — INSURANCE. Ship nothing new.**

1. ⚠️ **FIRST, before anything else (15 min):** enable Vertex AI on the billing
   account and make **one successful Gemini call** through it. Free-trial accounts
   carry quota restrictions — **if Vertex is blocked on your account, the entire
   architectural premise changes.** This is a 15-minute check gating 2.5 days of
   work. Do not deploy first and discover this tomorrow.
2. Commit everything. `git tag pre-overhaul`.
3. Deploy current code → Cloud Run + Cloud SQL (+ Vercel, or go all-GCP).
   **Use whatever DB/vector config already runs.** Change nothing tonight.
4. Seed the deployed DB. Smoke-test all 4 logins on the **live URL**.

> ✋ **Do not start the overhaul until a judge could click a live link.**
> Budget honestly: a first-ever Cloud Run + Cloud SQL deploy is not a one-hour
> job for anyone. If it eats the whole evening, that was the right trade.

**☀️ DAY 1 (Aug 27) — the agent becomes an agent**

| Time | Work |
|---|---|
| Early AM | Trace event schema (30 min) → **`agent_runs` durable-state table** |
| Morning | Tool registry (wrap existing agents) → orchestrator loop |
| Midday | `validate_schedule()` + the closed re-plan loop |
| Afternoon | `ask_human` tool → **run the kill-the-container resume test** |
| Evening | NL steering endpoint · **redeploy, verify live** |
| *Stretch* | Auditor sub-agent → exceptions panel |

**🎨 DAY 2 (Aug 28) — the tower, then freeze**

| Time | Work |
|---|---|
| Morning | **Trace register UI first** (invoke the `frontend-design` skill), then restyle the TPO console around it. Other 3 roles get the new tokens only |
| ~Noon | "Learned from you" memory card · Night Shift job on Cloud Scheduler *(if on schedule)* |
| **Afternoon** | **DEPLOY. FREEZE THE CODE.** Non-negotiable. |
| Evening | 3 full demo rehearsals on the live URL, stopwatch in hand |

**🗓 DAY 3 (Aug 29) — judging.** Nothing new. Buffer only.

> **The 80/20 that keeps Day 2 survivable:** rebuild the **TPO console** fully in
> the new design language — it's the surface a judge lives on. Restyle the
> student / company / panel portals with the new tokens only. Do not attempt four
> portals in one morning.

---

## 7. DESIGN DIRECTION — kill the glassmorphism

**The blunt truth:** your current look (`--bg-primary: #020209`, purple/cyan neon,
`backdrop-blur-xl`, Inter) is **the most templated "AI app" aesthetic that
exists.** Every hackathon has four of them. A judge has seen it nine times before
lunch, and it quietly signals "generated."

**The direction instead: an operations console.** Bloomberg Terminal × air traffic
control × Braun industrial design.

| | Away from | Toward |
|---|---|---|
| **Density** | airy cards, big empty gradients | dense and information-rich, every pixel earning its place |
| **Colour** | purple/cyan neon everywhere | near-neutral ground + **one** signal colour (sodium amber) for agent activity; green = confirmed, red = violation. Colour means *status*, never decoration |
| **Type** | Inter everywhere | a distinctive display face + a real mono for all data and traces |
| **Surface** | frosted glass | flat, matte, hairline rules — like instrumentation |
| **Motion** | float / glow / pulse | motion only when the agent actually *does* something |
| **Centrepiece** | a KPI card grid | **the live trace register** — a timestamped agent log styled like an ATC flight-strip board |

Restraint reads as *engineered*. Neon reads as *templated*. On Day 2, invoke the
**`frontend-design`** skill and hand it this direction.

---

## 8. WHAT YOU SAY TO THE JUDGE

Rehearse these. Each maps to something the architecture actually does.

| Judge asks | You say |
|---|---|
| *"Is this actually agentic, or just a workflow?"* | "Run the same drive twice with different constraints — you get two different execution traces. The model picks the tools and the arguments. Here's the trace." |
| *"What do the sub-agents actually do?"* | "Four specialists with different tools and different prompts. The Auditor's job is to **disagree** with the other three — every exception on this panel was filed by one AI objecting to another AI's work." |
| *"What happens when it gets something wrong?"* | "Watch." *(trigger the scheduling conflict)* "The validator is deterministic Python — the agent reads the violations and re-plans. It just told you which soft constraint it traded away." |
| *"Where's the human in the loop?"* | "`ask_human` is a **tool**. The agent decides when it needs me — it isn't a hardcoded gate. And I steer in plain English, not just approve or reject." |
| *"Does it learn?"* | "This card. It noticed I cut sub-7.5 CGPA candidates in my last three product drives and pre-weighted for it — and it's asking permission, not assuming." |
| *"Is it production-grade?"* | "Cloud Run, Cloud SQL with pgvector, Vertex AI, Cloud Scheduler. JWT, four roles, authenticated resumes. Every agent decision traced in Cloud Logging." |
| *"What runs without a user?"* | "Cloud Scheduler wakes the agent at 2 AM. This morning it found 7 issues, fixed 4 itself, and escalated 3." |

### The one honest answer to keep

AGENTS.md is right about this: if some path still doesn't fully resume after
approval, **say so plainly.** Judges reward candour and punish bluffing. But note
that the whole point of the `ask_human` tool is that this answer *changes* — the
pause becomes a tool result the agent waits on, not a dead end.

---

## 8.5 "IF WE DEPLOY NOW AND THEN CHANGE THINGS — WHAT HAPPENS?"

Short answer: **nothing bad. Deploying is not a one-time, one-shot event.** This
is the most common beginner worry and it's worth killing properly.

**The analogy:** deploying is like moving into a house. The *first* move is slow —
you set up water, electricity, internet. But once you live there, changing the
furniture is easy. You don't move house again to repaint a wall.

**What actually happens:**

- **Tonight (the slow part, 2–4h):** create the Google Cloud project, the database,
  the two Cloud Run services, set the environment variables, seed the data. This
  is the plumbing. You only do it once.
- **Every time after that (the fast part, 3–5 min):** you change code → push →
  Cloud Run rebuilds and swaps the new version in automatically. Your URL never
  changes. Nobody is "down" while it happens — Cloud Run keeps the old version
  serving until the new one is healthy, then switches.

**Three safety nets that make changing things safe, not scary:**

| Net | What it does | Plain English |
|---|---|---|
| `git tag pre-overhaul` | marks tonight's working code | A **save point in a video game.** If the overhaul breaks, you load the save. |
| Cloud Run **revisions** | every deploy is kept | A **one-click undo button** in the console. Bad deploy → roll back to the last good one in ~20 seconds. |
| A **branch** for the overhaul | new work stays separate | You build in a **separate room.** The live app keeps running the old code until you decide to swap. |

**The one thing that genuinely needs care:** database changes. Adding the
`agent_runs` and `agent_memory` tables means the live database needs those tables
too. Adding *new* tables is safe. **Renaming or deleting existing columns is not** —
don't do it this week. `models.py` stays as it is.

> **The real reason to deploy tonight isn't the deployment. It's that every
> deployment problem you're going to hit — a missing environment variable, a
> database that won't connect, a build that's too big — you hit them TONIGHT, on
> code that already works, instead of at 2 PM on Aug 28 with new code you're also
> debugging at the same time.**
>
> Deploying tonight doesn't cost you a night. It buys you Aug 28 afternoon.

---

## 9. THE ONE-PARAGRAPH VERSION

> Keep the schema. Keep the sub-agent functions. **Delete `supervisor.py`'s
> hardcoded flowchart** and replace it with an LLM orchestrator over a real tool
> registry, four sub-agents with their own loops, one deterministic validator that
> forces a visible re-plan, a memory that changes next run's behaviour, and a human
> who steers in English. Wrap it in a dense operations-console UI whose centrepiece
> is the live agent trace. Host it entirely on Google Cloud so the $300 removes the
> rate ceiling that would otherwise kill the demo. **Deploy the current code
> tonight so none of this is a gamble.**
