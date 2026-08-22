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
    api.post("/api/students/me/resume", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
};

// ─── Analytics ────────────────────────────────────────────────────────────
export const analyticsAPI = {
  dashboard: () => api.get("/api/analytics/dashboard"),
  skillGap: () => api.get("/api/analytics/skill-gap"),
  readiness: () => api.get("/api/analytics/readiness"),
  driveStats: (id: string) => api.get(`/api/analytics/drives/${id}`),
};

// ─── Schedule ─────────────────────────────────────────────────────────────
export const scheduleAPI = {
  createRound: (data: object) => api.post("/api/schedule/rounds", data),
  autoSchedule: (roundId: string) =>
    api.post(`/api/schedule/rounds/${roundId}/auto-schedule`),
  getSlots: (roundId: string) =>
    api.get(`/api/schedule/rounds/${roundId}/slots`),
  updateResult: (slotId: string, data: object) =>
    api.patch(`/api/schedule/slots/${slotId}/result`, data),
};

// ─── Notifications ────────────────────────────────────────────────────────
export const notificationsAPI = {
  getStudentNotifications: (studentId: string, unreadOnly = false) =>
    api.get(`/api/notifications/student/${studentId}`, {
      params: { unread_only: unreadOnly },
    }),
  send: (data: object) => api.post("/api/notifications/send", data),
  markRead: (id: string) => api.patch(`/api/notifications/${id}/read`),
  getOfflineQueue: () => api.get("/api/notifications/offline-queue"),
  retryOffline: () => api.post("/api/notifications/retry-offline"),
};
