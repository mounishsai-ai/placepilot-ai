"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Bell, Send, RefreshCw, Clock, CheckCircle, AlertTriangle, Inbox, Archive, ArchiveRestore, ChevronDown, ChevronUp } from "lucide-react";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import { notificationsAPI, studentsAPI } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";

interface NotificationItem {
  id: string;
  student_id?: string;
  student_name?: string;
  recipient_count?: number;
  channel: string;
  subject: string;
  message: string;
  status: string;
  read_at?: string;
  created_at: string;
  extra_data?: Record<string, unknown>;
}

const CHANNEL_ICON: Record<string, string> = {
  email: "📧",
  sms: "📱",
  whatsapp: "💬",
  offline: "📥",
};

// "queued"/"pending"/"offline_queued" are all the same thing to a TPO reading
// this list: it hasn't landed yet. One word for that state — "Sending" — not
// three, and never the raw status string.
const SENDING_STATUSES = new Set(["queued", "pending", "offline_queued"]);
function displayStatus(status: string): { label: string; badge: string } {
  if (status === "sent" || status === "delivered") return { label: "Sent", badge: "badge-green" };
  if (status === "failed") return { label: "Failed", badge: "badge-rose" };
  return { label: "Sending", badge: "badge-amber" };
}

const ARCHIVE_KEY = "tpo-notifications-archived";

function loadArchived(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export default function NotificationsPage() {
  const [queue, setQueue] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { setArchived(loadArchived()); }, []);

  const toggleArchive = (id: string) => {
    setArchived((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };
  const [sending, setSending] = useState(false);

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState("email");

  const fetchQueue = useCallback(async () => {
    try {
      // The full history — not /offline-queue, which only ever holds the
      // retry backlog and made "Sent" permanently read 0 here.
      const res = await notificationsAPI.listAll();
      setQueue(Array.isArray(res.data) ? res.data : []);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await notificationsAPI.retryOffline();
      toast.success("Retried offline notifications");
      fetchQueue();
    } catch {
      toast.error("Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  const handleSend = async () => {
    if (!subject || !message) {
      toast.error("Subject and message are required");
      return;
    }
    setSending(true);
    try {
      const studentsRes = await studentsAPI.list();
      const studentIds = (studentsRes.data as { id: string }[]).map((s) => s.id);
      if (studentIds.length === 0) {
        toast.error("No students found to notify");
        return;
      }
      await notificationsAPI.send({
        student_ids: studentIds,
        template_id: "custom",
        data: { subject, body: message },
        channels: [channel],
      });
      toast.success(`✉️ Notification queued for ${studentIds.length} students`);
      setComposeOpen(false);
      setSubject("");
      setMessage("");
      fetchQueue();
    } catch {
      toast.error("Failed to send notification");
    } finally {
      setSending(false);
    }
  };

  const stats = {
    total: queue.length,
    sent: queue.filter((n) => n.status === "sent" || n.status === "delivered").length,
    failed: queue.filter((n) => n.status === "failed").length,
    sending: queue.filter((n) => SENDING_STATUSES.has(n.status)).length,
  };

  return (
    <div className="min-h-screen bg-cosmic flex">
      <TPOSidebar />
      <div className="ml-64 flex-1 flex flex-col">
        <TopBar title="Notifications" subtitle="Manage student communications" />

        <main className="p-8 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            {/* "Sending" was amber; a message in flight is normal, not a
                person being asked for something, so it drops to plain ink.
                "Failed" keeps rose — that one really is a problem. */}
            {[
              { label: "Total",   value: stats.total,   icon: Inbox,         fg: "var(--fg)",     tint: "rgba(11,23,20,.05)"   },
              { label: "Sent",    value: stats.sent,    icon: CheckCircle,   fg: "var(--jade-d)", tint: "rgba(15,169,104,.10)" },
              { label: "Sending", value: stats.sending, icon: Clock,         fg: "var(--fg)",     tint: "rgba(11,23,20,.05)"   },
              { label: "Failed",  value: stats.failed,  icon: AlertTriangle, fg: "var(--rose)",   tint: "rgba(194,69,63,.09)"  },
            ].map((stat) => (
              <div key={stat.label} className="stat-gloss flex items-center gap-3 py-4 px-5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: stat.tint, color: stat.fg }}
                >
                  <stat.icon size={18} />
                </div>
                <div>
                  <div className="font-display text-2xl font-bold leading-none" style={{ color: stat.fg }}>
                    {stat.value}
                  </div>
                  <div className="text-[11.5px] mt-1.5" style={{ color: "var(--ash)" }}>{stat.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setComposeOpen(!composeOpen)}
              className="btn-primary flex items-center gap-2"
            >
              <Send size={15} /> Compose Notification
            </button>
            <button
              onClick={handleRetry}
              disabled={retrying || stats.failed === 0}
              className="btn-ghost flex items-center gap-2"
            >
              <RefreshCw size={15} className={retrying ? "animate-spin" : ""} />
              Retry Failed ({stats.failed})
            </button>
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="btn-ghost flex items-center gap-2"
            >
              {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              {showArchived ? "Back to active" : `Archived (${archived.size})`}
            </button>
            <button onClick={fetchQueue} className="btn-ghost ml-auto flex items-center gap-2">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {/* Compose panel */}
          {composeOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card border border-blue-500/20"
            >
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Bell size={16} className="text-blue-400" /> Compose Notification
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-white/40 text-xs mb-1.5 block">Channel</label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none"
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </div>
                <div>
                  <label className="text-white/40 text-xs mb-1.5 block">Recipients</label>
                  <div className="w-full bg-white/[0.03] border border-white/10 text-white/60 text-sm rounded-xl px-3 py-2">
                    All students
                  </div>
                </div>
              </div>
              <div className="mb-4">
                <label className="text-white/40 text-xs mb-1.5 block">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Interview invitation for TCS Digital Drive..."
                  className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-white/20"
                />
              </div>
              <div className="mb-4">
                <label className="text-white/40 text-xs mb-1.5 block">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder="Dear student, you have been shortlisted for..."
                  className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-white/20 resize-none"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setComposeOpen(false)} className="btn-ghost">Cancel</button>
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="btn-primary flex items-center gap-2"
                >
                  {sending ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : <Send size={14} />}
                  Send
                </button>
              </div>
            </motion.div>
          )}

          {/* Notification list */}
          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="glass-card h-16 animate-pulse" />
              ))
            ) : (() => {
              const visible = queue.filter((n) => showArchived ? archived.has(n.id) : !archived.has(n.id));
              if (visible.length === 0) {
                return (
                  <div className="glass-card text-center py-16">
                    <Bell size={40} className="text-white/10 mx-auto mb-3" />
                    <p className="text-white/40">
                      {showArchived ? "Nothing archived" : "No notifications in queue"}
                    </p>
                    {!showArchived && (
                      <p className="text-white/20 text-sm mt-1">Send a notification above to see it here</p>
                    )}
                  </div>
                );
              }
              return visible.map((n, i) => {
                const expanded = expandedId === n.id;
                return (
                  <motion.div
                    key={n.id ?? i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i, 20) * 0.03 }}
                    className="glass-card flex items-start gap-4"
                  >
                    <span className="text-2xl flex-shrink-0">{CHANNEL_ICON[n.channel] ?? "📌"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-white font-medium text-sm truncate">{n.subject || "(no subject)"}</span>
                        <span className={`badge text-[10px] ${displayStatus(n.status).badge}`}>
                          {displayStatus(n.status).label}
                        </span>
                        {n.student_name && (
                          <span className="text-white/30 text-[10px] truncate">to {n.student_name}</span>
                        )}
                        {(n.recipient_count ?? 1) > 1 && (
                          <span className="text-white/30 text-[10px] truncate">sent to all students ({n.recipient_count})</span>
                        )}
                      </div>
                      <p className={`text-white/40 text-xs ${expanded ? "" : "line-clamp-1"}`}>{n.message}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-white/25 text-[11px] whitespace-nowrap mr-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </span>
                      <button
                        onClick={() => setExpandedId(expanded ? null : n.id)}
                        title={expanded ? "Collapse" : "View full message"}
                        className="text-white/25 hover:text-white/70 transition-colors p-1.5 rounded-lg hover:bg-white/[0.06]"
                      >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <button
                        onClick={() => toggleArchive(n.id)}
                        title={showArchived ? "Restore" : "Archive"}
                        className="text-white/25 hover:text-white/70 transition-colors p-1.5 rounded-lg hover:bg-white/[0.06]"
                      >
                        {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                      </button>
                    </div>
                  </motion.div>
                );
              });
            })()}
          </div>
        </main>
      </div>
    </div>
  );
}
