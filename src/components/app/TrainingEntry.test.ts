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
  towerLanes: [],
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

  it("briefs Battle 2 with tower and pocket steps, not the first-deployment steps", () => {
    const html = renderToStaticMarkup(createElement(TrainingEntry, { stage: 2, error: null, setupReady: true, onStart: () => undefined }));
    expect(html).toContain("Battle 2 of 3");
    expect(html).toContain("Towers &amp; Territory");
    expect(html).toContain("Destroy an enemy lane tower");
    expect(html).toContain("Deploy a troop inside the glowing new ground");
    expect(html).toContain("Start Battle 2");
    expect(html).not.toContain("Tap or drag onto the glowing band on your side");
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

  it("switches Battle 2 from tower attack to the new-ground instruction", () => {
    const before = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...inProgress, stage: 2, completedStages: 1, towerLanes: [] },
      onExit: () => undefined,
    }));
    expect(before).toContain("Push a lane across a bridge");
    expect(before).not.toContain("New ground opened");

    const after = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...inProgress, stage: 2, completedStages: 1, objective: "deploy_in_pocket", towerLanes: ["left"] },
      onExit: () => undefined,
    }));
    expect(after).toContain("destroyed that tower");
    expect(after).toContain("glowing lane");
    expect(after).toContain("Deploy a troop there");

    const complete = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...inProgress, stage: 2, completed: true, completedStages: 2, towerLanes: ["left"] },
      onExit: () => undefined,
    }));
    expect(complete).toContain("Tower and new ground confirmed");
    expect(complete).toContain("2/3");
  });
});
