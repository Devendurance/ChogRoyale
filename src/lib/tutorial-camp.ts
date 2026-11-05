// Training Camp contract. Safe for client and server: no DB imports and no
// authoritative completion logic. The server owns progress and completion;
// this file only names the fixed teaching loadout and the display contract.

export const TUTORIAL_CAMP_PATH = "/app/play/training";
export const TUTORIAL_BATTLE_HALL_PATH = "/app/play";
export const tutorialBattlePath = (stage: TutorialStage) => `${TUTORIAL_CAMP_PATH}/battle?stage=${stage}`;
export const TUTORIAL_COACH_NAME = "Training Captain";

export const TUTORIAL_STAGE_IDS = [1, 2, 3] as const;
export type TutorialStage = (typeof TUTORIAL_STAGE_IDS)[number];
export type TutorialLane = "left" | "right";

/** One server-verified lesson step. The room sets `done`, never the client. */
export type TutorialObjectiveId =
  | "first_troop_deploy"
  | "destroy_enemy_tower"
  | "deploy_in_pocket"
  | "build_push"
  | "deploy_commander"
  | "use_ability";

export interface TutorialObjective {
  id: TutorialObjectiveId;
  done: boolean;
}

export const TUTORIAL_OBJECTIVE_LABELS: Record<TutorialObjectiveId, string> = {
  first_troop_deploy: "Deploy your first troop",
  destroy_enemy_tower: "Destroy an enemy tower",
  deploy_in_pocket: "Deploy into the new ground",
  build_push: "Build a two-troop push",
  deploy_commander: "Deploy your commander",
  use_ability: "Use a commander ability",
};

export function isTutorialStage(value: unknown): value is TutorialStage {
  return value === 1 || value === 2 || value === 3;
}

export interface TutorialStageDefinition {
  stage: TutorialStage;
  title: string;
  objective: string;
  summary: string;
  steps: readonly string[];
  completion: string;
  playable: boolean;
}

/** Stage 1, 2 and 3 are playable. */
export const TUTORIAL_STAGES: readonly TutorialStageDefinition[] = [
  {
    stage: 1,
    title: "First Deployment",
    objective: "Deploy your first troop",
    summary: "Pick a troop card, then tap or drag onto your side of the arena.",
    steps: [
      "Tap a troop card in your hand.",
      "Tap or drag onto the glowing band on your side of the arena.",
      "Your first accepted troop deployment completes this lesson.",
    ],
    completion: "Your first accepted troop deployment completes this lesson.",
    playable: true,
  },
  {
    stage: 2,
    title: "Towers & Territory",
    objective: "Destroy a tower and use the new ground",
    summary: "Cross a bridge, defend your own towers, break an enemy tower and deploy into the new pocket.",
    steps: [
      "Push a lane across a bridge and defend your own towers.",
      "Destroy an enemy lane tower with your troops.",
      "Deploy a troop inside the glowing new ground.",
    ],
    completion: "An accepted troop deployment inside the new pocket completes this lesson.",
    playable: true,
  },
  {
    stage: 3,
    title: "Your First Strategy",
    objective: "Build a push, deploy your commander and use its ability",
    summary: "Lead with a durable troop, add damage behind it, then commit your commander and its ability.",
    steps: [
      "Build a push: deploy a durable troop, then supporting damage behind it.",
      "Deploy your Bulwark commander to anchor the lane.",
      "Use Aegis Wall while the fight is joined, then watch for Chaos warnings.",
    ],
    completion: "A real push, a real commander deployment and a real active ability complete Training Camp.",
    playable: true,
  },
];

export const TUTORIAL_TOTAL_STAGES = TUTORIAL_STAGES.length;

/** Fixed teaching loadout. The server ignores any client-supplied cards. */
export const TUTORIAL_READY = {
  cards: ["choglings", "rift_sprites", "chaos_archer", "chog_guardian", "decoy_totem", "rift_snare", "sparkcaster"],
  commander: { kind: "free", class: "bulwark" },
} as const;

export type TutorialAccess =
  | "gate-off"
  | "no-release"
  | "graduated"
  | "grandfathered"
  | "training-required"
  | "schema-unavailable";

export interface TutorialProgressView {
  /** Number of completed stages, 0 to 3. */
  stage: number;
  completedStages: number;
  graduated: boolean;
  grandfathered: boolean;
  nextStage: TutorialStage | null;
  enforcement: boolean;
  access: TutorialAccess;
}

/** Sent on start and again when the current stage is completed. */
export interface TutorialMessage {
  stage: TutorialStage;
  objective: string;
  completed: boolean;
  /** True when this room is replaying an already completed stage. */
  replay: boolean;
  completedStages: number;
  graduated: boolean;
  /** Enemy lane towers that have already fallen in this tutorial battle. */
  towerLanes: TutorialLane[];
  /** Server-verified lesson steps for the current stage. */
  objectives: TutorialObjective[];
}

export function tutorialNextStage(completedStages: number): TutorialStage | null {
  if (completedStages < 1) return 1;
  if (completedStages < 2) return 2;
  if (completedStages < 3) return 3;
  return null;
}

/** True only while the server says this account must still graduate. */
export function tutorialIsMandatory(tutorial: Pick<TutorialProgressView, "access" | "completedStages">): boolean {
  return tutorial.access === "training-required" && tutorial.completedStages < TUTORIAL_TOTAL_STAGES;
}

/**
 * Where an authenticated, fully set up player lands. Only the server-owned
 * access decides: 0/3 goes straight to the Battle 1 briefing, 1/3 and 2/3 resume
 * at the camp, and every other access keeps the caller's normal destination.
 */
export function tutorialLandingPath(tutorial: Pick<TutorialProgressView, "access" | "completedStages">, normalPath: string): string {
  if (!tutorialIsMandatory(tutorial)) return normalPath;
  return tutorial.completedStages < 1 ? tutorialBattlePath(1) : TUTORIAL_CAMP_PATH;
}

export type TutorialStageAction = "play" | "replay" | "completed" | "locked";

/** What one camp row offers. Mandatory training has exactly one live lesson. */
export function tutorialStageAction(tutorial: Pick<TutorialProgressView, "access" | "completedStages">, stage: TutorialStage): TutorialStageAction {
  const complete = tutorial.completedStages >= stage;
  if (tutorialIsMandatory(tutorial)) {
    if (complete) return "completed";
    return tutorial.completedStages === stage - 1 ? "play" : "locked";
  }
  if (complete) return "replay";
  return tutorial.completedStages >= stage - 1 ? "play" : "locked";
}

/** A direct stage URL may only open what the camp row would offer. */
export function tutorialStageRouteAllowed(tutorial: Pick<TutorialProgressView, "access" | "completedStages">, stage: TutorialStage): boolean {
  const action = tutorialStageAction(tutorial, stage);
  return action === "play" || action === "replay";
}

/** Captain dialogue. Callers pass only server-confirmed progress. */
export const TUTORIAL_CAPTAIN_LINES: Record<TutorialStage, string> = {
  1: "Well fought, Chog! You've learned how to deploy your troops. Now let's see what happens when you break through enemy defenses.",
  2: "You've taken enemy territory! One final lesson remains. Time to lead your troops like a true commander.",
  3: "Congratulations, Chog! You've mastered the basics of battle. Your kingdom awaits!",
};

/** The camp's Captain line. It reads only the server's confirmed stage count. */
export function tutorialCaptainCopy(tutorial: Pick<TutorialProgressView, "access" | "completedStages">): string {
  const completed = Math.min(TUTORIAL_TOTAL_STAGES, tutorial.completedStages);
  if (isTutorialStage(completed) && (completed === TUTORIAL_TOTAL_STAGES || tutorial.access !== "grandfathered")) {
    return TUTORIAL_CAPTAIN_LINES[completed];
  }
  if (tutorial.access === "grandfathered") return "Your account already has full battle access. You can replay the lessons any time.";
  if (tutorial.access === "training-required") return "Complete Training Camp to unlock the other battle modes. Battle 1 is ready now.";
  return "Three short battles teach the real controls. Battle 1 is ready now, and every lesson is checked by the server.";
}

export function tutorialProgressLabel(completedStages: number): string {
  return `${Math.max(0, Math.min(TUTORIAL_TOTAL_STAGES, completedStages))}/${TUTORIAL_TOTAL_STAGES}`;
}
