"use client";

import Link from "next/link";
import Icon from "@/components/app/icons";
import { TUTORIAL_CAMP_PATH, TUTORIAL_STAGES, type TutorialStage } from "@/lib/tutorial-camp";

/** Pre-battle briefing for one Training Camp lesson. */
export default function TrainingEntry({
  stage,
  error,
  setupReady,
  onStart,
}: {
  stage: TutorialStage;
  error: string | null;
  setupReady: boolean;
  onStart: () => void;
}) {
  const lesson = TUTORIAL_STAGES.find((entry) => entry.stage === stage) ?? TUTORIAL_STAGES[0]!;
  return (
    <section className="app-panel app-training-entry" aria-labelledby="training-entry-title">
      <div className="app-training-entry__head">
        <span className="app-training-entry__mark" aria-hidden="true">
          <Icon name="guide" size={30} />
        </span>
        <div>
          <p className="app-play-kicker">Training Camp · Battle {stage} of 3</p>
          <h1 id="training-entry-title">{lesson.title}</h1>
        </div>
        <Link className="app-btn app-btn--ghost" href={TUTORIAL_CAMP_PATH}>Back to camp</Link>
      </div>
      <p className="app-training-entry__lead">
        {lesson.summary} Your Training Captain will point to the next action, and the server checks each lesson with real battle events.
      </p>
      <ol className="app-training-entry__steps">
        {lesson.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <p className="app-training-entry__note">
        Practice rules. No Gold, XP, trophies or competitive result. {lesson.completion} If you leave, you can retry from Training Camp.
      </p>
      {!setupReady && <p className="app-play-battle-state" role="status">Checking your player setup before training.</p>}
      {error && <p className="app-play-battle-error" role="alert">{error}</p>}
      <div className="app-training-entry__actions">
        <button type="button" className="app-btn app-btn--battle" onClick={onStart} disabled={!setupReady}>
          Start Battle {stage}
        </button>
        <Link className="app-btn app-btn--ghost" href={TUTORIAL_CAMP_PATH}>Not yet</Link>
      </div>
    </section>
  );
}
