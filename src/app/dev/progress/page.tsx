"use client";

// B3.3c dev progress surface. Read-only stats and the casual unranked
// leaderboard over verified settled matches. Same Privy + inline-style
// conventions as /dev/battle.

import { useCallback, useEffect, useState } from "react";
import { PrivyProvider, usePrivy, useLogin } from "@privy-io/react-auth";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const ENABLED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_BATTLE === "1";
const PAGE_SIZE = 10;

interface PlayerStats {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  winRateBp: number | null;
  crownsEarned: number;
  crownsConceded: number;
  byType: {
    private: { matches: number; wins: number; losses: number; draws: number };
    matchmaking: { matches: number; wins: number; losses: number; draws: number };
  };
  firstMatchAt: string | null;
  latestMatchAt: string | null;
}

interface StatsResponse {
  username: string;
  displayName: string | null;
  avatar: { id: string; name: string; assetUrl: string } | null;
  stats: PlayerStats;
  casual: { eligible: boolean; minMatches: number; position: number | null; matchmakingMatches: number };
}

interface BoardEntry {
  position: number;
  username: string;
  displayName: string | null;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRateBp: number;
  crownsEarned: number;
  isYou: boolean;
}

interface BoardResponse {
  kind: string;
  minMatches: number;
  ordering: string;
  entries: BoardEntry[];
  total: number;
  limit: number;
  offset: number;
  me: { position: number | null; eligible: boolean };
}

interface MatchItem {
  matchId: string;
  result: string;
  crowns: { mine: number; opponent: number };
  matchType: string;
  settledAt: string;
  opponent: { username: string };
}

const bp = (v: number | null) => (v === null ? "n/a" : `${(v / 100).toFixed(1)}%`);
const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "n/a");

function ProgressPanel() {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [recent, setRecent] = useState<MatchItem[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const authed = useCallback(
    async (path: string) => {
      const token = await getAccessToken();
      if (!token) return null;
      const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
      return (await res.json()) as { success: boolean; data?: unknown; error?: { message?: string } };
    },
    [getAccessToken]
  );

  useEffect(() => {
    if (!authenticated) return;
    let live = true;
    void (async () => {
      const [s, m] = await Promise.all([authed("/api/players/me/stats"), authed("/api/players/me/matches?limit=5")]);
      if (!live) return;
      if (s?.success) setStats(s.data as StatsResponse);
      else setErr(s?.error?.message ?? "Failed to load stats");
      if (m?.success) setRecent((m.data as { items: MatchItem[] }).items);
    })();
    return () => {
      live = false;
    };
  }, [authenticated, authed]);

  useEffect(() => {
    if (!authenticated) return;
    let live = true;
    void (async () => {
      const b = await authed(`/api/leaderboard/casual?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!live) return;
      if (b?.success) setBoard(b.data as BoardResponse);
    })();
    return () => {
      live = false;
    };
  }, [authenticated, authed, offset]);

  if (!ENABLED) return <p>Dev pages are disabled in this build.</p>;
  if (!APP_ID) return <p>Missing NEXT_PUBLIC_PRIVY_APP_ID.</p>;
  if (!ready) return <p>Loading Privy…</p>;
  if (!authenticated) return <button onClick={() => login()}>Log in with Privy</button>;

  const s = stats?.stats;
  const casual = stats?.casual;
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "#9ca3af" }}>{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 560 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <span>dev progress</span>
        <button onClick={() => void logout()}>Log out</button>
        {err && <span style={{ color: "#f87171" }}>{err}</span>}
      </div>

      {stats ? (
        <section style={{ display: "grid", gap: 6, padding: 10, border: "1px solid #374151", borderRadius: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {stats.avatar && <img src={stats.avatar.assetUrl} alt={stats.avatar.name} width={40} height={40} />}
            <div>
              <div style={{ fontWeight: 600 }}>{stats.displayName ?? stats.username}</div>
              <div style={{ color: "#9ca3af", fontSize: 12 }}>@{stats.username}</div>
            </div>
          </div>
          {s!.total === 0 ? (
            <div style={{ fontSize: 13, color: "#9ca3af" }}>No verified matches yet. Play a battle to start your record.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px" }}>
              {row("Matches", s!.total)}
              {row("Record", `${s!.wins}W ${s!.losses}L ${s!.draws}D`)}
              {row("Win rate", bp(s!.winRateBp))}
              {row("Crowns", `${s!.crownsEarned} earned / ${s!.crownsConceded} conceded`)}
              {row("Private", `${s!.byType.private.wins}W ${s!.byType.private.losses}L ${s!.byType.private.draws}D (${s!.byType.private.matches})`)}
              {row("Matchmaking", `${s!.byType.matchmaking.wins}W ${s!.byType.matchmaking.losses}L ${s!.byType.matchmaking.draws}D (${s!.byType.matchmaking.matches})`)}
              {row("First match", dt(s!.firstMatchAt))}
              {row("Latest match", dt(s!.latestMatchAt))}
            </div>
          )}
          <div style={{ fontSize: 13 }}>
            {casual?.eligible ? (
              <span>Casual position: <b>#{casual.position}</b></span>
            ) : (
              <span style={{ color: "#9ca3af" }}>
                play {Math.max(0, (casual?.minMatches ?? 3) - (casual?.matchmakingMatches ?? 0))} more matchmaking matches to qualify
              </span>
            )}
          </div>
        </section>
      ) : (
        <p>Loading stats…</p>
      )}

      {recent !== null && (
        <section style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>Recent results</div>
          {recent.length === 0 && <div style={{ color: "#9ca3af" }}>No recorded matches yet.</div>}
          {recent.map((m) => (
            <div key={m.matchId}>
              {m.result === "win" ? "Won" : m.result === "loss" ? "Lost" : "Drew"} {m.crowns.mine}-{m.crowns.opponent} vs {m.opponent.username} · {m.matchType} · {new Date(m.settledAt).toLocaleString()}
            </div>
          ))}
        </section>
      )}

      <section style={{ display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 600 }}>Casual leaderboard</div>
        <div style={{ fontSize: 12, color: "#fbbf24", padding: "6px 8px", border: "1px solid #fbbf24", borderRadius: 6 }}>
          Casual unranked alpha leaderboard. Matchmaking games only, private rooms excluded, minimum {board?.minMatches ?? 3} matches. No trophies, rewards or NFT prestige.
        </div>
        {board && board.entries.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>Nobody qualifies yet.</div>}
        {board && board.entries.length > 0 && (
          <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ color: "#9ca3af", textAlign: "left" }}>
                <th>#</th>
                <th>player</th>
                <th>mm wins</th>
                <th>played</th>
                <th>win rate</th>
                <th>crowns</th>
              </tr>
            </thead>
            <tbody>
              {board.entries.map((e) => (
                <tr key={`${e.position}-${e.username}`} style={e.isYou ? { background: "#1e3a2f" } : undefined}>
                  <td>{e.position}{e.isYou ? " (you)" : ""}</td>
                  <td>{e.displayName ?? e.username}</td>
                  <td>{e.wins}</td>
                  <td>{e.matches}</td>
                  <td>{bp(e.winRateBp)}</td>
                  <td>{e.crownsEarned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
          <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>Prev</button>
          <button disabled={!board || offset + PAGE_SIZE >= board.total} onClick={() => setOffset((o) => o + PAGE_SIZE)}>Next</button>
          {board && <span style={{ color: "#9ca3af" }}>{board.total} qualified</span>}
        </div>
      </section>
    </div>
  );
}

export default function DevProgressPage() {
  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Chog Royale dev progress (B3.3c alpha)</h1>
      <PrivyProvider appId={APP_ID} config={{ embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } } }}>
        <ProgressPanel />
      </PrivyProvider>
    </main>
  );
}
