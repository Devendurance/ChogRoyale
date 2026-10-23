// P2b Gold earn processing on the settlement lifecycle.
//
// Earn rows are staged idempotently per (match, player) right after the
// service confirms a durable settle; a repeat stage is a no-op because of
// the ledger primary key. Reconciliation re-stages any settled eligible
// match whose earn count is short. Balances are derived (earned minus
// spent), so an earn failure mode is limited to a missing row that
// reconcile refills; failures never change the settlement status and never
// invalidate the settled battle record.
import { logger } from "@/lib/logger";
import {
  getGoldAwardableMatch,
  goldEarnForResult,
  reconcileGoldEarn,
  stageGoldEarn,
} from "@/db/gold";

async function awardOne(matchId: string): Promise<{ status: "awarded" | "already-awarded" | "skipped" }> {
  const gate = await getGoldAwardableMatch(matchId);
  if (!gate.ok) return { status: "skipped" };
  const { staged } = await stageGoldEarn(
    matchId,
    gate.seats.map((s) => ({ playerId: s.playerId, amount: goldEarnForResult(s.result), result: s.result }))
  );
  return { status: staged > 0 ? "awarded" : "already-awarded" };
}

export class GoldService {
  /** Stage earn rows for one settled match. No-op for ineligible matches. Never throws. */
  async processMatch(matchId: string): Promise<void> {
    try {
      const r = await awardOne(matchId);
      if (r.status === "awarded") logger.info("gold earned", { matchId });
    } catch (err) {
      logger.error("gold earn failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Re-stage any settled eligible match with a short earn ledger. Never throws. */
  async reconcile(limit?: number): Promise<void> {
    try {
      const r = await reconcileGoldEarn(limit, async (id) => awardOne(id));
      if (r.processed > 0) logger.info("gold earn reconcile", { processed: r.processed, awarded: r.awarded });
    } catch (err) {
      logger.error("gold earn reconcile failed", { reason: err instanceof Error ? err.message : String(err) });
    }
  }
}
