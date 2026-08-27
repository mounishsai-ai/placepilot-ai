"use client";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mail, Inbox } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { drivesAPI, noticesAPI } from "@/lib/api";
import toast from "react-hot-toast";

/* The pipeline_started/pipeline_error events the TPO sees are auto-generated
   system blips — nobody at the company wrote them. This is the actual
   communication surface: a real, authored note from this HR user straight to
   the placement office, optionally tied to one of their own drives. There's
   one TPO office in this system, not per-user inboxes, so there's no
   recipient to pick — every notice just goes to "the placement office". */

interface Drive {
  id: string;
  title: string;
}

interface SentNotice {
  id: string;
  drive_id: string | null;
  drive_title: string | null;
  subject: string;
  message: string;
  created_at: string;
}

export default function CompanyNotices() {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [sent, setSent] = useState<SentNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [driveId, setDriveId] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [drivesRes, sentRes] = await Promise.all([
        drivesAPI.myCompany(),
        noticesAPI.sent(),
      ]);
      setDrives(drivesRes.data.drives ?? []);
      setSent(sentRes.data);
    } catch {
      toast.error("Failed to load notices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSend = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Add a subject and a message first");
      return;
    }
    setSending(true);
    try {
      await noticesAPI.send({ subject: subject.trim(), message: message.trim(), drive_id: driveId || null });
      toast.success("Sent to the placement office");
      setSubject("");
      setMessage("");
      setDriveId("");
      await load();
    } catch {
      toast.error("Couldn't send that notice — try again");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Compose */}
      <div className="glass-card">
        <div className="flex items-center gap-2 mb-4">
          <Mail size={16} style={{ color: "var(--jade-d)" }} />
          <h2 className="text-base">Send a notice <em>to the placement office</em></h2>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--ash)" }}>
          A real message from you — deadline changes, package updates, anything
          the TPO should know about one of your drives, or in general.
        </p>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            className="input-glass !py-2.5 text-sm"
          />
          <textarea
            placeholder="Message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            rows={4}
            className="input-glass !py-2.5 text-sm resize-none"
          />
          <div className="flex items-center gap-3">
            <select
              value={driveId}
              onChange={(e) => setDriveId(e.target.value)}
              className="text-sm rounded-xl px-3 py-2 outline-none flex-1"
              style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
            >
              <option value="">General — not about a specific drive</option>
              {drives.map((d) => (
                <option key={d.id} value={d.id}>Regarding: {d.title}</option>
              ))}
            </select>
            <button
              onClick={handleSend}
              disabled={sending}
              className="btn-primary flex items-center gap-2 !py-2.5 !px-5 disabled:opacity-50 flex-shrink-0"
            >
              <Send size={14} /> {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>

      {/* Sent history */}
      <div className="glass-card">
        <div className="flex items-center gap-2 mb-4">
          <Inbox size={16} style={{ color: "var(--jade-d)" }} />
          <h2 className="text-base">Your <em>sent notices</em></h2>
          <span className="ml-auto badge-green badge text-[10px]">
            {loading ? "…" : sent.length}
          </span>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "var(--line-2)" }} />)}
          </div>
        ) : sent.length === 0 ? (
          <div className="text-center text-sm py-10" style={{ color: "var(--faint)" }}>
            Nothing sent yet.
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {sent.map((n) => (
                <motion.div
                  key={n.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl p-3"
                  style={{ background: "var(--wash-2)", border: "1px solid var(--line)" }}
                >
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="font-medium text-sm">{n.subject}</span>
                    <span className="ct-mono text-[10px] flex-shrink-0" style={{ color: "var(--faint)" }}>
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-xs mb-1.5" style={{ color: "var(--ash)" }}>{n.message}</p>
                  {n.drive_title && (
                    <div className="ct-mono text-[10px]" style={{ color: "var(--jade-d)" }}>
                      Re: {n.drive_title}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
