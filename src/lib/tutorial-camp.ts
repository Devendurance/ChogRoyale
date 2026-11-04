// Training Camp contract. Safe for client and server: no DB imports and no
// authoritative completion logic. The server owns progress and completion;
// this file only names the fixed teaching loadout and the display contract.

export const TUTORIAL_CAMP_PATH = "/app/play/training";
export const tutorialBattlePath = (stage: TutorialStage) => `${TUTORIAL_CAMP_PATH}/battle?stage=${stage}`;
export const TUTORIAL_COACH_NAME = "Training Captain";

export const TUTORIAL_STAGE_IDS = [1, 2, 3] as const;
export type TutorialStage = (typeof TUTORIAL_STAGE_IDS)[number];
export type TutorialLane = "left" | "right";

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

/** Stage 1 and 2 are playable now. Stage 3 is the next Training Camp slice. */
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
    objective: "Build a push and use your commander",
    summary: "Balance offense and defense, time energy and learn the real Chaos rules.",
    steps: [
      "Build a balanced push.",
      "Use your commander and its ability.",
      "React to Chaos and finish the battle.",
    ],
    completion: "The final guided battle completes Training Camp.",
    playable: false,
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
}

export function tutorialNextStage(completedStages: number): TutorialStage | null {
  if (completedStages < 1) return 1;
  if (completedStages < 2) return 2;
  if (completedStages < 3) return 3;
  return null;
}

export function tutorialProgressLabel(completedStages: number): string {
  return `${Math.max(0, Math.min(TUTORIAL_TOTAL_STAGES, completedStages))}/${TUTORIAL_TOTAL_STAGES}`;
}
