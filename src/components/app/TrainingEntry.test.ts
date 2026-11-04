import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TrainingEntry from "./TrainingEntry";
import TrainingCoach from "@/app/dev/battle/TrainingCoach";
import type { TutorialMessage } from "@/lib/tutorial-camp";

const inProgress: TutorialMessage = {
  stage: 1,
  objective: "first_troop_deploy",
  completed: false,
  replay: false,
  completedStages: 0,
  graduated: false,
};

describe("Training Camp presentation", () => {
  it("briefs Battle 1 with the real controls and honest no-reward copy", () => {
    const html = renderToStaticMarkup(createElement(TrainingEntry, { stage: 1, error: null, setupReady: true, onStart: () => undefined }));
    expect(html).toContain("Battle 1 of 3");
    expect(html).toContain("First Deployment");
    expect(html).toContain("Tap a troop card");
    expect(html).toContain("Start Battle 1");
    expect(html).toContain("No Gold, XP, trophies");
  });

  it("shows the Training Captain during the lesson without claiming completion", () => {
    const html = renderToStaticMarkup(createElement(TrainingCoach, { tutorial: inProgress, onExit: () => undefined }));
    expect(html).toContain("Training Captain");
    expect(html).toContain("Tap a troop card");
    expect(html).toContain("0/3");
    expect(html).not.toContain("First deployment confirmed");
  });

  it("shows a server-confirmed completion and returns to camp", () => {
    const html = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...inProgress, completed: true, completedStages: 1 },
      onExit: () => undefined,
    }));
    expect(html).toContain("First deployment confirmed");
    expect(html).toContain("1/3");
    expect(html).toContain("Progress saved");
    expect(html).toContain("Back to Training Camp");
  });
});
