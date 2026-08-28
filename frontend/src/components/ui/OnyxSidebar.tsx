"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Crown } from "lucide-react";
import AgentOrb from "./AgentOrb";
import { onyxAPI } from "@/lib/api";

/* Onyx, reachable from anywhere in the TPO portal — not scoped to one drive
   or round the way the trace views elsewhere are. Free-text in, a real tool-
   calling turn out: it can query the live database (via the same validated
   SQL path as the Analyst Agent) or dispatch/read a real negotiation, never
   a scripted response. Conversation memory is Vertex's own `contents` list,
   round-tripped with every request — see onyx_chat.py for why that's enough
   without a new DB table. */

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  cost_ms?: number;
}

interface Message {
  role: "user" | "onyx";
  text: string;
  trace?: ToolCall[];
}

const TOOL_LABEL: Record<string, string> = {
  ask_analyst: "queried the database",
  start_negotiation: "dispatched a negotiation",
  get_negotiation_outcome: "read a negotiation's outcome",
};

export default function OnyxSidebar() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const historyRef = useRef<Record<string, unknown>[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setSending(true);
    try {
      const res = await onyxAPI.chat(text, historyRef.current);
      historyRef.current = res.data.contents ?? [];
      setMessages((m) => [...m, { role: "onyx", text: res.data.answer, trace: res.data.trace ?? [] }]);
    } catch {
      setMessages((m) => [...m, { role: "onyx", text: "Something went wrong reaching Onyx — try again." }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <motion.button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-24 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center bg-white"
        style={{ border: "1px solid var(--line)", boxShadow: "0 8px 28px rgba(11,23,20,.16)" }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.96 }}
        aria-label="Ask Onyx"
      >
        <AgentOrb size={34} tone="onyx" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-0 right-0 h-full w-[400px] z-50 bg-white flex flex-col"
            style={{ borderLeft: "1px solid var(--line)", boxShadow: "-8px 0 32px rgba(11,23,20,.10)" }}
          >
            <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: "1px solid var(--line)", background: "var(--wash)" }}>
              <AgentOrb size={28} tone="onyx" />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: "var(--fg)" }}>
                  <Crown size={12} style={{ color: "var(--faint)" }} /> Onyx
                </div>
                <div className="text-[10px]" style={{ color: "var(--faint)" }}>Ask about any drive, schedule, or negotiation</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--wash-2)]"
                aria-label="Close"
              >
                <X size={15} style={{ color: "var(--faint)" }} />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.length === 0 && (
                <p className="text-[12.5px]" style={{ color: "var(--faint)" }}>
                  Try &ldquo;how many students are shortlisted for TCS?&rdquo; or &ldquo;what happened
                  with round &lt;round_id&gt;&rsquo;s negotiation?&rdquo;
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "ml-8" : "mr-4"}>
                  <div
                    className="rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed"
                    style={
                      m.role === "user"
                        ? { background: "var(--jade)", color: "#fff", marginLeft: "auto" }
                        : { background: "var(--wash-2)", color: "var(--fg)", border: "1px solid var(--line)" }
                    }
                  >
                    {m.text}
                  </div>
                  {m.trace && m.trace.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {m.trace.map((t, j) => (
                        <span
                          key={j}
                          className="ct-mono text-[9.5px] px-2 py-1 rounded-full"
                          style={{ background: "var(--wash)", color: "var(--faint)", border: "1px solid var(--line)" }}
                        >
                          {TOOL_LABEL[t.tool] ?? t.tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--faint)" }}>
                  <span className="ct-live-dot" /> Onyx is working…
                </div>
              )}
            </div>

            <div className="p-4" style={{ borderTop: "1px solid var(--line)" }}>
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  disabled={sending}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Ask Onyx anything…"
                  className="input-glass flex-1 !py-2 !text-[13px]"
                />
                <button
                  onClick={send}
                  disabled={sending || !input.trim()}
                  className="btn-primary !py-2 !px-3 disabled:opacity-40"
                  aria-label="Send"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
