"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Icon from "@/components/app/icons";
import { readTutorialProgress } from "@/components/app/use-tutorial-access";
import {
  TUTORIAL_COACH_NAME,
  TUTORIAL_STAGES,
  TUTORIAL_TOTAL_STAGES,
  tutorialBattlePath,
  tutorialCaptainCopy,
  tutorialIsMandatory,
  tutorialProgressLabel,
  tutorialStageAction,
  type TutorialProgressView,
} from "@/lib/tutorial-camp";

type LoadState =
  | { state: "loading" }
  | { state: "session" }
  | { state: "locked"; message: string }
  | { state: "unavailable"; message: string }
  | { state: "ready"; tutorial: TutorialProgressView };

export default function TrainingCampScreen() {
  const { user } = usePrivy();
  // Keyed by account, so one player's progress can't show under the next sign-in.
  return <TrainingCamp key={user?.id ?? "signed-out"} />;
}

function TrainingCamp() {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const [load, setLoad] = useState<LoadState>({ state: "loading" });

  const refresh = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const token = await getAccessToken();
      if (!token) {
        setLoad({ state: "session" });
        return;
      }
      setLoad(await readTutorialProgress(token));
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
  const graduated = tutorial.completedStages >= TUTORIAL_TOTAL_STAGES;
  const mandatory = tutorialIsMandatory(tutorial);

  return (
    <main className="app-stage">
      <div className="app-column app-training-camp">
        <div className="app-training-camp__back">
          {mandatory ? (
            <>
              <Link href="/app/profile" className="app-btn app-btn--ghost">Profile</Link>
              <Link href="/app/guide" className="app-btn app-btn--ghost">Play guide</Link>
              <Link href="/app/settings" className="app-btn app-btn--ghost">Settings</Link>
              <button type="button" className="app-btn app-btn--ghost" onClick={() => void logout()}>Sign out</button>
            </>
          ) : (
            <>
              <Link href="/app/play" className="app-btn app-btn--ghost">Back to Battle Hall</Link>
              <Link href="/app" className="app-btn app-btn--ghost">Back to Lobby</Link>
            </>
          )}
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
            <p data-testid="training-captain-line">{tutorialCaptainCopy(tutorial)}</p>
          </div>
        </section>

        <section className="app-panel app-training-camp__progress" aria-label="Training Camp progress">
          <strong>{tutorialProgressLabel(tutorial.completedStages)}</strong>
          <div className="app-training-camp__meter" role="progressbar" aria-valuemin={0} aria-valuemax={TUTORIAL_TOTAL_STAGES} aria-valuenow={tutorial.completedStages}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </section>

        {graduated && (
          <section className="app-panel app-training-camp__graduation" data-testid="training-graduated">
            <span className="app-training-camp__graduation-mark" aria-hidden="true"><Icon name="guide" size={30} /></span>
            <div>
              <p className="app-play-kicker">Training Camp complete · 3 of 3</p>
              <h2>You earned your place in the arena</h2>
              <p>
                You learned deployment, tower pressure, commander timing and how to read Chaos. The Training Captain is done teaching. Every lesson stays open if you want the practice.
              </p>
            </div>
            <Link href="/app/play" className="app-btn app-btn--battle">Enter Battle Hall</Link>
          </section>
        )}

        <ol className="app-training-camp__stages">
          {TUTORIAL_STAGES.map((stage) => {
            const action = tutorialStageAction(tutorial, stage.stage);
            const complete = action === "completed" || action === "replay";
            const current = action === "play" && tutorial.nextStage === stage.stage;
            return (
              <li key={stage.stage} data-stage-action={action} aria-current={current ? "step" : undefined} className={`app-training-stage${complete ? " app-training-stage--complete" : current ? " app-training-stage--current" : ""}`}>
                <span className="app-training-stage__num" aria-hidden="true">{complete ? "✓" : stage.stage}</span>
                <div className="app-training-stage__body">
                  <h2>{stage.title}</h2>
                  <p>{stage.summary}</p>
                </div>
                <div className="app-training-stage__status">
                  {action === "completed" ? (
                    <span>Completed</span>
                  ) : action === "locked" ? (
                    <>
                      <span>Locked</span>
                      <span>Complete Battle {stage.stage - 1} first</span>
                    </>
                  ) : (
                    <>
                      <span>{complete ? "Complete" : current ? "Ready" : "Available"}</span>
                      <Link className="app-btn app-btn--battle" href={tutorialBattlePath(stage.stage)}>
                        {complete ? `Replay Battle ${stage.stage}` : `Start Battle ${stage.stage}`}
                      </Link>
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
              ? "Lessons open one at a time. Replays and normal battle modes unlock when you graduate, and each lesson is checked by the server."
              : "All three lessons are available. Normal modes stay open while the camp is in preview. Tutorial battles never grant Gold, XP, trophies or a competitive result."}
        </p>
      </div>
    </main>
  );
}
