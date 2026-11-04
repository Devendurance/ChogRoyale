// Training Camp contract. Safe for client and server: no DB imports and no
// authoritative completion logic. The server owns progress and completion;
// this file only names the fixed teaching loadout and the display contract.

export const TUTORIAL_CAMP_PATH = "/app/play/training";
export const tutorialBattlePath = (stage: TutorialStage) => `${TUTORIAL_CAMP_PATH}/battle?stage=${stage}`;
export const TUTORIAL_COACH_NAME = "Training Captain";

export const TUTORIAL_STAGE_IDS = [1, 2, 3] as const;
export type TutorialStage = (typeof TUTORIAL_STAGE_IDS)[number];

export function isTutorialStage(value: unknown): value is TutorialStage {
  return value === 1 || value === 2 || value === 3;
}

export interface TutorialStageDefinition {
  stage: TutorialStage;
  title: string;
  objective: string;
  summary: string;
  playable: boolean;
}

/** Stage 1 is playable now. Stages 2 and 3 are the next Training Camp slices. */
export const TUTORIAL_STAGES: readonly TutorialStageDefinition[] = [
  {
    stage: 1,
    title: "First Deployment",
    objective: "Deploy your first troop",
    summary: "Pick a troop card, then tap or drag onto your side of the arena.",
    playable: true,
  },
  {
    stage: 2,
    title: "Towers & Territory",
    objective: "Break a tower and use the new ground",
    summary: "Learn lanes, bridges, crowns and the forward deployment a fallen tower unlocks.",
    playable: false,
  },
  {
    stage: 3,
    title: "Your First Strategy",
    objective: "Build a push and use your commander",
    summary: "Balance offense and defense, time energy and learn the real Chaos rules.",
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
