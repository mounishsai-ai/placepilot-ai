"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Bell, Send, RefreshCw, Clock, CheckCircle, AlertTriangle, Inbox } from "lucide-react";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import { notificationsAPI } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";

interface NotificationItem {
  id: string;
  student_id?: string;
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

const STATUS_BADGE: Record<string, string> = {
  sent: "badge-green",
  failed: "badge-rose",
  queued: "badge-amber",
  pending: "badge-amber",
};

export default function NotificationsPage() {
  const [queue, setQueue] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [sending, setSending] = useState(false);

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState("email");
  const [target, setTarget] = useState("all");

  const fetchQueue = useCallback(async () => {
    try {
      const res = await notificationsAPI.getOfflineQueue();
      setQueue(res.data);
    } catch {
      // offline queue might be empty
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
      await notificationsAPI.send({
        channel,
        subject,
        message,
        recipient_type: target,
      });
      toast.success(`✉️ Notification queued for ${target}`);
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
    sent: queue.filter((n) => n.status === "sent").length,
    failed: queue.filter((n) => n.status === "failed").length,
    queued: queue.filter((n) => ["queued", "pending"].includes(n.status)).length,
  };

  return (
    <div className="min-h-screen bg-cosmic flex">
      <TPOSidebar />
      <div className="flex-1 flex flex-col">
        <TopBar title="Notifications" subtitle="Manage student communications" />

        <main className="p-8 max-w-5xl mx-auto w-full space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total",   value: stats.total,  icon: Inbox,         color: "text-white" },
              { label: "Sent",    value: stats.sent,   icon: CheckCircle,   color: "text-emerald-400" },
              { label: "Queued",  value: stats.queued, icon: Clock,         color: "text-amber-400" },
              { label: "Failed",  value: stats.failed, icon: AlertTriangle, color: "text-rose-400" },
            ].map((stat) => (
              <div key={stat.label} className="glass-card flex items-center gap-3 py-4">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center">
                  <stat.icon size={18} className={stat.color} />
                </div>
                <div>
                  <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-white/35 text-xs">{stat.label}</div>
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
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none"
                  >
                    <option value="all">All Students</option>
                    <option value="shortlisted">Shortlisted Only</option>
                    <option value="eligible">Eligible Only</option>
                  </select>
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
            ) : queue.length === 0 ? (
              <div className="glass-card text-center py-16">
                <Bell size={40} className="text-white/10 mx-auto mb-3" />
                <p className="text-white/40">No notifications in queue</p>
                <p className="text-white/20 text-sm mt-1">Send a notification above to see it here</p>
              </div>
            ) : (
              queue.map((n, i) => (
                <motion.div
                  key={n.id ?? i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="glass-card flex items-start gap-4"
                >
                  <span className="text-2xl flex-shrink-0">{CHANNEL_ICON[n.channel] ?? "📌"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-white font-medium text-sm truncate">{n.subject}</span>
                      <span className={`badge text-[10px] ${STATUS_BADGE[n.status] ?? "badge-gray"}`}>
                        {n.status}
                      </span>
                    </div>
                    <p className="text-white/40 text-xs line-clamp-1">{n.message}</p>
                  </div>
                  <div className="text-white/25 text-[11px] whitespace-nowrap flex-shrink-0">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
