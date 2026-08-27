"use client";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, AlertCircle, MessageSquareQuote, Loader2,
  CheckCircle, Pause, XCircle, FileCheck2,
} from "lucide-react";
import AgentOrb from "@/components/ui/AgentOrb";
import { scheduleAPI } from "@/lib/api";
import toast from "react-hot-toast";

/* The two places an interviewer's day has dead time in it.

   Before: you get a candidate you've never seen, five minutes before they walk
   in. After: the verdict exists as three lines of shorthand and never becomes
   structured data.

   Both tabs are deliberately *advisory*. The prep brief says what to ask, not
   what to conclude; the debrief organises what the interviewer said without
   forming its own opinion, and filing the result stays a separate, explicit
   click. An agent that recorded hiring decisions off a paragraph of notes
   would be a different and much worse product. */

export interface PanelSlot {
  id: string;
  student_name: string | null;
  student_roll: string | null;
  branch: string | null;
  cgpa: number | null;
  match_score: number | null;
  slot_start: string;
  slot_end: string;
  room: string | null;
  round_type: string | null;
  status: string;
  result: string | null;
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function SlotPicker({
  slots, value, onChange, emptyLabel,
}: {
  slots: PanelSlot[];
  value: string | null;
  onChange: (id: string) => void;
  emptyLabel: string;
}) {
  if (slots.length === 0) {
    return (
      <p className="text-[13px] py-8 text-center" style={{ color: "var(--ash)" }}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <div className="flex gap-2 flex-wrap">
      {slots.map((s) => {
        const on = s.id === value;
        return (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            className="px-3.5 py-2 rounded-xl text-left transition-all"
            style={{
              background: on ? "var(--wash)" : "var(--card)",
              border: `1px solid ${on ? "#CBEDDD" : "var(--line)"}`,
              boxShadow: on ? "0 2px 10px rgba(15,169,104,.12)" : "none",
            }}
          >
            <div className="text-[13px] font-semibold" style={{ color: on ? "var(--jade-d)" : "var(--fg)" }}>
              {s.student_name ?? "Candidate"}
            </div>
            <div className="ct-mono text-[10px] mt-0.5" style={{ color: "var(--faint)" }}>
              {timeOf(s.slot_start)} · {s.branch ?? "—"} · {s.room ?? "—"}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Tab: prep brief ────────────────────────────────────────────────────────

interface Brief {
  headline?: string;
  strengths?: string[];
  probe?: string[];
  questions?: { q: string; why: string }[];
  degraded?: boolean;
}

export function PrepTab({ slots }: { slots: PanelSlot[] }) {
  // Only interviews that haven't happened yet — briefing someone you already
  // met is noise.
  const pending = useMemo(() => slots.filter((s) => s.result === null), [slots]);
  const [slotId, setSlotId] = useState<string | null>(pending[0]?.id ?? null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const slot = pending.find((s) => s.id === slotId) ?? null;

  const run = async () => {
    if (!slotId || loading) return;
    setLoading(true);
    setBrief(null);
    try {
      const r = await scheduleAPI.prepBrief(slotId);
      setBrief(r.data.brief ?? null);
      setRole(r.data.role ?? null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "The agent couldn't write a brief for this candidate");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="glass-card">
        <h2 className="font-display font-bold text-[15px] mb-1" style={{ color: "var(--fg)" }}>
          Who are you seeing next?
        </h2>
        <p className="text-[12px] mb-4" style={{ color: "var(--ash)" }}>
          The agent reads their profile against this drive&apos;s job description and writes what&apos;s worth asking.
        </p>
        <SlotPicker
          slots={pending}
          value={slotId}
          onChange={(id) => { setSlotId(id); setBrief(null); }}
          emptyLabel="Nothing left on your schedule — every interview is recorded."
        />
        {pending.length > 0 && (
          <button
            onClick={run}
            disabled={!slotId || loading}
            className="btn-primary mt-4 inline-flex items-center gap-2 disabled:opacity-40"
          >
            {loading
              ? <><Loader2 size={15} className="animate-spin" /> Reading their profile…</>
              : <><Sparkles size={15} /> Brief me on {slot?.student_name ?? "this candidate"}</>}
          </button>
        )}
      </div>

      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass-card flex items-center gap-3"
          >
            <AgentOrb size={30} />
            <div className="text-[13px]" style={{ color: "var(--ash)" }}>
              Matching {slot?.student_name ?? "the candidate"} against the job description…
            </div>
          </motion.div>
        )}

        {brief && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="glass-card space-y-5"
          >
            <div className="flex items-start gap-3">
              <AgentOrb size={30} still />
              <div className="min-w-0">
                <div className="text-[15px] leading-snug font-medium" style={{ color: "var(--fg)" }}>
                  {brief.headline}
                </div>
                {role && (
                  <div className="text-[11.5px] mt-1" style={{ color: "var(--faint)" }}>
                    interviewing for <span style={{ color: "var(--jade-d)" }}>{role}</span>
                  </div>
                )}
              </div>
            </div>

            {brief.degraded && (
              <p className="text-[12px]" style={{ color: "var(--rose)" }}>
                Interview from the profile directly — the briefing didn&apos;t generate.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              {(brief.strengths ?? []).length > 0 && (
                <section>
                  <h3 className="text-[11px] uppercase tracking-wider mb-2.5" style={{ color: "var(--faint)" }}>
                    Strong on
                  </h3>
                  <ul className="space-y-1.5">
                    {brief.strengths!.map((s, i) => (
                      <li key={i} className="text-[13px] flex gap-2 leading-relaxed" style={{ color: "var(--fg)" }}>
                        <span style={{ color: "var(--jade)" }}>·</span>{s}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {(brief.probe ?? []).length > 0 && (
                <section>
                  <h3 className="text-[11px] uppercase tracking-wider mb-2.5 flex items-center gap-1.5" style={{ color: "var(--faint)" }}>
                    <AlertCircle size={12} /> Worth probing
                  </h3>
                  <ul className="space-y-1.5">
                    {brief.probe!.map((s, i) => (
                      <li key={i} className="text-[13px] flex gap-2 leading-relaxed" style={{ color: "var(--fg)" }}>
                        <span style={{ color: "var(--rose)" }}>·</span>{s}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {(brief.questions ?? []).length > 0 && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: "var(--faint)" }}>
                  <MessageSquareQuote size={12} /> Ask about
                </h3>
                <div className="space-y-2.5">
                  {brief.questions!.map((q, i) => (
                    <div key={i} className="stat-gloss px-4 py-3">
                      <div className="text-[13.5px] font-medium leading-snug" style={{ color: "var(--fg)" }}>
                        {i + 1}. {q.q}
                      </div>
                      <div className="text-[11.5px] mt-1.5" style={{ color: "var(--ash)" }}>
                        {q.why}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Tab: debrief ───────────────────────────────────────────────────────────

interface Scorecard {
  summary?: string;
  ratings?: { competency: string; score: number; basis: string }[];
  recommendation?: string;
  confidence?: string;
  unclear?: string[];
  degraded?: boolean;
}

const REC_STYLE: Record<string, { label: string; fg: string; bg: string; bd: string; icon: React.ReactNode }> = {
  selected: { label: "Hire", fg: "var(--jade-d)", bg: "var(--wash)", bd: "#CBEDDD", icon: <CheckCircle size={14} /> },
  on_hold:  { label: "Hold", fg: "var(--fg)",     bg: "var(--wash-2)", bd: "var(--line)", icon: <Pause size={14} /> },
  rejected: { label: "Pass", fg: "var(--rose)",   bg: "var(--rose-lt)", bd: "#F3D6D4", icon: <XCircle size={14} /> },
};

export function DebriefTab({
  slots, onFiled,
}: {
  slots: PanelSlot[];
  onFiled: (slotId: string, result: string) => void;
}) {
  const open = useMemo(() => slots.filter((s) => s.result === null), [slots]);
  const [slotId, setSlotId] = useState<string | null>(open[0]?.id ?? null);
  const [notes, setNotes] = useState("");
  const [card, setCard] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(false);
  const [filing, setFiling] = useState(false);

  const slot = open.find((s) => s.id === slotId) ?? null;

  const run = async () => {
    if (!slotId || notes.trim().length < 15 || loading) return;
    setLoading(true);
    setCard(null);
    try {
      const r = await scheduleAPI.debrief(slotId, notes.trim());
      setCard(r.data.scorecard ?? null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Couldn't structure those notes");
    } finally {
      setLoading(false);
    }
  };

  /* Filing is separate from generating on purpose: the scorecard is a draft
     until a person looks at it and agrees. The original notes go along as the
     feedback, so the record keeps the interviewer's own words. */
  const file = async () => {
    if (!slotId || !card?.recommendation || filing) return;
    setFiling(true);
    try {
      await scheduleAPI.updateResult(slotId, {
        result: card.recommendation,
        feedback: notes.trim(),
      });
      onFiled(slotId, card.recommendation);
      toast.success("Filed against the interview");
      setCard(null);
      setNotes("");
    } catch {
      toast.error("Couldn't file the result");
    } finally {
      setFiling(false);
    }
  };

  const rec = card?.recommendation ? REC_STYLE[card.recommendation] : null;

  return (
    <div className="space-y-5">
      <div className="glass-card">
        <h2 className="font-display font-bold text-[15px] mb-1" style={{ color: "var(--fg)" }}>
          Just finished one?
        </h2>
        <p className="text-[12px] mb-4" style={{ color: "var(--ash)" }}>
          Type it however you&apos;d say it out loud. The agent organises what you wrote — it doesn&apos;t add an opinion of its own.
        </p>
        <SlotPicker
          slots={open}
          value={slotId}
          onChange={(id) => { setSlotId(id); setCard(null); }}
          emptyLabel="Every interview on your schedule already has a result recorded."
        />
        {open.length > 0 && (
          <>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder={`e.g. good on sql, fumbled the join question. nice attitude, asked smart things about the team. would hire for backend, not data.`}
              className="input-glass w-full mt-4 !text-[13px] resize-none"
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={run}
                disabled={!slotId || notes.trim().length < 15 || loading}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-40"
              >
                {loading
                  ? <><Loader2 size={15} className="animate-spin" /> Structuring…</>
                  : <><Sparkles size={15} /> Turn into a scorecard</>}
              </button>
              {notes.trim().length > 0 && notes.trim().length < 15 && (
                <span className="text-[11.5px]" style={{ color: "var(--faint)" }}>
                  A little more to go on, first.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {card && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="glass-card space-y-5"
          >
            <div className="flex items-start gap-3">
              <AgentOrb size={30} still />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] leading-relaxed" style={{ color: "var(--fg)" }}>
                  {card.summary}
                </div>
                <div className="text-[11px] mt-1.5" style={{ color: "var(--faint)" }}>
                  {slot?.student_name} · confidence{" "}
                  <span style={{ color: card.confidence === "low" ? "var(--rose)" : "var(--jade-d)" }}>
                    {card.confidence}
                  </span>
                </div>
              </div>
              {rec && (
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold shrink-0"
                  style={{ color: rec.fg, background: rec.bg, border: `1px solid ${rec.bd}` }}
                >
                  {rec.icon} {rec.label}
                </span>
              )}
            </div>

            {(card.ratings ?? []).length > 0 && (
              <div className="space-y-3">
                {card.ratings!.map((r, i) => (
                  <div key={i}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-[13px] font-medium" style={{ color: "var(--fg)" }}>
                        {r.competency}
                      </span>
                      <span className="ct-mono text-[11px]" style={{ color: "var(--ash)" }}>
                        {r.score}/10
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line-2)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(0, Math.min(10, r.score)) * 10}%`,
                          background: "linear-gradient(90deg,var(--jade-d),var(--spring))",
                        }}
                      />
                    </div>
                    {/* Every rating has to point back at the interviewer's own
                        words, or the scorecard is just the model's opinion. */}
                    <div className="text-[11.5px] mt-1.5 italic" style={{ color: "var(--faint)" }}>
                      “{r.basis}”
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(card.unclear ?? []).length > 0 && (
              <section
                className="rounded-xl px-4 py-3"
                style={{ background: "var(--gold-lt)", border: "1px solid var(--gold-ln)" }}
              >
                <h3 className="text-[11px] uppercase tracking-wider mb-1.5" style={{ color: "var(--gold-d)" }}>
                  The agent wants you to confirm
                </h3>
                <ul className="space-y-1">
                  {card.unclear!.map((u, i) => (
                    <li key={i} className="text-[12.5px]" style={{ color: "#7A5210" }}>{u}</li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={file}
                disabled={filing}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-40"
              >
                <FileCheck2 size={15} /> {filing ? "Filing…" : `File as ${rec?.label ?? "result"}`}
              </button>
              <button
                onClick={run}
                className="text-[12.5px] font-semibold"
                style={{ color: "var(--jade-d)" }}
              >
                Not right — redo it
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
