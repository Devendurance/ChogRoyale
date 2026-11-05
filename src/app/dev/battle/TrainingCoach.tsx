"use client";

import {
  TUTORIAL_COACH_NAME,
  TUTORIAL_OBJECTIVE_LABELS,
  tutorialProgressLabel,
  type TutorialMessage,
  type TutorialObjectiveId,
} from "@/lib/tutorial-camp";

/** Real Chaos state from the authoritative frame, never a guess. */
export interface CoachChaos {
  state: "warning" | "active";
  name: string;
}

/** Battle-layer Training Captain. The in-progress coach does not intercept
 * pointer input; the completion panel is a real modal and stops play. */
export default function TrainingCoach({
  tutorial,
  chaos = null,
  commanderAlive = true,
  onExit,
  onGraduated,
}: {
  tutorial: TutorialMessage;
  chaos?: CoachChaos | null;
  commanderAlive?: boolean;
  onExit: () => void;
  onGraduated?: () => void;
}) {
  const done = (id: TutorialObjectiveId) => tutorial.objectives.find((entry) => entry.id === id)?.done ?? false;

  if (tutorial.completed) {
    const graduated = tutorial.graduated;
    return (
      <div
        className="chud-training-done"
        data-graduated={graduated ? "true" : "false"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chud-training-done-title"
        aria-describedby="chud-training-done-copy"
      >
        <section className="chud-training-done__panel">
          {graduated && <span className="chud-training-done__crown" aria-hidden="true" />}
          <p className="chud-training-done__eyebrow">
            {graduated ? "Training Camp complete · 3 of 3" : `Training Camp · Battle ${tutorial.stage} of 3`}
          </p>
          <h2 id="chud-training-done-title">
            {graduated
              ? tutorial.replay
                ? "Still got it, Commander"
                : "Welcome to the real fight, Commander"
              : tutorial.replay
                ? "Lesson practiced"
                : tutorial.stage === 1
                  ? "First deployment confirmed"
                  : tutorial.stage === 2
                    ? "Tower and new ground confirmed"
                    : "Lesson complete"}
          </h2>
          <p id="chud-training-done-copy">
            {graduated
              ? "Deployment, tower pressure, commander timing and Chaos awareness. The Captain has nothing left to teach, so the battle hall is yours. Practice, Unranked and Private rooms are open the moment the arena allows them."
              : tutorial.stage === 1
                ? "Your first troop reached the field. You have completed the first Training Camp battle."
                : tutorial.stage === 2
                  ? "Your troops destroyed an enemy tower and you deployed into the new pocket. Battle 2 of 3 is complete."
                  : "The Training Captain confirmed your lesson with a real battle event."}
          </p>
          <div className="chud-training-done__progress">
            <span>{tutorialProgressLabel(tutorial.completedStages)}</span>
            <span>{graduated ? "Training Camp complete" : "Progress saved"}</span>
          </div>
          {graduated ? (
            <div className="chud-training-done__actions">
              <button type="button" className="chud-training-done__action" onClick={onGraduated ?? onExit} data-audio-skip="true">
                Enter Battle Hall
              </button>
              <button type="button" className="chud-training-done__secondary" onClick={onExit} data-audio-skip="true">
                Back to Training Camp
              </button>
            </div>
          ) : (
            <button type="button" className="chud-training-done__action" onClick={onExit} data-audio-skip="true">
              Back to Training Camp
            </button>
          )}
        </section>
      </div>
    );
  }

  const stageThreeCopy = () => {
    if (done("build_push") === false) {
      return "Build a push. Lead with a durable troop like Chog Guardian, then put damage behind it. Keep a little energy in reserve.";
    }
    if (!done("deploy_commander")) {
      return "Good push. Now deploy your Bulwark commander from your hand. It anchors the lane, and its ability unlocks once it is on the field.";
    }
    if (!done("use_ability")) {
      if (!commanderAlive) {
        return "Your commander fell before you used its ability. Watch your hand for the commander card, deploy it again, then fire Aegis Wall while the fight is joined.";
      }
      return "Your commander is on the field. Aegis Wall costs energy, shields your commander for a few seconds and then needs a cooldown. Tap it while the fight is joined.";
    }
    return "All three steps are confirmed. Hold the line while the Captain records your graduation.";
  };

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
              : stageThreeCopy()}
        </p>
        {tutorial.stage === 3 && (
          <ul className="chud-training-coach__steps">
            {tutorial.objectives.map((objective) => (
              <li key={objective.id} data-done={objective.done}>
                <span aria-hidden="true">{objective.done ? "✓" : "•"}</span>
                {TUTORIAL_OBJECTIVE_LABELS[objective.id]}
                <span className="app-sr">{objective.done ? ", confirmed" : ", not yet confirmed"}</span>
              </li>
            ))}
          </ul>
        )}
        {chaos && (
          <p className="chud-training-coach__chaos" data-chaos={chaos.state}>
            <b>{chaos.state === "active" ? "Chaos live" : "Chaos warning"}:</b>{" "}
            {chaos.state === "active"
              ? `${chaos.name} is active. Play around the marked ground until it expires.`
              : `${chaos.name} is about to trigger. Watch the marked ground and move your push clear.`}
          </p>
        )}
      </div>
      <button type="button" className="chud-training-coach__exit" onClick={onExit} data-audio-skip="true">
        Leave
      </button>
    </aside>
  );
}
