"use client";

import Link from "next/link";

/** Idle presentation only. The existing battle session owns every action. */
export default function BattleEntry({ mode, code, error, onCodeChange, onFind, onCreate, onJoin }: {
  mode: "private" | "unranked" | "ranked";
  code: string;
  error: string | null;
  onCodeChange: (code: string) => void;
  onFind: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <section className="app-play-battle-entry app-panel" aria-labelledby="battle-entry-title">
      <header className="app-play-battle-head">
        <div>
          <p className="app-play-kicker">Battle hall</p>
          <h1 id="battle-entry-title">{mode === "private" ? "Private room" : mode === "ranked" ? "Ranked queue" : "Unranked battle"}</h1>
        </div>
        <Link className="app-btn app-btn--ghost" href="/app/play">Change mode</Link>
      </header>
      <p className="app-play-entry-lead">{mode === "private" ? "Create a room and share its code with a friend, or join theirs." : mode === "ranked" ? "Ranked matchmaking is currently closed." : "Find an opponent, ready your deck, and enter the arena."}</p>
      <div className="app-play-entry-actions">
        {mode === "private" ? (
          <>
            <button type="button" className="app-btn app-btn--battle" onClick={onCreate}>Create Private Room</button>
            <form className="app-play-join" onSubmit={(event) => { event.preventDefault(); if (code.trim()) onJoin(); }}>
              <label className="app-play-code" htmlFor="battle-room-code">
                <span>Have a room code?</span>
                <input id="battle-room-code" placeholder="Room code" value={code} onChange={(event) => onCodeChange(event.target.value)} autoComplete="off" spellCheck={false} />
              </label>
              <button type="submit" className="app-btn app-btn--ghost" disabled={!code.trim()}>Join with Code</button>
            </form>
          </>
        ) : mode === "unranked" ? (
          <button type="button" className="app-btn app-btn--battle" onClick={onFind}>Find Opponent</button>
        ) : <p className="app-play-battle-state">Ranked queue is unavailable in this build.</p>}
      </div>
      {error && <p className="app-play-battle-error" role="alert">{error}</p>}
    </section>
  );
}
