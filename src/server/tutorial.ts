// Training Camp policy and production services. The gate is default-OFF:
// migrations alone never lock a mode. Enforcement also needs an explicit
// release row, and accounts created before that row's grandfather boundary
// are marked exempt instead of being forced through training.
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  tutorialNextStage,
  type TutorialAccess,
  type TutorialProgressView,
  type TutorialStage,
} from "@/lib/tutorial-camp";
import {
  completeTutorialStage,
  getPlayerCreatedAt,
  getTutorialProgress,
  getTutorialRelease,
  markTutorialGrandfathered,
  tutorialTablesPresent,
} from "@/db/tutorial";
import type { PlayerTutorialProgressRow } from "@/db/schema";

export interface TutorialDecisionInput {
  schemaPresent: boolean;
  enforcementEnabled: boolean;
  release: { enforcedAt: Date; grandfatherBefore: Date } | null;
  playerCreatedAt: Date | null;
  progress: Pick<PlayerTutorialProgressRow, "stage" | "grandfatheredAt"> | null;
}

export interface TutorialDecision {
  access: TutorialAccess;
  allowed: boolean;
  markGrandfathered: boolean;
  completedStages: number;
  graduated: boolean;
  grandfathered: boolean;
}

/** Pure access decision, so the release and grandfather rules are testable. */
export function decideTutorialAccess(input: TutorialDecisionInput): TutorialDecision {
  const completedStages = Math.max(0, Math.min(3, input.progress?.stage ?? 0));
  const graduated = completedStages >= 3;
  const grandfathered = Boolean(input.progress?.grandfatheredAt);
  const denied = (access: TutorialAccess, markGrandfathered = false): TutorialDecision => ({
    access,
    allowed: false,
    markGrandfathered,
    completedStages,
    graduated,
    grandfathered,
  });
  const allowed = (access: TutorialAccess, markGrandfathered = false): TutorialDecision => ({
    access,
    allowed: true,
    markGrandfathered,
    completedStages,
    graduated,
    grandfathered,
  });

  if (!input.schemaPresent) return allowed(input.enforcementEnabled ? "schema-unavailable" : "gate-off");
  if (!input.enforcementEnabled) return allowed("gate-off");
  if (!input.release) return allowed("no-release");
  if (graduated) return allowed("graduated");
  if (grandfathered) return allowed("grandfathered");
  if (input.playerCreatedAt && input.playerCreatedAt.getTime() < input.release.grandfatherBefore.getTime()) {
    return allowed("grandfathered", true);
  }
  return denied("training-required");
}

function enforcementEnabled(): boolean {
  return getEnv().TUTORIAL_ENFORCEMENT_ENABLED === "1";
}

function view(completedStages: number, access: TutorialAccess, graduated: boolean, grandfathered: boolean): TutorialProgressView {
  const stage = Math.max(0, Math.min(3, completedStages));
  return {
    stage,
    completedStages: stage,
    graduated,
    grandfathered,
    nextStage: tutorialNextStage(stage),
    enforcement: access !== "gate-off",
    access,
  };
}

/** Read the player-facing snapshot. Missing tables are explicit, never 0/3. */
export async function getTutorialSnapshot(playerId: string): Promise<TutorialProgressView> {
  const enforcement = enforcementEnabled();
  const schemaPresent = await tutorialTablesPresent();
  if (!schemaPresent) {
    return view(0, enforcement ? "schema-unavailable" : "gate-off", false, false);
  }
  const [release, playerCreatedAt, progress] = await Promise.all([
    getTutorialRelease(),
    getPlayerCreatedAt(playerId),
    getTutorialProgress(playerId),
  ]);
  const decision = decideTutorialAccess({ schemaPresent, enforcementEnabled: enforcement, release, playerCreatedAt, progress });
  if (decision.markGrandfathered) {
    try {
      const marked = await markTutorialGrandfathered(playerId);
      return view(marked.stage, "grandfathered", marked.stage >= 3, Boolean(marked.grandfatheredAt));
    } catch (err) {
      logger.error("tutorial grandfather write failed", { playerId, reason: err instanceof Error ? err.message : String(err) });
      return view(decision.completedStages, "schema-unavailable", decision.graduated, false);
    }
  }
  return view(decision.completedStages, decision.access, decision.graduated, decision.grandfathered);
}

export interface TutorialAdmission {
  allowed: boolean;
  access: TutorialAccess;
}

/** Admission check for new battle joins. Old matches are handled before this. */
export async function getTutorialAdmission(playerId: string): Promise<TutorialAdmission> {
  if (!enforcementEnabled()) return { allowed: true, access: "gate-off" };
  const snapshot = await getTutorialSnapshot(playerId);
  return { allowed: snapshot.access === "graduated" || snapshot.access === "grandfathered" || snapshot.access === "gate-off" || snapshot.access === "no-release" || snapshot.access === "schema-unavailable", access: snapshot.access };
}

export interface TutorialCompletionView {
  status: "completed" | "already-complete" | "out-of-order" | "unavailable";
  stage: TutorialStage;
  completedStages: number;
  graduated: boolean;
}

export async function completeTutorialStageForPlayer(playerId: string, stage: TutorialStage): Promise<TutorialCompletionView> {
  try {
    const result = await completeTutorialStage(playerId, stage);
    const completedStages = result.progress?.stage ?? (result.status === "already-complete" ? stage : 0);
    return {
      status: result.status,
      stage,
      completedStages: Math.max(0, Math.min(3, completedStages)),
      graduated: completedStages >= 3,
    };
  } catch (err) {
    logger.error("tutorial completion failed", { playerId, stage, reason: err instanceof Error ? err.message : String(err) });
    return { status: "unavailable", stage, completedStages: 0, graduated: false };
  }
}

export interface TutorialDeps {
  admission(playerId: string): Promise<TutorialAdmission>;
  progress(playerId: string): Promise<TutorialProgressView>;
  complete(playerId: string, stage: TutorialStage): Promise<TutorialCompletionView>;
}

export const productionTutorialDeps: TutorialDeps = {
  admission: getTutorialAdmission,
  progress: getTutorialSnapshot,
  complete: completeTutorialStageForPlayer,
};
