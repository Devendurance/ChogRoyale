// P2a card XP award processing on the settlement lifecycle.
//
// Evidence source: the verified replay evidence already stored for the
// match. Deploy commands carry the seat (player) and card id in seq order;
// re-running the verified config through runMatch reproduces the exact
// command_rejected set, so only accepted deployments of ordinary cards
// count. Deck membership alone never earns XP, one player's usage is never
// attributed to the opponent, and commander identities earn nothing.
//
// The room stays a courier: after the service confirms a durable settle,
// the XP pass runs and its outcome never changes the reported settlement
// status. An XP failure is logged for reconcile, never presented as a
// successful award, and never invalidates the settled battle record.
import { logger } from "@/lib/logger";
import { CARDS_V1, isAbilityCommand, runMatch, type CombatCommand, type CombatConfig } from "@/lib/combat";
import {
  CARD_XP_MATCH_TOTAL_CAP,
  CARD_XP_PER_CARD_MATCH_CAP,
  CARD_XP_PER_DEPLOY,
  CARD_XP_POLICY_VERSION,
} from "@/lib/card-xp";
import {
  applyCardXp,
  getAwardableMatch,
  reconcileCardXp,
  stageCardXp,
  type CardUsageUnit,
} from "@/db/card-xp";

export interface EvidenceLike {
  formatVersion: number;
  config: CombatConfig;
  commands: CombatCommand[];
}

/**
 * Count accepted ordinary-card deployments per player. Pure and
 * deterministic: rejected seqs, ability commands, commander cards,
 * spawned-only ids and unknown ids earn nothing, usage is never
 * attributed across players, and per-card plus per-player caps bound
 * farming inside one match.
 */
export function countDeployments(
  commands: CombatCommand[],
  rejected: Set<number>,
  players: [{ playerId: string }, { playerId: string }]
): CardUsageUnit[] {
  const counts = new Map<string, Map<string, number>>();
  const bump = (playerId: string, cardId: string) => {
    let m = counts.get(playerId);
    if (!m) counts.set(playerId, (m = new Map()));
    m.set(cardId, (m.get(cardId) ?? 0) + 1);
  };
  for (const cmd of commands) {
    if (isAbilityCommand(cmd)) continue;
    if (rejected.has(cmd.seq)) continue;
    if (!CARDS_V1[cmd.cardId]) continue;
    const owner = players[cmd.player];
    if (!owner) continue;
    bump(owner.playerId, cmd.cardId);
  }
  // Deterministic caps: per-card cap first, then a bounded total per player
  // in cardId order so repeat farming in one match cannot spike progress.
  const units: CardUsageUnit[] = [];
  for (const [playerId, m] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let remaining = CARD_XP_MATCH_TOTAL_CAP;
    for (const cardId of [...m.keys()].sort()) {
      if (remaining <= 0) break;
      const deployments = Math.min(m.get(cardId)!, CARD_XP_PER_CARD_MATCH_CAP, remaining);
      remaining -= deployments;
      units.push({ playerId, cardId, deployments, xp: deployments * CARD_XP_PER_DEPLOY });
    }
  }
  return units;
}

/**
 * Replay verified evidence and count accepted usage. The evidence hash was
 * already verified before settlement; the replay reproduces the exact
 * command_rejected set, so only genuinely deployed cards count.
 */
export function extractCardUsage(evidence: EvidenceLike, players: [{ playerId: string }, { playerId: string }]): CardUsageUnit[] {
  const { state } = runMatch(evidence.config, evidence.commands);
  const rejected = new Set<number>();
  for (const e of state.events) {
    if (e.type === "command_rejected" && typeof (e as { seq?: unknown }).seq === "number") {
      rejected.add((e as { seq: number }).seq);
    }
  }
  return countDeployments(evidence.commands, rejected, players);
}

export type CardXpStatus = "awarded" | "already-awarded" | "skipped";

async function awardOne(matchId: string): Promise<{ status: CardXpStatus; units: number }> {
  const gate = await getAwardableMatch(matchId);
  if (!gate.ok) return { status: "skipped", units: 0 };
  const { match, match: { evidence } } = gate;
  let usage: CardUsageUnit[];
  try {
    usage = extractCardUsage(
      { formatVersion: evidence.formatVersion, config: evidence.config as CombatConfig, commands: evidence.commands as CombatCommand[] },
      match.players
    );
  } catch (err) {
    logger.error("card xp extraction failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
    return { status: "skipped", units: 0 };
  }
  const status = usage.length === 0 ? ("no-eligible" as const) : ("done" as const);
  await stageCardXp(matchId, usage, status, { policyVersion: CARD_XP_POLICY_VERSION, matchType: match.matchType });
  const applied = await applyCardXp(matchId);
  return { status: applied.applied ? "awarded" : "already-awarded", units: applied.units };
}

export class CardXpService {
  /** Award one settled match. No-op for ineligible matches. Never throws. */
  async processMatch(matchId: string): Promise<void> {
    try {
      const r = await awardOne(matchId);
      if (r.status === "awarded") logger.info("card xp awarded", { matchId, units: r.units });
    } catch (err) {
      logger.error("card xp award failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Finish matches whose runs are missing or were interrupted. Never throws. */
  async reconcile(limit?: number): Promise<void> {
    try {
      const r = await reconcileCardXp(limit, async (id) => awardOne(id));
      if (r.processed > 0) logger.info("card xp reconcile", { processed: r.processed, awarded: r.awarded });
    } catch (err) {
      logger.error("card xp reconcile failed", { reason: err instanceof Error ? err.message : String(err) });
    }
  }
}
