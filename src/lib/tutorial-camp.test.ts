import { describe, expect, it } from "vitest";
import {
  TUTORIAL_CAMP_PATH,
  TUTORIAL_CAPTAIN_LINES,
  tutorialBattlePath,
  tutorialCaptainCopy,
  tutorialIsMandatory,
  tutorialLandingPath,
  tutorialStageAction,
  tutorialStageRouteAllowed,
  type TutorialAccess,
} from "./tutorial-camp";

const required = (completedStages: number) => ({ access: "training-required" as TutorialAccess, completedStages });

describe("first-login landing", () => {
  it("sends a brand new gated player straight to the Battle 1 briefing", () => {
    expect(tutorialLandingPath(required(0), "/app")).toBe("/app/play/training/battle?stage=1");
    expect(tutorialBattlePath(1)).toBe("/app/play/training/battle?stage=1");
  });

  it("resumes 1/3 and 2/3 at the camp", () => {
    expect(tutorialLandingPath(required(1), "/app")).toBe(TUTORIAL_CAMP_PATH);
    expect(tutorialLandingPath(required(2), "/app")).toBe(TUTORIAL_CAMP_PATH);
  });

  it.each<TutorialAccess>(["graduated", "grandfathered", "gate-off", "no-release", "schema-unavailable"])(
    "keeps the normal destination for %s at any stage",
    (access) => {
      for (const completedStages of [0, 1, 2, 3]) {
        expect(tutorialLandingPath({ access, completedStages }, "/app")).toBe("/app");
      }
    },
  );

  it("keeps a valid invite for an eligible player and overrides it for a gated one", () => {
    const invite = "/app/play/battle?mode=private&room=abc_DEF-1";
    expect(tutorialLandingPath({ access: "graduated", completedStages: 3 }, invite)).toBe(invite);
    expect(tutorialLandingPath({ access: "grandfathered", completedStages: 0 }, invite)).toBe(invite);
    expect(tutorialLandingPath(required(0), invite)).toBe(tutorialBattlePath(1));
    expect(tutorialLandingPath(required(2), invite)).toBe(TUTORIAL_CAMP_PATH);
  });

  it("never treats 3/3 as mandatory, even on a stale access value", () => {
    expect(tutorialIsMandatory(required(3))).toBe(false);
    expect(tutorialLandingPath(required(3), "/app")).toBe("/app");
  });
});

describe("mandatory camp progression", () => {
  const row = (completed: number) => [1, 2, 3].map((stage) => tutorialStageAction(required(completed), stage as 1 | 2 | 3));

  it("has exactly one live lesson at each step, and completed lessons are not actionable", () => {
    expect(row(0)).toEqual(["play", "locked", "locked"]);
    expect(row(1)).toEqual(["completed", "play", "locked"]);
    expect(row(2)).toEqual(["completed", "completed", "play"]);
  });

  it("blocks direct URLs to completed and locked lessons", () => {
    expect(tutorialStageRouteAllowed(required(0), 1)).toBe(true);
    expect(tutorialStageRouteAllowed(required(0), 2)).toBe(false);
    expect(tutorialStageRouteAllowed(required(0), 3)).toBe(false);
    expect(tutorialStageRouteAllowed(required(1), 1)).toBe(false);
    expect(tutorialStageRouteAllowed(required(1), 2)).toBe(true);
    expect(tutorialStageRouteAllowed(required(2), 2)).toBe(false);
  });
});

describe("Training Captain dialogue", () => {
  it("speaks each line only at the matching server-confirmed count", () => {
    expect(tutorialCaptainCopy(required(0))).not.toContain("Well fought");
    expect(tutorialCaptainCopy(required(1))).toBe(TUTORIAL_CAPTAIN_LINES[1]);
    expect(tutorialCaptainCopy(required(1))).toContain("Well fought, Chog!");
    expect(tutorialCaptainCopy(required(2))).toBe(TUTORIAL_CAPTAIN_LINES[2]);
    expect(tutorialCaptainCopy({ access: "graduated", completedStages: 3 })).toBe(TUTORIAL_CAPTAIN_LINES[3]);
  });

  it("keeps grandfathered copy until the account really graduates", () => {
    expect(tutorialCaptainCopy({ access: "grandfathered", completedStages: 1 })).toContain("full battle access");
    expect(tutorialCaptainCopy({ access: "grandfathered", completedStages: 3 })).toBe(TUTORIAL_CAPTAIN_LINES[3]);
  });
});

describe("after graduation and for exempt accounts", () => {
  it("restores every replay at 3/3", () => {
    for (const stage of [1, 2, 3] as const) {
      expect(tutorialStageAction({ access: "graduated", completedStages: 3 }, stage)).toBe("replay");
      expect(tutorialStageRouteAllowed({ access: "graduated", completedStages: 3 }, stage)).toBe(true);
    }
  });

  it("keeps the current replay and ladder for a grandfathered player", () => {
    const access = { access: "grandfathered" as TutorialAccess, completedStages: 1 };
    expect(tutorialStageAction(access, 1)).toBe("replay");
    expect(tutorialStageAction(access, 2)).toBe("play");
    expect(tutorialStageAction(access, 3)).toBe("locked");
  });
});
