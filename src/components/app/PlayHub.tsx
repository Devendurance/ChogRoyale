"use client";

// Player-facing battle entry (P1a). This is intentionally a small mode hub.
// Matchmaking, private rooms and the battle itself remain owned by the
// existing Colyseus session in /dev/battle.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import Icon from "./icons";
import { useOnboardingRedirect } from "./use-onboarding-redirect";
import { RANKED_SEASON } from "@/lib/ranked";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import type { LobbyPlayer } from "./lobby-types";

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
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();
  const [player, setPlayer] = useState<LobbyPlayer | null>(null);
  const [failed, setFailed] = useState(false);
  const sessionKey = user?.id ?? null;

  useOnboardingRedirect(
    !ready || !authenticated ? "loading" : failed || !player ? "loading" : player.onboardingComplete ? "complete" : "incomplete"
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!ready || !authenticated) {
        if (!cancelled) {
          setPlayer(null);
          setFailed(false);
        }
        return;
      }
      const token = await getAccessToken();
      if (!token || cancelled) return;
      try {
        const res = await fetch("/api/players/me", { headers: { authorization: `Bearer ${token}` } });
        const body = (await res.json()) as { success: boolean; data?: { player: ProfilePayload } };
        if (!cancelled) {
          setFailed(!(body.success && body.data));
          setPlayer(body.success && body.data ? resolvePlayer(body.data.player) : null);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          setPlayer(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, sessionKey, getAccessToken]);

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

  return <PlayHubView player={player} onSignOut={() => void logout()} />;
}

export function PlayHubView({ player, onSignOut }: { player: LobbyPlayer | null; onSignOut: () => void }) {
  return (
    <>
      <AppHud player={player} onSignOut={onSignOut} extra={<Link href="/app" className="app-iconbtn" aria-label="Back to lobby" title="Back to lobby"><Icon name="back" /></Link>} />
      <main className="app-stage app-stage--play">
        <div className="app-column app-play-column">
          <header className="app-play-hero">
            <div>
              <p className="app-play-kicker">Battle hall</p>
              <h1 className="app-play-title">Choose your arena</h1>
              <p className="app-play-lead">Choose a mode and ready your deck.</p>
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
                <Link href="/app/play/battle?mode=unranked" className="app-btn app-btn--battle">Find Opponent</Link>
              </div>
              <span className="app-play-card__status app-play-card__status--live">Available</span>
            </article>

            <article className="app-play-card">
              <div className="app-play-card__icon app-play-card__icon--gold" aria-hidden="true"><Icon name="user" size={28} /></div>
              <div className="app-play-card__body">
                <p className="app-play-card__eyebrow">Invite a friend</p>
                <h2>Private room</h2>
                <p>Create a room and share its code, or join a room your opponent has already opened.</p>
                <Link href="/app/play/battle?mode=private" className="app-btn app-btn--ghost">Create or join</Link>
              </div>
              <span className="app-play-card__status app-play-card__status--live">Available</span>
            </article>

            <article className="app-play-card app-play-card--locked">
              <div className="app-play-card__icon app-play-card__icon--muted" aria-hidden="true"><Icon name="progress" size={28} /></div>
              <div className="app-play-card__body">
                <p className="app-play-card__eyebrow">Competitive queue</p>
                <h2>Ranked</h2>
                <p>Season {RANKED_SEASON} is being prepared for the competitive launch. Read-only standings appear in Progress when the ranked service is available.</p>
                <span className="app-play-card__detail">Eligibility: server check · matchmaking: closed</span>
                <Link href="/app/progress#ranked-season" className="app-btn app-btn--ghost app-play-card__secondary">View ranked record</Link>
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
