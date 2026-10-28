// V2.1g bot Gold award service. Verifies stored one-human/one-bot evidence
// by independent replay, enforces the versioned policy gates, and stages the
// idempotent award with a transactional UTC-day cap. Never touches the PvP
// settlement writer, matches, match_participants, card XP, trophies or
// legacy. Solo Practice never reaches this service.

import { runMatch, isAbilityCommand, isCommanderCard } from "@/lib/combat";
import { logger } from "@/lib/logger";
import {
  BOT_GOLD_DAILY_CAP,
  BOT_GOLD_POLICY_VERSION,
  botGoldForResult,
  botGoldGate,
  type BotGoldResult,
} from "@/lib/bot-gold";
import {
  countBotGoldToday,
  getBotMatchEvidence,
  markBotMatchStatus,
  pendingBotMatches,
  recordBotMatchEvidence,
  stageBotGoldAward,
  type BotMatchEvidence,
} from "@/db/bot-gold";

export interface BotGoldServiceDeps {
  /** Test hook for the evidence clock; defaults to the real clock. */
  now?: () => Date;
}

let shared: BotGoldService | null = null;
/** Process-wide bot Gold service. PracticeRoom and the sweeper share it. */
export function botGoldService(): BotGoldService {
  return (shared ??= new BotGoldService());
}

export class BotGoldService {
  constructor(private readonly deps: BotGoldServiceDeps = {}) {}
  private sweeper: ReturnType<typeof setInterval> | null = null;

  /** Retry pending evidence periodically. Safe to call repeatedly. */
  startSweeper(intervalMs = 60_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.reconcile().catch((err) => logger.error("bot gold reconcile failed", { reason: err instanceof Error ? err.message : String(err) }));
    }, intervalMs);
    if (typeof this.sweeper.unref === "function") this.sweeper.unref();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** Store one finished fallback match's evidence, then award. Never throws. */
  async processEvidence(ev: BotMatchEvidence): Promise<BotGoldResult> {
    const base = { matchId: ev.matchId, source: "unranked-fallback" as const, policyVersion: BOT_GOLD_POLICY_VERSION, dailyCap: BOT_GOLD_DAILY_CAP };
    try {
      await recordBotMatchEvidence(ev);
    } catch (err) {
      logger.error("bot gold evidence failed", { matchId: ev.matchId, reason: err instanceof Error ? err.message : String(err) });
      return { ...base, eligibility: "replay-mismatch", amount: 0, status: "pending", rewardedToday: await countBotGoldToday(ev.playerId).catch(() => 0) };
    }
    return this.processMatch(ev.matchId);
  }

  /** Verify stored evidence and stage the award. Never throws. */
  async processMatch(matchId: string): Promise<BotGoldResult> {
    const base = { matchId, source: "unranked-fallback" as const, policyVersion: BOT_GOLD_POLICY_VERSION, dailyCap: BOT_GOLD_DAILY_CAP };
    const zeroToday = { rewardedToday: 0 };
    try {
      const ev = await getBotMatchEvidence(matchId);
      if (!ev || ev.source !== "unranked-fallback") {
        return { ...base, ...zeroToday, eligibility: "practice-earns-zero", amount: 0, status: "refused" };
      }
      // Independent replay of the stored command stream.
      const config = ev.config as Parameters<typeof runMatch>[0];
      const commands = ev.commands as Parameters<typeof runMatch>[1];
      const replay = runMatch(config, commands);
      if (
        replay.result.stateHash !== ev.liveHash ||
        replay.result.stateHash !== ev.replayHash ||
        replay.result.winner !== (ev.winnerSeat === null ? "draw" : (ev.winnerSeat as 0 | 1)) ||
        replay.result.ticks !== ev.ticks
      ) {
        await markBotMatchStatus(matchId, "refused");
        return { ...base, ...zeroToday, eligibility: "replay-mismatch", amount: 0, status: "refused" };
      }
      const rejected = new Set(
        replay.state.events
          .filter((e): e is Extract<typeof e, { type: "command_rejected" }> => e.type === "command_rejected")
          .filter((e) => (e.player ?? -1) === ev.humanSeat)
          .map((e) => e.seq)
      );
      const acceptedDeploys = commands.filter(
        (c) => !isAbilityCommand(c) && c.player === ev.humanSeat && !isCommanderCard(c.cardId) && !rejected.has(c.seq)
      ).length;
      const gate = botGoldGate(replay.result.ticks, acceptedDeploys);
      if (gate !== "eligible") {
        await markBotMatchStatus(matchId, "refused");
        return { ...base, ...zeroToday, eligibility: gate, amount: 0, status: "refused" };
      }
      const humanSeat = ev.humanSeat as 0 | 1;
      const result = replay.result.winner === "draw" ? "draw" : replay.result.winner === humanSeat ? "win" : "loss";
      const amount = botGoldForResult(result);
      const staged = await stageBotGoldAward({
        matchId,
        playerId: ev.playerId,
        amount,
        result,
        difficulty: ev.difficulty as "medium" | "hard",
        policyVersion: BOT_GOLD_POLICY_VERSION,
      });
      if (staged.status === "capped") {
        await markBotMatchStatus(matchId, "capped");
        return { ...base, eligibility: "capped", amount: 0, status: "capped", rewardedToday: staged.rewardedToday };
      }
      await markBotMatchStatus(matchId, "awarded");
      // A duplicate is the idempotent replay of an already-confirmed award:
      // same confirmed amount, never a second row.
      if (staged.status === "duplicate") {
        return { ...base, eligibility: "duplicate", amount, status: "confirmed", rewardedToday: staged.rewardedToday };
      }
      return {
        ...base,
        eligibility: "eligible",
        amount,
        status: "confirmed",
        rewardedToday: staged.rewardedToday,
      };
    } catch (err) {
      logger.error("bot gold award failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
      return { ...base, ...zeroToday, eligibility: "replay-mismatch", amount: 0, status: "pending" };
    }
  }

  /** Award every pending evidence row (restart + failure recovery). Never throws. */
  async reconcile(limit = 50): Promise<{ processed: number; awarded: number }> {
    try {
      const rows = await pendingBotMatches(limit);
      let awarded = 0;
      for (const r of rows) {
        const out = await this.processMatch(r.matchId);
        if (out.status === "confirmed") awarded += 1;
      }
      if (rows.length > 0) logger.info("bot gold reconcile", { processed: rows.length, awarded });
      return { processed: rows.length, awarded };
    } catch (err) {
      logger.error("bot gold reconcile failed", { reason: err instanceof Error ? err.message : String(err) });
      return { processed: 0, awarded: 0 };
    }
  }
}
