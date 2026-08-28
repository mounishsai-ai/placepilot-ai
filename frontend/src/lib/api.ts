import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  timeout: 30000,
});

// Attach JWT on every request
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Global error handler
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      localStorage.removeItem("user");
      window.location.href = "/";
    }
    return Promise.reject(err);
  }
);

export default api;

// ─── Auth ─────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (email: string, password: string) =>
    api.post("/api/auth/login", new URLSearchParams({ username: email, password }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
  register: (data: { email: string; password: string; role: string }) =>
    api.post("/api/auth/register", data),
  me: () => api.get("/api/auth/me"),
};

// ─── Drives ───────────────────────────────────────────────────────────────
export const drivesAPI = {
  list: (status?: string) => api.get("/api/drives/", { params: { status } }),
  get: (id: string) => api.get(`/api/drives/${id}`),
  create: (data: object) => api.post("/api/drives/", data),
  runPipeline: (id: string) => api.post(`/api/drives/${id}/run-pipeline`),
  getShortlist: (id: string) => api.get(`/api/drives/${id}/shortlist`),
  approveShortlist: (id: string, data: object) =>
    api.patch(`/api/drives/${id}/shortlist`, data),
  approveSchedule: (id: string, data: object) =>
    api.patch(`/api/drives/${id}/schedule/approve`, data),
  getEvents: (id: string) => api.get(`/api/drives/${id}/events`),
  archive: (id: string) => api.patch(`/api/drives/${id}/archive`),
  restore: (id: string) => api.patch(`/api/drives/${id}/restore`),
  /** Hard delete — only accepted server-side before a schedule is confirmed. */
  delete: (id: string) => api.delete(`/api/drives/${id}`),
  /** Drives belonging to the signed-in HR user's own company, with pipeline
      progress and the agent's latest step on each. */
  myCompany: () => api.get("/api/drives/mine/company"),
  /** Every company on file — TPO's company picker when creating a drive. */
  listCompanies: () => api.get("/api/drives/companies"),
};

// ─── Agent (orchestrator) ─────────────────────────────────────────────────
// Separate from drivesAPI.runPipeline above — that drives the old hardcoded
// graph. These hit the orchestrator, where the model picks each step itself.
export const agentAPI = {
  start: (driveId: string) => api.post(`/api/drives/${driveId}/run-agent`),
  listRuns: (driveId: string) => api.get(`/api/drives/${driveId}/agent-runs`),
  /** Runs in flight or waiting on a human, across every drive — powers the dock.
      Returns no trace: paused-first ordering is decided server-side. */
  live: () => api.get("/api/drives/agent-runs/live"),
  getRun: (runId: string) => api.get(`/api/drives/agent-runs/${runId}`),
  answer: (runId: string, answer: string) =>
    api.post(`/api/drives/agent-runs/${runId}/answer`, { answer }),
};

// ─── Students ─────────────────────────────────────────────────────────────
export const studentsAPI = {
  list: (params?: object) => api.get("/api/students/", { params }),
  get: (id: string) => api.get(`/api/students/${id}`),
  getMe: () => api.get("/api/students/me"),          // resolves JWT user → Student record
  create: (data: object) => api.post("/api/students/", data),
  update: (id: string, data: object) => api.put(`/api/students/${id}`, data),
  getSchedule: (id: string) => api.get(`/api/students/${id}/schedule`),
  getMatches: (id: string) => api.get(`/api/students/${id}/matches`),
  uploadResume: (form: FormData) =>
    api.post("/api/students/me/resume", form),
  updateMe: (data: object) => api.put("/api/students/me", data),
  getSkillAdvice: () => api.get("/api/students/me/skill-advice"),
};

// ─── Analytics ────────────────────────────────────────────────────────────
export const analyticsAPI = {
  dashboard: () => api.get("/api/analytics/dashboard"),
  skillGap: () => api.get("/api/analytics/skill-gap"),
  readiness: () => api.get("/api/analytics/readiness"),
  driveStats: (id: string) => api.get(`/api/analytics/drives/${id}`),
  exceptions: () => api.get("/api/analytics/exceptions"),
  approveException: (id: string) => api.post(`/api/analytics/exceptions/${id}/approve`),
  auditTrail: () => api.get("/api/analytics/audit-trail"),
  ask: (question: string) => api.post("/api/analytics/ask", { question }),
};

// ─── Notices (HR → TPO) ───────────────────────────────────────────────────
export const noticesAPI = {
  /** TPO side — every company's notices, newest first. */
  list: () => api.get("/api/notices"),
  /** Company side — send a notice to the placement office. */
  send: (data: { subject: string; message: string; drive_id?: string | null }) =>
    api.post("/api/notices", data),
  /** Company side — this company's own sent history. */
  sent: () => api.get("/api/notices/sent"),
};

// ─── Schedule ─────────────────────────────────────────────────────────────
export const scheduleAPI = {
  createRound: (data: object) => api.post("/api/schedule/rounds", data),
  /** Starts the scheduling agent (propose → validate → re-plan → commit) in
      the background — same orchestrator/trace infra as agentAPI, keyed off
      the same drive_id, so the existing agent dock picks it up automatically. */
  runAgent: (roundId: string) =>
    api.post(`/api/schedule/rounds/${roundId}/run-agent`),
  getSlots: (roundId: string) =>
    api.get(`/api/schedule/rounds/${roundId}/slots`),
  updateResult: (slotId: string, data: object) =>
    api.patch(`/api/schedule/slots/${slotId}/result`, data),
  listRounds: (driveId: string) => api.get(`/api/schedule/drives/${driveId}/rounds`),
  listSlots: (driveId?: string) =>
    api.get("/api/schedule/slots", { params: driveId ? { drive_id: driveId } : {} }),
  getMySlots: () => api.get("/api/schedule/slots/mine"),
  /** What the panel should know before meeting this candidate. Generated on
      demand — most scheduled slots are never opened. */
  prepBrief: (slotId: string) => api.post(`/api/schedule/slots/${slotId}/prep`),
  /** Rough post-interview notes → a structured scorecard. Does not file the
      result; that stays an explicit act via updateResult. */
  debrief: (slotId: string, notes: string) =>
    api.post(`/api/schedule/slots/${slotId}/debrief`, { notes }),
  /** Notes on the day as a whole -- not tied to one candidate's slot. */
  addSessionNote: (notes: string) =>
    api.post("/api/schedule/session-notes", { notes }),
  getSessionNotes: () => api.get("/api/schedule/session-notes"),
  /** TPO side -- every panel member's session notes. */
  getAllSessionNotes: () => api.get("/api/schedule/session-notes/all"),

  /** Starts the two-agent negotiation (TPO agent vs the company's own agent)
      for a round — discussion only, never writes a slot itself. */
  negotiate: (roundId: string) => api.post(`/api/schedule/rounds/${roundId}/negotiate`),
  /** Latest negotiation run for a round, full trace — both portals poll this. */
  getNegotiation: (roundId: string) => api.get(`/api/schedule/rounds/${roundId}/negotiation`),
  /** The one action a human takes: write the negotiated proposal as real slots. */
  commitNegotiation: (runId: string) => api.post(`/api/schedule/negotiations/${runId}/commit`),

  /** Dispatches Onyx, the supervisor agent — its tools start/read the same
      negotiation above rather than touching the schedule directly, then it
      reports to the TPO. Answer its report via agentAPI.answer(runId, ...). */
  askOnyx: (roundId: string) => api.post(`/api/schedule/rounds/${roundId}/ask-onyx`),
  /** Latest Onyx run for a round, full trace — same shape as getNegotiation. */
  getOnyx: (roundId: string) => api.get(`/api/schedule/rounds/${roundId}/onyx`),
};

// ─── Onyx sidebar ─────────────────────────────────────────────────────────
// Free-text, reachable from anywhere in the TPO portal — separate from the
// per-round agentAPI/scheduleAPI runs above, which are all scoped to one
// drive or round. `history` is Vertex's own `contents` list from the
// previous response, round-tripped so the chat has real memory.
export const onyxAPI = {
  // A turn can chain 2-4 sequential Vertex calls (Onyx's own turn, plus
  // ask_analyst's own SQL-generation + summary calls), sometimes with a
  // 429 retry backoff on top -- the global 30s default clips this in
  // practice even though the backend finishes fine a few seconds later.
  chat: (message: string, history: Record<string, unknown>[]) =>
    api.post("/api/onyx/chat", { message, history }, { timeout: 75000 }),
};

// ─── Notifications ────────────────────────────────────────────────────────
export const notificationsAPI = {
  getStudentNotifications: (studentId: string, unreadOnly = false) =>
    api.get(`/api/notifications/student/${studentId}`, {
      params: { unread_only: unreadOnly },
    }),
  send: (data: object) => api.post("/api/notifications/send", data),
  markRead: (id: string) => api.patch(`/api/notifications/${id}/read`),
  /** Every notification ever sent, across all students — the TPO history view. */
  listAll: () => api.get("/api/notifications"),
  getOfflineQueue: () => api.get("/api/notifications/offline-queue"),
  retryOffline: () => api.post("/api/notifications/retry-offline"),
};
