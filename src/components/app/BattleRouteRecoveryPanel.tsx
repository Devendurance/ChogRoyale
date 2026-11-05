"use client";

import Link from "next/link";
import type { BattleRouteRecovery } from "./player-battle-route-model";

/** Shown in place of every new-session action on a battle route. */
export default function BattleRouteRecoveryPanel({
  recovery,
  progress = null,
  invite = false,
  backHref,
  backLabel,
  onRetry,
  onSignIn,
}: {
  recovery: BattleRouteRecovery;
  progress?: string | null;
  invite?: boolean;
  backHref: string;
  backLabel: string;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const inviteNote = invite ? " Your invitation is still in this address." : "";
  return (
    <main className="app-stage app-stage--gate">
      <div className="app-column app-column--gate">
        {recovery === "training-required" ? (
          <section className="app-panel app-gate" data-testid="battle-training-required">
            <h1 className="app-gate__title">Finish Training Camp first</h1>
            <p className="app-gate__lead">
              {invite ? "Graduate from Training Camp, then open this invitation again." : "Normal battles unlock when you graduate from Training Camp."}
              {progress ? ` You're at ${progress}.` : ""}
            </p>
            <Link href={backHref} className="app-btn app-btn--battle">{backLabel}</Link>
          </section>
        ) : recovery === "sign-in" ? (
          <section className="app-panel app-gate" data-testid="battle-sign-in">
            <h1 className="app-gate__title">Sign in again</h1>
            <p className="app-gate__lead" role="alert">Your session expired, so no battle was opened.{inviteNote}</p>
            <button type="button" className="app-btn app-btn--battle" onClick={onSignIn}>Sign in</button>
            <button type="button" className="app-btn app-btn--ghost" onClick={onRetry}>Try again</button>
          </section>
        ) : (
          <section className="app-panel app-gate" data-testid="battle-access-recovery">
            <h1 className="app-gate__title">Battle check unavailable</h1>
            <p className="app-gate__lead" role="alert">We couldn&apos;t confirm your battle access, so no battle was opened.{inviteNote} Nothing was lost.</p>
            <button type="button" className="app-btn app-btn--battle" onClick={onRetry}>Try again</button>
            <Link href={backHref} className="app-btn app-btn--ghost">{backLabel}</Link>
          </section>
        )}
      </div>
    </main>
  );
}
