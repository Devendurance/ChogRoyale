"use client";

import Link from "next/link";
import type { PracticeDifficulty } from "@/lib/battle-protocol";

/** Idle presentation only. The existing battle session owns every action. */
export default function BattleEntry({ mode, code, error, setupReady = true, onStartPractice, practiceDifficulty = "medium", onCodeChange, onFind, onCreate, onJoin }: {
  mode: "private" | "unranked" | "ranked" | "practice";
  code: string;
  error: string | null;
  setupReady?: boolean;
  /** Practice is a separate server room, so its action has its own callback. */
  onStartPractice?: () => void;
  /** The server currently exposes MEDIUM only. Keep the label typed to the protocol. */
  practiceDifficulty?: PracticeDifficulty;
  onCodeChange: (code: string) => void;
  onFind: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const startPractice = onStartPractice ?? onFind;
  const practiceDifficultyLabel = practiceDifficulty.charAt(0).toUpperCase() + practiceDifficulty.slice(1);
  return (
    <section className="app-play-battle-entry app-panel" aria-labelledby="battle-entry-title">
      <header className="app-play-battle-head">
        <div>
          <p className="app-play-kicker">Battle hall</p>
          <h1 id="battle-entry-title">{mode === "private" ? "Private room" : mode === "ranked" ? "Ranked queue" : mode === "practice" ? "Practice battle" : "Unranked battle"}</h1>
        </div>
        <Link className="app-btn app-btn--ghost" href="/app/play">Change mode</Link>
      </header>
      <p className="app-play-entry-lead">{mode === "private" ? "Create a room and share its code with a friend, or join theirs." : mode === "ranked" ? "Ranked matchmaking is currently closed." : mode === "practice" ? "Play a real battle against a server-driven AI opponent. Practice has no rewards yet." : "Find an opponent, ready your deck, and enter the arena."}</p>
      <div className="app-play-entry-actions">
        {mode === "private" ? (
          <>
            <button type="button" className="app-btn app-btn--battle" onClick={onCreate} disabled={!setupReady}>Create Private Room</button>
            <form className="app-play-join" onSubmit={(event) => { event.preventDefault(); if (setupReady && code.trim()) onJoin(); }}>
              <label className="app-play-code" htmlFor="battle-room-code">
                <span>Have a room code?</span>
                <input id="battle-room-code" placeholder="Room code" value={code} onChange={(event) => onCodeChange(event.target.value)} autoComplete="off" spellCheck={false} />
              </label>
              <button type="submit" className="app-btn app-btn--ghost" disabled={!setupReady || !code.trim()}>Join with Code</button>
            </form>
          </>
        ) : mode === "practice" ? (
          <div className="app-play-practice-entry">
            <p className="app-play-battle-state" role="status"><strong>AI Opponent</strong><span>{practiceDifficultyLabel} difficulty · no rewards, Gold, XP, or trophies</span></p>
            <button type="button" className="app-btn app-btn--battle" onClick={startPractice} disabled={!setupReady}>Start Practice</button>
          </div>
        ) : mode === "unranked" ? (
          <button type="button" className="app-btn app-btn--battle" onClick={onFind} disabled={!setupReady}>Find Opponent</button>
        ) : <p className="app-play-battle-state">Ranked queue is unavailable in this build.</p>}
      </div>
      {!setupReady && <p className="app-play-battle-state" role="status">Checking your player setup before opening a room.</p>}
      {error && <p className="app-play-battle-error" role="alert">{error}</p>}
    </section>
  );
}
