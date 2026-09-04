/* The real architecture, hand-placed in 3D space -- deterministic coordinates,
   not a runtime force-simulation. A physics layout looks impressive until it
   settles on an unreadable tangle; fixed positions we chose stay legible and
   never NaN out. Every tool name and role description here matches the actual
   backend registries (tools.py / schedule_tools.py / onyx_chat.py /
   analyst_agent.py / auditor_agent.py / panel_agent.py). */

export type NodeKind = "core" | "loop" | "oneshot";

export interface AgentNode {
  id: string;
  label: string;
  kind: NodeKind;
  color: string;
  position: [number, number, number];
  radius: number;
  role: string;
  tools?: string[];
}

export interface Edge {
  from: string;
  to: string;
  color: string;
}

export const NODES: AgentNode[] = [
  {
    id: "core",
    label: "Orchestrator Loop",
    kind: "core",
    color: "#F5F6EF",
    position: [0, 0, 0],
    radius: 0.85,
    role:
      "One Gemini function-calling loop, reused by both loop-based agents below. Which agent it becomes is decided entirely by which profile -- a system prompt plus a tool list -- gets passed in. Adding a new agent means adding one dictionary entry, not new engine code.",
  },

  // ── Ring 1: the loop-based agent profiles ───────────────────────────────
  {
    id: "shortlist",
    label: "Shortlist Agent",
    kind: "loop",
    color: "#0FA968",
    position: [4.4, 0.3, 0],
    radius: 0.55,
    role: "Takes one placement drive from a raw job description to a ranked, human-approved shortlist. The model chooses which tool to call at each step, so two drives with different constraints produce two different traces.",
    tools: ["get_drive_context", "parse_jd", "check_eligibility", "rank_candidates", "select_candidates", "ask_human"],
  },
  {
    id: "schedule",
    label: "Schedule Agent",
    kind: "loop",
    color: "#3B5BA6",
    position: [-4.4, 0.3, 0],
    radius: 0.55,
    role: "Builds a conflict-free interview schedule inside a fixed time window. propose_schedule allocates first-come-first-served, which only avoids clashes inside its own batch; validate_schedule is what checks the proposal against every slot already committed across every other drive and round. On a violation the model re-plans and re-validates itself, and only commits once it comes back clean.",
    tools: ["get_schedule_context", "propose_schedule", "validate_schedule", "commit_schedule", "ask_human"],
  },

  // ── Ring 2: one-shot specialists, each a single structured judgement ────
  {
    id: "auditor",
    label: "Auditor",
    kind: "oneshot",
    color: "#34D89A",
    position: [7.0, 1.9, 2.2],
    radius: 0.4,
    role: "An independent second model call that fact-checks the shortlist's real numbers -- not the orchestrator's narration of them -- right before a human is asked to approve. Its whole job is to disagree. Degrades to \"clear\" on failure rather than blocking the run.",
  },
  {
    id: "panel_agent",
    label: "Panel Agent",
    kind: "oneshot",
    color: "#5A665F",
    position: [-6.6, -1.6, 2.6],
    radius: 0.4,
    role: "Three focused, one-shot jobs around an interview slot: brief the panelist beforehand, structure their debrief afterward, and clean up voice-dictated session notes.",
  },
  {
    id: "onyx_sidebar",
    label: "Onyx",
    kind: "oneshot",
    color: "#D9922B",
    position: [0.6, 3.2, -4.4],
    radius: 0.5,
    role: "A free-text assistant reachable from anywhere in the TPO portal. It holds no data access of its own -- its single tool hands the question to the Analyst and it answers from what comes back. No ask_human pause, because the TPO is already there in the conversation.",
    tools: ["ask_analyst"],
  },
  {
    id: "analyst",
    label: "Analyst Agent",
    kind: "oneshot",
    color: "#2E467A",
    position: [-2.6, 2.4, -6.2],
    radius: 0.42,
    role: "Turns a plain-English placement-data question into one SQL query, validates it in Python before it runs -- a single SELECT, table allowlist, PII columns blocked, no SELECT *, forced row limit -- executes it read-only, and answers from the rows actually returned.",
  },
];

export const EDGES: Edge[] = [
  { from: "core", to: "shortlist", color: "#0FA968" },
  { from: "core", to: "schedule", color: "#3B5BA6" },
  { from: "shortlist", to: "auditor", color: "#0FA96877" },
  { from: "schedule", to: "panel_agent", color: "#3B5BA677" },
  { from: "onyx_sidebar", to: "analyst", color: "#D9922B77" },
];

export const NODE_MAP: Record<string, AgentNode> = Object.fromEntries(NODES.map((n) => [n.id, n]));
