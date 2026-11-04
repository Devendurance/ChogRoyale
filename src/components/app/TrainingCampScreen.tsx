"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Icon from "@/components/app/icons";
import {
  TUTORIAL_COACH_NAME,
  TUTORIAL_STAGES,
  TUTORIAL_TOTAL_STAGES,
  tutorialBattlePath,
  tutorialProgressLabel,
  type TutorialProgressView,
} from "@/lib/tutorial-camp";

type LoadState =
  | { state: "loading" }
  | { state: "session" }
  | { state: "locked"; message: string }
  | { state: "unavailable"; message: string }
  | { state: "ready"; tutorial: TutorialProgressView };

export default function TrainingCampScreen() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [load, setLoad] = useState<LoadState>({ state: "loading" });

  const refresh = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const token = await getAccessToken();
      if (!token) {
        setLoad({ state: "session" });
        return;
      }
      const response = await fetch("/api/players/me/tutorial", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | { success?: boolean; data?: { tutorial?: TutorialProgressView }; error?: { message?: string } }
        | null;
      if (response.status === 401) {
        setLoad({ state: "session" });
        return;
      }
      if (response.status === 403) {
        setLoad({ state: "locked", message: "Finish your player profile setup to open Training Camp." });
        return;
      }
      if (!response.ok || !body?.success || !body.data?.tutorial) {
        setLoad({ state: "unavailable", message: body?.error?.message ?? "Training Camp progress could not be loaded." });
        return;
      }
      setLoad({ state: "ready", tutorial: body.data.tutorial });
    } catch {
      setLoad({ state: "unavailable", message: "Training Camp progress could not be loaded. Check your connection and try again." });
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [authenticated, ready, refresh]);

  if (!ready) {
    return <main className="app-stage"><div className="app-column app-training-camp"><p className="app-play-battle-state" role="status">Opening Training Camp…</p></div></main>;
  }

  if (!authenticated || load.state === "session") {
    return (
      <main className="app-stage">
        <div className="app-column app-training-camp">
          <section className="app-panel app-training-entry">
            <h1>Training Camp</h1>
            <p className="app-training-entry__lead">Sign in to open the guided Training Camp.</p>
            <Link href="/app/play" className="app-btn app-btn--ghost">Back to Battle Hall</Link>
          </section>
        </div>
      </main>
    );
  }

  if (load.state === "loading") {
    return <main className="app-stage"><div className="app-column app-training-camp"><p className="app-play-battle-state" role="status">Loading your Training Camp progress…</p></div></main>;
  }

  if (load.state === "unavailable" || load.state === "locked") {
    return (
      <main className="app-stage">
        <div className="app-column app-training-camp">
          <section className="app-panel app-training-entry">
            <h1>Training Camp</h1>
            <p className="app-play-battle-error" role="alert">{load.message}</p>
            <div className="app-training-entry__actions">
              <button type="button" className="app-btn app-btn--battle" onClick={() => void refresh()}>Try again</button>
              <Link href="/app/play" className="app-btn app-btn--ghost">Back to Battle Hall</Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const tutorial = load.tutorial;
  const percent = Math.round((Math.min(TUTORIAL_TOTAL_STAGES, tutorial.completedStages) / TUTORIAL_TOTAL_STAGES) * 100);
  const coachCopy = tutorial.access === "training-required"
    ? tutorial.completedStages >= 1
      ? "Battle 1 is complete. Battle 2 is coming next, and the other battle modes unlock after all three lessons."
      : "Complete Training Camp to unlock the other battle modes. Battle 1 is ready now."
    : tutorial.access === "grandfathered"
      ? "Your account already has full battle access. You can replay the lessons any time."
      : tutorial.completedStages >= 1
        ? "Battle 1 is complete. Battles 2 and 3 arrive in the next Training Camp update."
        : "Three short battles teach the real controls. Battle 1 is ready now, and every lesson is checked by the server.";

  return (
    <main className="app-stage">
      <div className="app-column app-training-camp">
        <div className="app-training-camp__back">
          <Link href="/app/play" className="app-btn app-btn--ghost">Back to Battle Hall</Link>
          <Link href="/app" className="app-btn app-btn--ghost">Back to Lobby</Link>
        </div>

        <section className="app-panel app-training-camp__hero">
          <span className="app-training-entry__mark" aria-hidden="true"><Icon name="guide" size={30} /></span>
          <div>
            <p className="app-play-kicker">Training Camp · {tutorialProgressLabel(tutorial.completedStages)}</p>
            <h1>Learn the arena</h1>
            <p className="app-training-camp__lead">
              A friendly Training Captain walks you through the real battlefield one action at a time. Progress is saved to your account.
            </p>
          </div>
        </section>

        <section className="app-training-camp__coach" aria-live="polite">
          <div>
            <b>{TUTORIAL_COACH_NAME}</b>
            <p>{coachCopy}</p>
          </div>
        </section>

        <section className="app-panel app-training-camp__progress" aria-label="Training Camp progress">
          <strong>{tutorialProgressLabel(tutorial.completedStages)}</strong>
          <div className="app-training-camp__meter" role="progressbar" aria-valuemin={0} aria-valuemax={TUTORIAL_TOTAL_STAGES} aria-valuenow={tutorial.completedStages}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </section>

        <ol className="app-training-camp__stages">
          {TUTORIAL_STAGES.map((stage) => {
            const complete = tutorial.completedStages >= stage.stage;
            const current = tutorial.nextStage === stage.stage && stage.playable;
            const canPlay = stage.playable;
            return (
              <li key={stage.stage} className={`app-training-stage${complete ? " app-training-stage--complete" : current ? " app-training-stage--current" : ""}`}>
                <span className="app-training-stage__num" aria-hidden="true">{complete ? "✓" : stage.stage}</span>
                <div className="app-training-stage__body">
                  <h2>{stage.title}</h2>
                  <p>{stage.summary}</p>
                </div>
                <div className="app-training-stage__status">
                  {canPlay ? (
                    <>
                      <span>{complete ? "Complete" : current ? "Ready" : "Locked"}</span>
                      <Link className="app-btn app-btn--battle" href={tutorialBattlePath(stage.stage)}>
                        {complete ? "Replay Battle 1" : "Start Battle 1"}
                      </Link>
                    </>
                  ) : (
                    <>
                      <span>Coming next</span>
                      <span>Training update</span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="app-training-camp__notice">
          {tutorial.access === "grandfathered"
            ? "Your account keeps full battle access. You can replay the lessons any time."
            : tutorial.enforcement && tutorial.access === "training-required"
              ? "Training Camp is in enforced rollout. Battles 2 and 3 arrive in the next update, so normal modes stay locked until all three lessons are available."
              : "Battles 2 and 3 arrive in the next Training Camp update. Normal modes stay open while the camp is in preview. Tutorial battles never grant Gold, XP, trophies or a competitive result."}
        </p>
      </div>
    </main>
  );
}
