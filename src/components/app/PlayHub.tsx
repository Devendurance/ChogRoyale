"use client";

// Player-facing battle entry (P1a). This is intentionally a small mode hub.
// Matchmaking, private rooms and the battle itself remain owned by the
// existing Colyseus session in /dev/battle.

import Link from "next/link";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import Icon from "./icons";

function Gate({ onSignIn }: { onSignIn: () => void }) {
  return (
    <main className="app-stage app-stage--gate">
      <div className="app-column app-column--gate">
        <div className="app-panel app-gate app-rise">
          <span className="app-gate__mark" aria-hidden="true"><Icon name="swords" size={34} /></span>
          <h1 className="app-gate__title">Choose your battle</h1>
          <p className="app-gate__lead">Sign in to enter a casual queue or open a private room.</p>
          <button type="button" className="app-btn app-btn--battle" onClick={onSignIn}>Log in with Privy</button>
          <p className="app-gate__note">Rooms and opponents are verified by the battle server.</p>
        </div>
      </div>
    </main>
  );
}

export default function PlayHub() {
  const { ready, authenticated, logout } = usePrivy();
  const { login } = useLogin();

  if (!ready) {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate"><span className="app-gate__pulse" aria-hidden="true" /><h1 className="app-gate__title">Opening battle hall</h1><p className="app-gate__lead">Connecting to the Chog Royale session.</p></div>
        </div>
      </main>
    );
  }

  if (!authenticated) return <Gate onSignIn={() => login()} />;

  return (
    <>
      <AppHud player={null} onSignOut={() => void logout()} extra={<Link href="/app" className="app-iconbtn" aria-label="Back to lobby" title="Back to lobby"><Icon name="back" /></Link>} />
      <main className="app-stage app-stage--play">
        <div className="app-column app-play-column">
          <header className="app-play-hero">
            <div>
              <p className="app-play-kicker">Battle hall</p>
              <h1 className="app-play-title">Choose your arena</h1>
              <p className="app-play-lead">Pick a mode, ready your deck, and let the authoritative battle server bring the match to life.</p>
            </div>
            <div className="app-play-hero-mark" aria-hidden="true"><Icon name="swords" size={42} /></div>
          </header>

          <section className="app-play-modes" aria-labelledby="app-play-modes-title">
            <h2 id="app-play-modes-title" className="app-sr">Battle modes</h2>
            <article className="app-play-card app-play-card--featured">
              <div className="app-play-card__icon" aria-hidden="true"><Icon name="swords" size={28} /></div>
              <div className="app-play-card__body">
                <p className="app-play-card__eyebrow">Casual matchmaking</p>
                <h2>Unranked</h2>
                <p>Join the live queue and face a genuine opponent. Your result follows the current server ruleset.</p>
                <Link href="/app/play/battle?mode=unranked" className="app-btn app-btn--battle">Find an opponent</Link>
              </div>
              <span className="app-play-card__status app-play-card__status--live">Available</span>
            </article>

            <article className="app-play-card">
              <div className="app-play-card__icon app-play-card__icon--gold" aria-hidden="true"><Icon name="user" size={28} /></div>
              <div className="app-play-card__body">
                <p className="app-play-card__eyebrow">Invite a friend</p>
                <h2>Private room</h2>
                <p>Create a room and share its code, or join a room your opponent has already opened.</p>
                <Link href="/app/play/battle?mode=private" className="app-btn app-btn--ghost">Open a private room</Link>
              </div>
              <span className="app-play-card__status app-play-card__status--live">Available</span>
            </article>

            <article className="app-play-card app-play-card--locked">
              <div className="app-play-card__icon app-play-card__icon--muted" aria-hidden="true"><Icon name="progress" size={28} /></div>
              <div className="app-play-card__body">
                <p className="app-play-card__eyebrow">Competitive queue</p>
                <h2>Ranked</h2>
                <p>Ranked matchmaking and persisted trophy standings are not enabled in this build.</p>
                <span className="app-play-card__disabled">Unavailable in closed alpha</span>
              </div>
              <span className="app-play-card__status">Coming later</span>
            </article>
          </section>

          <p className="app-play-truth">Unranked and private rooms use the existing authoritative battle flow. No ranked rating or rewards are shown here.</p>
          <AppNav activeId="lobby" />
        </div>
      </main>
    </>
  );
}
