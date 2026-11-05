import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KingdomTourCoach, KingdomTourInvite } from "./kingdom-tour-panels";
import { KINGDOM_TOUR_STEPS, KINGDOM_TOUR_TOTAL } from "@/lib/kingdom-tour";

const noop = () => undefined;
const spotlight = { left: 20, top: 40, width: 200, height: 80 };

function coach(stepIndex: number, progressionLine: string | null = null) {
  return renderToStaticMarkup(
    createElement(KingdomTourCoach, {
      step: KINGDOM_TOUR_STEPS[stepIndex]!,
      stepIndex,
      total: KINGDOM_TOUR_TOTAL,
      placement: "below",
      left: 12,
      top: 400,
      width: 320,
      spotlight,
      reduced: false,
      progressionLine,
      cardRef: createRef<HTMLDivElement>(),
      onNext: noop,
      onBack: noop,
      onSkip: noop,
      onClose: noop,
    }),
  );
}

describe("Meet Your Kingdom surfaces", () => {
  it("offers the tour once and keeps a quiet way out", () => {
    const html = renderToStaticMarkup(
      createElement(KingdomTourInvite, { onStart: noop, onDismiss: noop }),
    );
    expect(html).toContain("Training complete, Chog");
    expect(html).toContain("Show me around");
    expect(html).toContain("Not now");
    expect(html).toContain('aria-live="polite"');
  });

  it("shows the real step count, a spotlight, Skip, Back and Next", () => {
    const html = coach(0);
    expect(html).toContain("Your home base");
    expect(html).toContain("1 of");
    expect(html).toContain(`1 of ${KINGDOM_TOUR_TOTAL}`);
    expect(html).toContain("Skip");
    expect(html).toContain("Back");
    expect(html).toContain("Next");
    expect(html).toContain('data-spotlight="true"');
    expect(html).toMatch(/role="dialog"/);
    expect(html).toContain("left:12px");
    expect(html).toContain("top:400px");
    expect(html).toContain("width:320px");
  });

  it("finishes on the last step and never renders a fake tower control", () => {
    const html = coach(KINGDOM_TOUR_TOTAL - 1);
    expect(html).toContain("Your Chog identity");
    expect(html).toContain("Finish");
    expect(html).not.toContain("Upgrade tower");
    expect(html).not.toContain("Tower level");
  });

  it("prints the server-derived progression sentence only on the upgrade step", () => {
    const line = "Purchased level 4, 120 earned XP. The next upgrade costs 250 Gold.";
    const upgrades = coach(4, line);
    expect(KINGDOM_TOUR_STEPS[4]!.id).toBe("card-upgrades");
    expect(upgrades).toContain(line);
    const decks = coach(2, line);
    expect(decks).not.toContain(line);
  });
});
