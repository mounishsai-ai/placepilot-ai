"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import { useDashboardStore, useNotificationsStore } from "./store";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

// ─── TPO Dashboard WebSocket ───────────────────────────────────────────────
export function useTPOWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { addAgentEvent } = useDashboardStore();
  const reconnectTimer = useRef<NodeJS.Timeout>();
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) return;

    wsRef.current = new WebSocket(`${WS_URL}/ws/dashboard`);

    wsRef.current.onopen = () => {
      console.log("[WS] TPO dashboard connected");
      setConnected(true);
      // heartbeat
      const ping = setInterval(() => wsRef.current?.send("ping"), 25000);
      wsRef.current!.onclose = () => {
        clearInterval(ping);
        setConnected(false);
        // reconnect after 3s
        reconnectTimer.current = setTimeout(connect, 3000);
      };
    };

    wsRef.current.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "agent_event") {
          addAgentEvent({
            event_type: msg.event_type,
            agent_name: msg.agent_name ?? "system",
            drive_id: msg.drive_id,
            payload: msg.payload,
            created_at: new Date().toISOString(),
          });
        }
      } catch {}
    };

    wsRef.current.onerror = () => wsRef.current?.close();
  }, [addAgentEvent]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected };
}

// ─── Student WebSocket ─────────────────────────────────────────────────────
export function useStudentWebSocket(studentId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const { addNotification } = useNotificationsStore();
  const reconnectTimer = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    if (!studentId) return;
    wsRef.current = new WebSocket(`${WS_URL}/ws/student/${studentId}`);

    wsRef.current.onopen = () => {
      console.log(`[WS] Student ${studentId} connected`);
      const ping = setInterval(() => wsRef.current?.send("ping"), 25000);
      wsRef.current!.onclose = () => {
        clearInterval(ping);
        reconnectTimer.current = setTimeout(connect, 3000);
      };
    };

    wsRef.current.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "notification") {
          addNotification({
            id: Math.random().toString(36),
            subject: msg.subject ?? "New notification",
            message: msg.message ?? "",
            status: "delivered",
            read_at: null,
            created_at: new Date().toISOString(),
          });
        }
      } catch {}
    };

    wsRef.current.onerror = () => wsRef.current?.close();
  }, [studentId, addNotification]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
