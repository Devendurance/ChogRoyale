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
  objectives: [{ id: "first_troop_deploy", done: false }],
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
    expect(html).toContain("Well fought, Chog!");
  });

  it("holds the Captain's story line until the server confirms the stage", () => {
    const pending = renderToStaticMarkup(createElement(TrainingCoach, { tutorial: { ...inProgress, stage: 2, completedStages: 1, towerLanes: ["left"] }, onExit: () => undefined }));
    expect(pending).not.toContain("taken enemy territory");
    const confirmed = renderToStaticMarkup(createElement(TrainingCoach, { tutorial: { ...inProgress, stage: 2, completed: true, completedStages: 2 }, onExit: () => undefined }));
    expect(confirmed).toContain("taken enemy territory");
    const graduated = renderToStaticMarkup(createElement(TrainingCoach, { tutorial: { ...inProgress, stage: 3, completed: true, completedStages: 3, graduated: true }, onExit: () => undefined }));
    expect(graduated).toContain("Your kingdom awaits!");
    const replay = renderToStaticMarkup(createElement(TrainingCoach, { tutorial: { ...inProgress, completed: true, replay: true, completedStages: 3, graduated: true }, onExit: () => undefined }));
    expect(replay).not.toContain("Well fought");
    expect(replay).not.toContain("Your kingdom awaits");
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

  it("briefs Battle 3 with strategy, commander and ability steps", () => {
    const html = renderToStaticMarkup(createElement(TrainingEntry, { stage: 3, error: null, setupReady: true, onStart: () => undefined }));
    expect(html).toContain("Battle 3 of 3");
    expect(html).toContain("Your First Strategy");
    expect(html).toContain("Build a push");
    expect(html).toContain("Bulwark commander");
    expect(html).toContain("Aegis Wall");
    expect(html).toContain("Start Battle 3");
    expect(html).not.toContain("Destroy an enemy lane tower with your troops");
  });

  it("walks Battle 3 through push, commander and ability using server objective flags", () => {
    const base = { ...inProgress, stage: 3 as const, completedStages: 2 };
    const push = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...base, objectives: [{ id: "build_push", done: false }, { id: "deploy_commander", done: false }, { id: "use_ability", done: false }] },
      onExit: () => undefined,
    }));
    expect(push).toContain("Build a push");
    expect(push).toContain("Chog Guardian");
    expect(push).toContain("Build a two-troop push");
    expect(push).not.toContain("Enter Battle Hall");

    const commander = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...base, objectives: [{ id: "build_push", done: true }, { id: "deploy_commander", done: false }, { id: "use_ability", done: false }] },
      onExit: () => undefined,
    }));
    expect(commander).toContain("deploy your Bulwark commander");
    expect(commander).not.toContain("Build a push. Lead");

    const ability = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...base, objectives: [{ id: "build_push", done: true }, { id: "deploy_commander", done: true }, { id: "use_ability", done: false }] },
      onExit: () => undefined,
    }));
    expect(ability).toContain("Aegis Wall");
    expect(ability).toContain("costs energy");

    const fallen = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...base, objectives: [{ id: "build_push", done: true }, { id: "deploy_commander", done: true }, { id: "use_ability", done: false }] },
      commanderAlive: false,
      onExit: () => undefined,
    }));
    expect(fallen).toContain("deploy it again");
  });

  it("celebrates graduation at 3/3 with Enter Battle Hall and no invented rewards", () => {
    const html = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...inProgress, stage: 3, completed: true, completedStages: 3, graduated: true, objectives: [] },
      onExit: () => undefined,
      onGraduated: () => undefined,
    }));
    expect(html).toContain("Training Camp complete");
    expect(html).toContain("3 of 3");
    expect(html).toContain("Enter Battle Hall");
    expect(html).toContain("Back to Training Camp");
    expect(html).toContain("3/3");
    expect(html).not.toContain("Gold");
    expect(html).not.toContain("trophies awarded");
  });

  it("shows real Chaos copy only when the frame reports one", () => {
    const quiet = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...inProgress, stage: 3, completedStages: 2 },
      onExit: () => undefined,
    }));
    expect(quiet).not.toContain("Chaos warning");

    const warned = renderToStaticMarkup(createElement(TrainingCoach, {
      tutorial: { ...inProgress, stage: 3, completedStages: 2 },
      chaos: { state: "warning", name: "Rift Ford" },
      onExit: () => undefined,
    }));
    expect(warned).toContain("Chaos warning");
    expect(warned).toContain("Rift Ford");
  });
});
