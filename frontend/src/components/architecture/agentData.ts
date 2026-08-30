/* The real architecture, hand-placed in 3D space -- deterministic coordinates,
   not a runtime force-simulation. A physics layout looks impressive until it
   settles on an unreadable tangle; fixed positions we chose stay legible and
   never NaN out. Every tool name and role description here matches the actual
   backend registries (tools.py / schedule_tools.py / negotiation_tools.py /
   onyx_tools.py / onyx_chat.py / analyst_agent.py / panel_agent.py). */

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
      "One Gemini function-calling loop, reused by every loop-based agent below. Which agent it becomes is decided entirely by which profile -- a system prompt plus a tool list -- gets passed in. Adding a new agent means adding one dictionary entry, not new engine code.",
  },

  // ── Ring 1: the four loop-based agent profiles ──────────────────────────
  {
    id: "shortlist",
    label: "Shortlist Agent",
    kind: "loop",
    color: "#0FA968",
    position: [4.4, 0.3, 0],
    radius: 0.55,
    role: "Takes one placement drive from a raw job description to a ranked, human-approved shortlist.",
    tools: ["get_drive_context", "parse_jd", "check_eligibility", "rank_candidates", "select_candidates", "ask_human"],
  },
  {
    id: "schedule",
    label: "Schedule Agent",
    kind: "loop",
    color: "#3B5BA6",
    position: [0, 0.3, 4.4],
    radius: 0.55,
    role: "Builds a conflict-free interview schedule inside a fixed time window and commits it once clean.",
    tools: ["get_schedule_context", "propose_schedule", "validate_schedule", "commit_schedule", "ask_human"],
  },
  {
    id: "negotiation",
    label: "Scheduling Agent (negotiation)",
    kind: "loop",
    color: "#7C5CBF",
    position: [-4.4, 0.3, 0],
    radius: 0.55,
    role: "Proposes a schedule on the TPO's behalf and negotiates with the company's own agent. commit_schedule is deliberately not in its tool list -- that omission is the entire isolation guarantee.",
    tools: ["get_schedule_context", "propose_schedule", "validate_schedule", "ask_human"],
  },
  {
    id: "onyx",
    label: "Onyx",
    kind: "loop",
    color: "#D9922B",
    position: [0, 1.6, -4.4],
    radius: 0.7,
    role: "The supervisor. Its tools are other agents, not the database -- it dispatches a negotiation, reads back what actually happened, and reports to the TPO in plain English.",
    tools: ["start_negotiation", "get_negotiation_outcome", "ask_human"],
  },

  // ── Ring 2: one-shot specialists, each tied to a loop agent ─────────────
  {
    id: "auditor",
    label: "Auditor",
    kind: "oneshot",
    color: "#34D89A",
    position: [7.6, 1.4, 2.2],
    radius: 0.4,
    role: "An independent second model call that fact-checks the shortlist's real numbers -- not the orchestrator's narration of them -- right before a human is asked to approve.",
  },
  {
    id: "company_agent",
    label: "Company Agent",
    kind: "oneshot",
    color: "#9B7CD9",
    position: [-7.6, -1.0, 2.4],
    radius: 0.4,
    role: "Represents the hiring company. Reviews a proposed schedule against real panel signals -- interviews already booked, stated availability -- and accepts or objects with a named reason.",
  },
  {
    id: "onyx_sidebar",
    label: "Onyx Sidebar",
    kind: "oneshot",
    color: "#F0C674",
    position: [3.0, 3.4, -5.6],
    radius: 0.42,
    role: "The same supervisor, reachable as free-text chat from anywhere in the TPO portal -- no ask_human pause, since the TPO is already there live in the conversation.",
  },
  {
    id: "analyst",
    label: "Analyst Agent",
    kind: "oneshot",
    color: "#2E467A",
    position: [-3.4, 2.6, -6.4],
    radius: 0.4,
    role: "Turns a plain-English placement-data question into one validated, read-only SQL query, runs it, and answers from the real returned rows.",
  },
  {
    id: "panel_agent",
    label: "Panel Agent",
    kind: "oneshot",
    color: "#5A665F",
    position: [1.2, -2.2, 5.8],
    radius: 0.4,
    role: "Three focused, one-shot jobs around an interview slot: brief the panelist beforehand, structure their debrief afterward, and clean up voice-dictated session notes.",
  },
];

export const EDGES: Edge[] = [
  { from: "core", to: "shortlist", color: "#0FA968" },
  { from: "core", to: "schedule", color: "#3B5BA6" },
  { from: "core", to: "negotiation", color: "#7C5CBF" },
  { from: "core", to: "onyx", color: "#D9922B" },
  { from: "shortlist", to: "auditor", color: "#0FA96877" },
  { from: "negotiation", to: "company_agent", color: "#7C5CBF77" },
  { from: "onyx", to: "onyx_sidebar", color: "#D9922B77" },
  { from: "onyx", to: "negotiation", color: "#D9922B55" },
  { from: "onyx_sidebar", to: "analyst", color: "#D9922B55" },
  { from: "schedule", to: "panel_agent", color: "#3B5BA677" },
];

export const NODE_MAP: Record<string, AgentNode> = Object.fromEntries(NODES.map((n) => [n.id, n]));
