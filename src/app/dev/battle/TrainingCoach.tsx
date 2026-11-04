"use client";

import { TUTORIAL_COACH_NAME, TUTORIAL_STAGES, tutorialProgressLabel, type TutorialMessage } from "@/lib/tutorial-camp";

/** Battle-layer Training Captain. The in-progress coach does not intercept
 * pointer input; the completion panel is a real modal and stops play. */
export default function TrainingCoach({ tutorial, onExit }: { tutorial: TutorialMessage; onExit: () => void }) {
  const lesson = TUTORIAL_STAGES.find((entry) => entry.stage === tutorial.stage) ?? TUTORIAL_STAGES[0]!;
  if (tutorial.completed) {
    return (
      <div className="chud-training-done" role="dialog" aria-modal="true" aria-labelledby="chud-training-done-title" aria-describedby="chud-training-done-copy">
        <section className="chud-training-done__panel">
          <p className="chud-training-done__eyebrow">Training Camp · Battle {tutorial.stage} of 3</p>
          <h2 id="chud-training-done-title">
            {tutorial.replay
              ? "Lesson practiced"
              : tutorial.stage === 1
                ? "First deployment confirmed"
                : tutorial.stage === 2
                  ? "Tower and new ground confirmed"
                  : "Lesson complete"}
          </h2>
          <p id="chud-training-done-copy">
            {tutorial.stage === 1
              ? "Your first troop reached the field. You have completed the first Training Camp battle."
              : tutorial.stage === 2
                ? "Your troops destroyed an enemy tower and you deployed into the new pocket. Battle 2 of 3 is complete."
                : "The Training Captain confirmed your lesson with a real battle event."}
          </p>
          <div className="chud-training-done__progress">
            <span>{tutorialProgressLabel(tutorial.completedStages)}</span>
            <span>{tutorial.graduated ? "Training Camp complete" : "Progress saved"}</span>
          </div>
          <button type="button" className="chud-training-done__action" onClick={onExit} data-audio-skip="true">
            Back to Training Camp
          </button>
        </section>
      </div>
    );
  }

  return (
    <aside className="chud-training-coach" aria-live="polite">
      <span className="chud-training-coach__badge">{tutorialProgressLabel(tutorial.completedStages)}</span>
      <div className="chud-training-coach__copy">
        <b>{TUTORIAL_COACH_NAME}</b>
        <p>
          {tutorial.stage === 1
            ? "Tap a troop card, then tap or drag onto your side of the arena. The green band shows where troops can land."
            : tutorial.stage === 2
              ? tutorial.towerLanes.length > 0
                ? "Your troops destroyed that tower! New ground opened in the glowing lane. Deploy a troop there."
                : "Push a lane across a bridge toward an enemy tower. Keep your own towers standing while you attack."
              : lesson.summary}
        </p>
      </div>
      <button type="button" className="chud-training-coach__exit" onClick={onExit} data-audio-skip="true">
        Leave
      </button>
    </aside>
  );
}
