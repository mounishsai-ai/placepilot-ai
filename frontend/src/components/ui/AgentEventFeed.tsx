"use client";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";

interface AgentEvent {
  event_type: string;
  agent_name?: string;
  drive_id?: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

const AGENT_COLORS: Record<string, { dot: string; label: string; badge: string }> = {
  jd_analyst:        { dot: "bg-blue-400",    label: "JD Analyst",   badge: "badge-blue"   },
  eligibility_agent: { dot: "bg-amber-400",   label: "Eligibility",  badge: "badge-amber"  },
  matcher_agent:     { dot: "bg-purple-400",  label: "Matcher",      badge: "badge-purple" },
  scheduler_agent:   { dot: "bg-cyan-400",    label: "Scheduler",    badge: "badge-cyan"   },
  notifier_agent:    { dot: "bg-emerald-400", label: "Notifier",     badge: "badge-green"  },
  human_tpo:         { dot: "bg-rose-400",    label: "TPO",          badge: "badge-rose"   },
  system:            { dot: "bg-white/40",    label: "System",       badge: "badge-gray"   },
};

const EVENT_LABELS: Record<string, string> = {
  jd_analyzed:          "JD parsed & structured",
  eligibility_checked:  "Eligibility check done",
  matching_complete:    "Candidates ranked",
  schedule_created:     "Schedule generated",
  notifications_queued: "Notifications queued",
  shortlist_approved:   "Shortlist approved by TPO",
  shortlist_rejected:   "Shortlist sent back",
  schedule_approved:    "Schedule confirmed by TPO",
};

interface Props {
  events: AgentEvent[];
}

export default function AgentEventFeed({ events }: Props) {
  return (
    <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto pr-1">
      <AnimatePresence initial={false}>
        {events.length === 0 && (
          <div className="text-center text-white/30 text-sm py-12">
            <div className="text-3xl mb-2">🤖</div>
            No agent activity yet. Run a pipeline to see live updates.
          </div>
        )}
        {events.map((evt, i) => {
          const cfg = AGENT_COLORS[evt.agent_name ?? "system"] ?? AGENT_COLORS.system;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="agent-event"
            >
              <span className={`agent-pulse ${cfg.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`badge text-[10px] ${cfg.badge}`}>{cfg.label}</span>
                  <span className="text-white/70 text-xs truncate">
                    {EVENT_LABELS[evt.event_type] ?? evt.event_type.replace(/_/g, " ")}
                  </span>
                </div>
                {evt.payload && Object.keys(evt.payload).length > 0 && (
                  <div className="text-white/35 text-[11px] mt-0.5 font-mono">
                    {Object.entries(evt.payload)
                      .slice(0, 3)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </div>
                )}
              </div>
              <span className="text-white/25 text-[10px] whitespace-nowrap flex-shrink-0">
                {formatDistanceToNow(new Date(evt.created_at), { addSuffix: true })}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
