import { create } from "zustand";
import { persist } from "zustand/middleware";
import { authAPI } from "./api";

// ─── Types ─────────────────────────────────────────────────────────────────
interface User {
  id: string;
  email: string;
  role: "tpo" | "student" | "company" | "panel";
  is_active: boolean;
}

interface AgentEvent {
  event_type: string;
  agent_name: string;
  drive_id?: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

// ─── Auth Store ────────────────────────────────────────────────────────────
interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: async (email, password) => {
        const { data } = await authAPI.login(email, password);
        localStorage.setItem("access_token", data.access_token);
        const meRes = await authAPI.me();
        const user = meRes.data as User;
        set({ user, token: data.access_token, isAuthenticated: true });
        return user;
      },

      logout: () => {
        localStorage.removeItem("access_token");
        set({ user: null, token: null, isAuthenticated: false });
        window.location.href = "/";
      },

      setUser: (user) => set({ user }),
    }),
    { name: "auth-store", partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }) }
  )
);

// ─── Dashboard Store ───────────────────────────────────────────────────────
interface DashboardState {
  kpis: object | null;
  drives: object[];
  agentEvents: AgentEvent[];
  pendingApprovals: number;
  isLoading: boolean;
  setKpis: (kpis: object) => void;
  setDrives: (drives: object[]) => void;
  addAgentEvent: (event: AgentEvent) => void;
  setLoading: (v: boolean) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  kpis: null,
  drives: [],
  agentEvents: [],
  pendingApprovals: 0,
  isLoading: false,
  setKpis: (kpis) => set({ kpis }),
  setDrives: (drives) => set({ drives }),
  addAgentEvent: (event) =>
    set((s) => ({ agentEvents: [event, ...s.agentEvents].slice(0, 50) })),
  setLoading: (isLoading) => set({ isLoading }),
}));

// ─── Notifications Store ───────────────────────────────────────────────────
interface NotificationItem {
  id: string;
  subject: string;
  message: string;
  status: string;
  read_at: string | null;
  created_at: string;
}

interface NotificationsState {
  notifications: NotificationItem[];
  unreadCount: number;
  setNotifications: (n: NotificationItem[]) => void;
  addNotification: (n: NotificationItem) => void;
  markRead: (id: string) => void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: [],
  unreadCount: 0,
  setNotifications: (notifications) =>
    set({ notifications, unreadCount: notifications.filter((n) => !n.read_at).length }),
  addNotification: (n) =>
    set((s) => ({
      notifications: [n, ...s.notifications],
      unreadCount: s.unreadCount + 1,
    })),
  markRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n
      ),
      unreadCount: Math.max(0, s.unreadCount - 1),
    })),
}));
