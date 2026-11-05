"use client";

// Presentational surfaces for the post-training tour. They stay free of Privy,
// routing and network code so the copy, controls and structure can be reviewed
// and rendered on their own.

import type { CSSProperties, RefObject } from "react";
import Icon from "./icons";
import type { CoachPlacement, KingdomTourStep } from "@/lib/kingdom-tour";

export function KingdomTourInvite({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <section
      className="app-tour-invite"
      role="region"
      aria-live="polite"
      aria-label="Training Camp tour invitation"
      data-testid="kingdom-tour-invite"
    >
      <span className="app-tour-invite__mark" aria-hidden="true">
        <Icon name="guide" size={24} />
      </span>
      <div className="app-tour-invite__copy">
        <b>Training Captain</b>
        <p>Training complete, Chog. You have learned to fight. Now let me show you around your kingdom.</p>
      </div>
      <div className="app-tour-invite__actions">
        <button type="button" className="app-btn app-btn--battle" onClick={onStart} data-audio-skip="true">
          Show me around
        </button>
        <button type="button" className="app-btn app-btn--ghost" onClick={onDismiss} data-audio-skip="true">
          Not now
        </button>
      </div>
    </section>
  );
}

export function KingdomTourCoach({
  step,
  stepIndex,
  total,
  placement,
  left,
  top,
  width,
  spotlight,
  reduced,
  progressionLine,
  cardRef,
  onNext,
  onBack,
  onSkip,
  onClose,
}: {
  step: KingdomTourStep;
  stepIndex: number;
  total: number;
  placement: CoachPlacement;
  left: number;
  top: number;
  width: number;
  spotlight: { left: number; top: number; width: number; height: number } | null;
  reduced: boolean;
  progressionLine: string | null;
  cardRef: RefObject<HTMLDivElement | null>;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const last = stepIndex === total - 1;
  return (
    <div className="app-tour" data-testid="kingdom-tour" data-reduced={reduced ? "true" : "false"}>
      <div
        className="app-tour__shade"
        aria-hidden="true"
        data-spotlight={spotlight ? "true" : "false"}
        style={
          spotlight
            ? { left: spotlight.left - 6, top: spotlight.top - 6, width: spotlight.width + 12, height: spotlight.height + 12 }
            : { left: "50%", top: "50%", width: 0, height: 0 }
        }
      />
      <div
        className="app-tour__coach"
        role="dialog"
        aria-labelledby="app-tour-title"
        aria-describedby="app-tour-body"
        data-placement={placement}
        data-testid="kingdom-tour-coach"
        ref={cardRef}
        tabIndex={-1}
        style={{ left, top, width } as CSSProperties}
      >
        <div className="app-tour__head">
          <span className="app-tour__captain" aria-hidden="true">
            <Icon name="guide" size={18} />
          </span>
          <div>
            <p className="app-tour__eyebrow">
              Training Captain <span aria-hidden="true">{"\u00b7"}</span> {stepIndex + 1} of {total}
            </p>
            <h2 id="app-tour-title">{step.title}</h2>
          </div>
          <button type="button" className="app-tour__close" onClick={onClose} aria-label="Close the tour" data-audio-skip="true">
            <Icon name="close" size={16} />
          </button>
        </div>
        <p id="app-tour-body" className="app-tour__body">
          {step.body}
        </p>
        {step.id === "card-upgrades" && progressionLine && (
          <p className="app-tour__facts" data-testid="kingdom-tour-progression">
            {progressionLine}
          </p>
        )}
        <div className="app-tour__dots" aria-hidden="true">
          {Array.from({ length: total }, (_, index) => (
            <span key={index} data-current={index === stepIndex ? "true" : "false"} data-done={index < stepIndex ? "true" : "false"} />
          ))}
        </div>
        <div className="app-tour__controls">
          <button type="button" className="app-btn app-btn--ghost" onClick={onSkip} data-audio-skip="true">
            Skip
          </button>
          <div className="app-tour__nav">
            <button type="button" className="app-btn app-btn--ghost" onClick={onBack} disabled={stepIndex === 0} data-audio-skip="true">
              Back
            </button>
            <button type="button" className="app-btn app-btn--battle" onClick={onNext} data-audio-skip="true">
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
