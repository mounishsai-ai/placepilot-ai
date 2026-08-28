"use client";
import { useEffect, useState } from "react";
import { Handshake, Inbox } from "lucide-react";
import { drivesAPI, scheduleAPI } from "@/lib/api";
import NegotiationArena from "@/components/schedule/NegotiationArena";

/* The company's own view onto the same negotiation the TPO is watching —
   read-only: HR can see the two agents work it out, but committing the
   result is the TPO's call, never the company's, so canCommit is always
   false here. */

interface MyDrive { id: string; title: string; status: string }
interface Round { id: string; round_no: number; round_type: string }

export default function CompanyNegotiations() {
  const [drives, setDrives] = useState<MyDrive[]>([]);
  const [driveId, setDriveId] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [roundId, setRoundId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    drivesAPI.myCompany()
      .then((res) => {
        setDrives(res.data);
        if (res.data.length > 0) setDriveId(res.data[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!driveId) { setRounds([]); setRoundId(""); return; }
    scheduleAPI.listRounds(driveId)
      .then((res) => {
        setRounds(res.data);
        setRoundId(res.data[0]?.id ?? "");
      })
      .catch(() => setRounds([]));
  }, [driveId]);

  if (loading) return <div className="glass-card h-40 animate-pulse" />;

  if (drives.length === 0) {
    return (
      <div className="glass-card text-center py-16 text-sm flex flex-col items-center gap-2" style={{ color: "var(--faint)" }}>
        <Inbox size={22} />
        No drives posted yet — negotiations show up here once a drive has an interview round.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Handshake size={16} style={{ color: "#7C5CBF" }} />
        <h2 className="text-base" style={{ color: "var(--fg)" }}>Schedule <em>negotiation</em></h2>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={driveId}
          onChange={(e) => setDriveId(e.target.value)}
          className="text-sm rounded-xl px-3 py-2 outline-none"
          style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
        >
          {drives.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        {rounds.length > 0 && (
          <select
            value={roundId}
            onChange={(e) => setRoundId(e.target.value)}
            className="text-sm rounded-xl px-3 py-2 outline-none"
            style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
          >
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>Round {r.round_no} — {r.round_type}</option>
            ))}
          </select>
        )}
      </div>
      {roundId ? (
        <NegotiationArena roundId={roundId} canCommit={false} />
      ) : (
        <div className="glass-card text-center py-10 text-sm" style={{ color: "var(--faint)" }}>
          This drive has no interview round yet — nothing for the agents to negotiate.
        </div>
      )}
    </div>
  );
}
