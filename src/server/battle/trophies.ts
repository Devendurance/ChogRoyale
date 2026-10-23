// P1b.2 trophy award processing on the settlement lifecycle.
//
// The room stays a courier: after the service confirms a durable settle, the
// trophy pass runs and its outcome never changes the reported settlement
// status. A trophy failure is logged for reconcile, never presented as a
// successful award, and never invalidates the settled battle record.
import { logger } from "@/lib/logger";
import { awardRankedMatch, reconcileRankedTrophies } from "@/db/ranked";
import { RANKED_SEASON } from "@/lib/ranked";

export class TrophyService {
  constructor(private readonly season: number = RANKED_SEASON) {}

  /** Award one settled match. No-op for non-ranked matches. Never throws. */
  async processMatch(matchId: string): Promise<void> {
    try {
      const r = await awardRankedMatch(matchId, this.season);
      if (r.status === "awarded") logger.info("ranked trophies awarded", { matchId, applied: r.applied });
    } catch (err) {
      // The battle record stands; reconcile retries this match later.
      logger.error("ranked trophy award failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Finish matches whose awards are missing or were interrupted. Never throws. */
  async reconcile(limit?: number): Promise<void> {
    try {
      const r = await reconcileRankedTrophies(limit, this.season);
      if (r.processed > 0) logger.info("ranked trophy reconcile", { processed: r.processed, awarded: r.awarded });
    } catch (err) {
      logger.error("ranked trophy reconcile failed", { reason: err instanceof Error ? err.message : String(err) });
    }
  }
}
