import type { TutorialAccessState } from "./use-tutorial-access";

export type PlayerBattleMode = "private" | "unranked" | "ranked" | "practice";

export type BattleRouteRecovery = "training-required" | "retry" | "sign-in";

export interface BattleRouteAccess {
  /** Mount BattlePanel. Never true for a new session the read can't clear. */
  mountPanel: boolean;
  /** The panel may act: queue, join or resume a saved seat. */
  setupReady: boolean;
  /** What to show. With `mountPanel` it replaces every new-session action, so
   * the panel can only reconnect the saved seat. */
  recovery: BattleRouteRecovery | null;
}

/**
 * The client side of battle admission. A route opens new sessions only on a
 * successful read that allows them, because the server's own admission check
 * fails open during a tutorial outage. A saved seat stays recoverable, since
 * the room checks its resume token and the verified player itself. An expired
 * session can't authenticate that reconnect, so it signs in first and the seat
 * stays saved for the next attempt.
 */
export function battleRouteAccess(read: TutorialAccessState, trainingLocked: boolean, hasSeat: boolean): BattleRouteAccess {
  if (read.state === "loading") return { mountPanel: true, setupReady: false, recovery: null };
  if (read.state === "session") return { mountPanel: false, setupReady: false, recovery: "sign-in" };
  if (read.state === "ready" && !trainingLocked) return { mountPanel: true, setupReady: true, recovery: null };
  const recovery: BattleRouteRecovery = read.state === "ready" ? "training-required" : "retry";
  return { mountPanel: hasSeat, setupReady: hasSeat, recovery };
}

/** Map the player-facing URL to the server-owned battle mode. Unknown modes
 * keep the existing casual default instead of opening a new queue. */
export function resolvePlayerBattleMode(raw: string | null): PlayerBattleMode {
  if (raw === "private" || raw === "ranked" || raw === "practice") return raw;
  return "unranked";
}
