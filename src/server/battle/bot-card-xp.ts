// V2.1i Verified Unranked AI Card XP. Awards verified bot matches a small
// per-card XP amount into the shared card_xp_progress ladder via the
// canonical recompute (both ledgers), so bot and PvP XP compose instead of
// competing. Only matches with a confirmed bot Gold award earn XP, which
// shares the Gold daily allowance without a second cap. Pre-flag historical
// matches are permanently ineligible. Solo Practice never reaches this
// service. Never throws.
import { isAbilityCommand, isCommanderCard, runMatch, type CombatCommand } from "@/lib/combat";
import { CARDS_V1 } from "@/lib/combat";
import { logger } from "@/lib/logger";
import {
  BOT_CARD_XP_POLICY_VERSION,
  allocateBotCardXp,
  type BotCardXpResult,
} from "@/lib/bot-card-xp";
import { getBotMatchEvidence } from "@/db/bot-gold";
import {
  claimBotXpRun,
  getBotGoldAward,
  getBotXpAwards,
  getBotXpRun,
  markBotXpRun,
  pendingBotXpMatches,
  stageBotCardXp,
} from "@/db/bot-card-xp";
import { applyCardXpTotals } from "@/db/card-xp";
import { BOT_GOLD_DAILY_CAP, BOT_GOLD_MIN_HUMAN_DEPLOYS, BOT_GOLD_MIN_TICKS } from "@/lib/bot-gold";
import { countBotGoldToday } from "@/db/bot-gold";

export interface BotXpGateOutcome {
  accepted: Map<string, number>;
  totalDeploys: number;
}

/**
 * Accepted human ordinary-card deployments per card from verified evidence.
 * Mirrors the PvP accepted-deploy rules exactly: rejected seqs, abilities,
 * commanders, spawned-only and unknown ids earn nothing; usage is never
 * attributed to the opponent; the human seat comes from server evidence.
 */
export function extractBotDeployments(
  commands: CombatCommand[],
  rejected: Set<number>,
  humanSeat: 0 | 1
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cmd of commands) {
    if (isAbilityCommand(cmd)) continue;
    if (rejected.has(cmd.seq)) continue;
    if (cmd.player !== humanSeat) continue;
    if (isCommanderCard(cmd.cardId)) continue;
    if (!CARDS_V1[cmd.cardId]) continue;
    counts.set(cmd.cardId, (counts.get(cmd.cardId) ?? 0) + 1);
  }
  return counts;
}

export async function verifyBotEvidence(matchId: string): Promise<
  | { ok: false; reason: "missing" | "not-xp-eligible" | "replay-mismatch" | "short-match" }
  | { ok: true; evidence: NonNullable<Awaited<ReturnType<typeof getBotMatchEvidence>>>; accepted: Map<string, number> }
> {
  const ev = await getBotMatchEvidence(matchId);
  if (!ev) return { ok: false, reason: "missing" };
  if (ev.source !== "unranked-fallback" || !ev.xpEligible) return { ok: false, reason: "not-xp-eligible" };
  const config = ev.config as Parameters<typeof runMatch>[0];
  const commands = ev.commands as Parameters<typeof runMatch>[1];
  const replay = runMatch(config, commands);
  if (
    replay.result.stateHash !== ev.liveHash ||
    replay.result.stateHash !== ev.replayHash ||
    replay.result.winner !== (ev.winnerSeat === null ? "draw" : (ev.winnerSeat as 0 | 1)) ||
    replay.result.ticks !== ev.ticks
  ) {
    return { ok: false, reason: "replay-mismatch" };
  }
  if (replay.result.ticks < 600) return { ok: false, reason: "short-match" };
  const rejected = new Set(
    replay.state.events
      .filter((e): e is Extract<typeof e, { type: "command_rejected" }> => e.type === "command_rejected")
      .filter((e) => (e.player ?? -1) === ev.humanSeat)
      .map((e) => e.seq)
  );
  const accepted = extractBotDeployments(commands, rejected, ev.humanSeat as 0 | 1);
  return { ok: true, evidence: ev, accepted };
}

export class BotCardXpService {
  private sweeper: ReturnType<typeof setInterval> | null = null;

  /** Retry pending bot XP evidence periodically. Safe to call repeatedly. */
  startSweeper(intervalMs = 60_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.reconcile().catch((err) => logger.error("bot card xp reconcile failed", { reason: err instanceof Error ? err.message : String(err) }));
    }, intervalMs);
    if (typeof this.sweeper.unref === "function") this.sweeper.unref();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** Award one verified fallback match. Never throws. */
  async processMatch(matchId: string): Promise<BotCardXpResult> {
    const base = { matchId, source: "unranked-fallback" as const, policyVersion: BOT_CARD_XP_POLICY_VERSION, dailyCap: BOT_GOLD_DAILY_CAP };
    const rewardedTodayOf = (playerId: string) => countBotGoldToday(playerId).catch(() => 0);
    try {
      const verified = await verifyBotEvidence(matchId);
      if (!verified.ok) {
        const eligibility = verified.reason === "missing" ? "practice-earns-zero" : verified.reason;
        return { ...base, eligibility, totalXp: 0, awardedCards: [], status: "refused", rewardedToday: 0 };
      }
      const { evidence: ev, accepted } = verified;
      const playerId = ev.playerId;
      const existing = await getBotXpRun(matchId, playerId);
      if (existing && existing.status !== "pending") {
        if (existing.status === "done") {
          const rows = await getBotXpAwards(matchId, playerId);
          const awardedCards = rows.map((r) => ({ cardId: r.cardId, deployments: r.deployments, xp: r.xp }));
          return {
            ...base,
            eligibility: "duplicate",
            totalXp: awardedCards.reduce((s, u) => s + u.xp, 0),
            awardedCards,
            status: "confirmed",
            rewardedToday: await rewardedTodayOf(playerId),
          };
        }
        if (existing.status === "capped") {
          return { ...base, eligibility: "capped", totalXp: 0, awardedCards: [], status: "capped", rewardedToday: await rewardedTodayOf(playerId) };
        }
        const prior = (existing.details as { reason?: unknown } | null)?.reason;
        const eligibility = prior === "short-match" || prior === "too-few-deploys" || prior === "replay-mismatch" || prior === "not-xp-eligible" || prior === "practice-earns-zero" ? prior : "replay-mismatch";
        return { ...base, eligibility, totalXp: 0, awardedCards: [], status: "refused", rewardedToday: await rewardedTodayOf(playerId) };
      }
      // Shared allowance: only matches with a confirmed bot Gold award earn XP.
      // A missing award stays pending while Gold is still pending. Once Gold
      // reaches a terminal refusal or cap, XP must reach the same terminal
      // state instead of retrying forever after every restart.
      const gold = await getBotGoldAward(matchId, playerId);
      if (!gold) {
        const acceptedDeploys = [...accepted.values()].reduce((sum, count) => sum + count, 0);
        const terminalReason = ev.status === "capped"
          ? "capped"
          : ev.status === "refused"
            ? ev.ticks < BOT_GOLD_MIN_TICKS
              ? "short-match"
              : acceptedDeploys < BOT_GOLD_MIN_HUMAN_DEPLOYS
                ? "too-few-deploys"
                : "replay-mismatch"
            : null;
        if (terminalReason === "capped") {
          await claimBotXpRun(matchId, playerId, { reason: terminalReason });
          await markBotXpRun(matchId, playerId, "capped", 0, { reason: terminalReason });
          return { ...base, eligibility: "capped", totalXp: 0, awardedCards: [], status: "capped", rewardedToday: await rewardedTodayOf(playerId) };
        }
        if (terminalReason) {
          await claimBotXpRun(matchId, playerId, { reason: terminalReason });
          await markBotXpRun(matchId, playerId, "refused", 0, { reason: terminalReason });
          return { ...base, eligibility: terminalReason, totalXp: 0, awardedCards: [], status: "refused", rewardedToday: await rewardedTodayOf(playerId) };
        }
        await claimBotXpRun(matchId, playerId, { reason: "awaiting-gold" });
        return { ...base, eligibility: "awaiting-gold", totalXp: 0, awardedCards: [], status: "pending", rewardedToday: await rewardedTodayOf(playerId) };
      }
      const units = allocateBotCardXp([...accepted.entries()].map(([cardId, deployments]) => ({ cardId, deployments })));
      if (units.length === 0) {
        await claimBotXpRun(matchId, playerId, { reason: "too-few-deploys" });
        await markBotXpRun(matchId, playerId, "refused", 0, { reason: "too-few-deploys" });
        return { ...base, eligibility: "too-few-deploys", totalXp: 0, awardedCards: [], status: "refused", rewardedToday: await rewardedTodayOf(playerId) };
      }
      await claimBotXpRun(matchId, playerId, { units: units.length });
      await stageBotCardXp(matchId, playerId, units);
      await applyCardXpTotals(units.map((u) => ({ playerId, cardId: u.cardId })));
      await markBotXpRun(matchId, playerId, "done", units.length);
      return {
        ...base,
        eligibility: "eligible",
        totalXp: units.reduce((s, u) => s + u.xp, 0),
        awardedCards: units,
        status: "confirmed",
        rewardedToday: await rewardedTodayOf(playerId),
      };
    } catch (err) {
      logger.error("bot card xp award failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
      return { ...base, eligibility: "replay-mismatch", totalXp: 0, awardedCards: [], status: "pending", rewardedToday: 0 };
    }
  }

  /** Finish pending bot XP work after interruption or restart. Never throws. */
  async reconcile(limit = 50): Promise<{ processed: number; awarded: number }> {
    try {
      const rows = await pendingBotXpMatches(limit);
      let awarded = 0;
      for (const r of rows) {
        const out = await this.processMatch(r.matchId);
        if (out.status === "confirmed") awarded += 1;
      }
      if (rows.length > 0) logger.info("bot card xp reconcile", { processed: rows.length, awarded });
      return { processed: rows.length, awarded };
    } catch (err) {
      logger.error("bot card xp reconcile failed", { reason: err instanceof Error ? err.message : String(err) });
      return { processed: 0, awarded: 0 };
    }
  }
}

let shared: BotCardXpService | null = null;
/** Process-wide service shared by the room hook and restart sweeper. */
export function botCardXpService(): BotCardXpService {
  return (shared ??= new BotCardXpService());
}
