// V2.2a Player Account XP award processing. Permanent account levels
// 1-100, separate from Card XP, Gold, trophies and combat stats.
//
// Human PvP: awards only after replay-verified, durable public
// matchmaking settlement. Verified evidence is re-run to count accepted
// ordinary-card deployments per player; wins, draws and losses all earn.
// Solo Practice, private, ranked, aborted, unverified and duplicate
// settlements never earn. PvP daily cap (20) is transactional.
//
// AI fallback: awards only from genuine bot evidence with a confirmed bot
// Gold award for that match, so the shared 5/day Gold allowance also gates
// Account XP. Solo Practice never reaches here, and no fake PvP rows are
// created for AI games.
//
// Release boundary: only matches begun after the durable activation
// instant may earn. Historical rows earn zero. The activation row is
// created only by ensureAccountXpRelease, never automatically, and restarts
// never move it. Flag OFF causes zero writes. Never throws.
import { isAbilityCommand, isCommanderCard, runMatch, CARDS_V1 } from "@/lib/combat";
import type { CombatCommand } from "@/lib/combat";
import { logger } from "@/lib/logger";
import {
  ACCOUNT_XP_POLICY_VERSION,
  ACCOUNT_XP_PVP_DAILY_CAP,
  accountXpBotGate,
  accountXpForResult,
  accountXpPvpGate,
  accountXpReleaseEnabled,
  levelForTotalXp,
  type AccountXpEligibility,
  type AccountXpReceipt,
} from "@/lib/account-xp";
import { getAwardableMatch } from "@/db/card-xp";
import { getBotMatchEvidence, countBotGoldToday } from "@/db/bot-gold";
import { getBotGoldAward } from "@/db/bot-card-xp";
import { extractBotDeployments } from "@/server/battle/bot-card-xp";
import {
  accountXpTablesPresent,
  claimAccountXpRun,
  countAccountXpPvpToday,
  getAccountXpAward,
  getAccountXpRelease,
  getAccountXpRun,
  getAccountXpTotal,
  markAccountXpRun,
  pendingAccountXpRuns,
  stageAccountXpBotAward,
  stageAccountXpPvpAward,
} from "@/db/account-xp";
import { getDb } from "@/db/client";
import { eq } from "drizzle-orm";
import { matches } from "@/db/schema";

export interface AccountXpServiceDeps {
  /** Release gate; defaults to process.env. False keeps all writes off. */
  enabled?: boolean;
}

function serviceEnabled(deps: AccountXpServiceDeps): boolean {
  if (typeof deps.enabled === "boolean") return deps.enabled;
  return accountXpReleaseEnabled(process.env as { PLAYER_ACCOUNT_XP_ENABLED?: string });
}

async function tablesOrSkip(): Promise<boolean> {
  try {
    return await accountXpTablesPresent();
  } catch {
    return false;
  }
}

function acceptedPvpDeploysPerPlayer(
  commands: CombatCommand[],
  rejected: Set<number>,
  players: [{ playerId: string }, { playerId: string }]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cmd of commands) {
    if (isAbilityCommand(cmd)) continue;
    if (rejected.has(cmd.seq)) continue;
    if (isCommanderCard(cmd.cardId)) continue;
    if (!CARDS_V1[cmd.cardId]) continue;
    const owner = players[cmd.player as 0 | 1];
    if (!owner) continue;
    counts.set(owner.playerId, (counts.get(owner.playerId) ?? 0) + 1);
  }
  return counts;
}

export interface AccountXpPlayerOutcome {
  playerId: string;
  eligibility: AccountXpEligibility;
  amount: number;
  result: "win" | "loss" | "draw";
  status: "confirmed" | "pending" | "refused" | "capped";
}

export interface AccountXpPvpResult {
  matchId: string;
  source: "matchmaking";
  policyVersion: number;
  players: AccountXpPlayerOutcome[];
  status: "confirmed" | "pending" | "refused" | "capped";
}

export interface AccountXpBotResult {
  matchId: string;
  source: "unranked-fallback";
  policyVersion: number;
  eligibility: AccountXpEligibility;
  amount: number;
  result: "win" | "loss" | "draw";
  status: "confirmed" | "pending" | "refused" | "capped";
  rewardedToday: number;
}

async function matchStartedAt(matchId: string): Promise<Date | null> {
  try {
    const db = getDb();
    const rows = await db.select({ startedAt: matches.startedAt }).from(matches).where(eq(matches.id, matchId)).limit(1);
    return rows[0]?.startedAt ?? null;
  } catch {
    return null;
  }
}

export class AccountXpService {
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: AccountXpServiceDeps = {}) {}

  get enabled(): boolean {
    return serviceEnabled(this.deps);
  }

  startSweeper(intervalMs = 60_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.reconcile().catch((err) =>
        logger.error("account xp reconcile failed", { reason: err instanceof Error ? err.message : String(err) })
      );
    }, intervalMs);
    if (typeof this.sweeper.unref === "function") this.sweeper.unref();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** Award both humans of one settled PvP match. Never throws, never touches settlement. */
  async processPvpMatch(matchId: string): Promise<AccountXpPvpResult> {
    const base = { matchId, source: "matchmaking" as const, policyVersion: ACCOUNT_XP_POLICY_VERSION };
    const refused = (reason: AccountXpEligibility): AccountXpPvpResult => ({ ...base, players: [], status: reason === "capped" ? "capped" : "refused" });
    try {
      if (!this.enabled) return { ...base, players: [], status: "refused" };
      if (!(await tablesOrSkip())) return refused("ineligible-type");
      const release = await getAccountXpRelease();
      if (!release) return refused("pre-release");
      const gate = await getAwardableMatch(matchId);
      if (!gate.ok) {
        const reason = gate.reason.startsWith("ineligible-type") || gate.reason.startsWith("ineligible")
          ? (gate.reason.includes("private") ? "private-earns-zero" : "ineligible-type")
          : gate.reason.startsWith("unverified")
            ? "unverified"
            : "ineligible-type";
        // Private rooms report their own zero code even via the generic gate.
        if (gate.reason.includes("private")) return refused("private-earns-zero");
        return refused(reason as AccountXpEligibility);
      }
      const { match } = gate;
      if (match.matchType !== "matchmaking") {
        return refused(match.matchType === "private" ? "private-earns-zero" : match.matchType === "ranked" ? "ranked-closed" : "ineligible-type");
      }
      const startedAt = await matchStartedAt(matchId);
      if (!startedAt || startedAt < release.activatedAt) return refused("pre-release");
      const config = match.evidence.config as Parameters<typeof runMatch>[0];
      const commands = match.evidence.commands as Parameters<typeof runMatch>[1];
      const replay = runMatch(config, commands);
      const rejected = new Set(
        replay.state.events
          .filter((e): e is Extract<typeof e, { type: "command_rejected" }> => e.type === "command_rejected")
          .filter((e) => (e.player ?? -1) === 0 || (e.player ?? -1) === 1)
          .map((e) => e.seq)
      );
      const perPlayer = acceptedPvpDeploysPerPlayer(commands, rejected, match.players);
      const outcomes: AccountXpPlayerOutcome[] = [];
      for (let seat = 0 as 0 | 1; seat <= 1; seat = (seat + 1) as 0 | 1) {
        const playerId = match.players[seat]!.playerId;
        const deploys = perPlayer.get(playerId) ?? 0;
        const gateResult = accountXpPvpGate({ matchType: match.matchType, verification: match.verification, ticks: replay.result.ticks, acceptedDeploys: deploys });
        const result: "win" | "loss" | "draw" =
          replay.result.winner === "draw" ? "draw" : replay.result.winner === seat ? "win" : "loss";
        if (gateResult !== "eligible") {
          await claimAccountXpRun(playerId, "matchmaking", matchId, { reason: gateResult });
          await markAccountXpRun(playerId, "matchmaking", matchId, "refused", 0, { reason: gateResult });
          outcomes.push({ playerId, eligibility: gateResult, amount: 0, result, status: "refused" });
          continue;
        }
        const existing = await getAccountXpRun(playerId, "matchmaking", matchId);
        if (existing && existing.status !== "pending") {
          if (existing.status === "done") {
            outcomes.push({ playerId, eligibility: "duplicate", amount: 0, result, status: "confirmed" });
            continue;
          }
          const prior = (existing.details as { reason?: unknown } | null)?.reason;
          const eligibility = typeof prior === "string"
            ? (prior as AccountXpEligibility)
            : existing.status === "capped"
              ? ("capped" as const)
              : ("replay-mismatch" as const);
          const status = existing.status === "capped" ? ("capped" as const) : ("refused" as const);
          outcomes.push({ playerId, eligibility, amount: 0, result, status });
          continue;
        }
        await claimAccountXpRun(playerId, "matchmaking", matchId, { result, deploys });
        const amount = accountXpForResult("matchmaking", result);
        const staged = await stageAccountXpPvpAward({ matchId, playerId, amount, result });
        if (staged.status === "capped") {
          await markAccountXpRun(playerId, "matchmaking", matchId, "capped", 0, { reason: "capped" });
          outcomes.push({ playerId, eligibility: "capped", amount: 0, result, status: "capped" });
          continue;
        }
        await markAccountXpRun(playerId, "matchmaking", matchId, "done", 1, { result, amount });
        outcomes.push({
          playerId,
          eligibility: staged.status === "duplicate" ? "duplicate" : "eligible",
          amount: staged.status === "duplicate" ? 0 : amount,
          result,
          status: "confirmed",
        });
      }
      const anyCapped = outcomes.some((o) => o.status === "capped");
      const anyConfirmed = outcomes.some((o) => o.status === "confirmed");
      return { ...base, players: outcomes, status: anyConfirmed ? "confirmed" : anyCapped ? "capped" : "refused" };
    } catch (err) {
      logger.error("account xp pvp award failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
      return { ...base, players: [], status: "pending" };
    }
  }

  /** Award one verified fallback match. Never throws. */
  async processBotMatch(matchId: string): Promise<AccountXpBotResult> {
    const base = { matchId, source: "unranked-fallback" as const, policyVersion: ACCOUNT_XP_POLICY_VERSION };
    try {
      if (!this.enabled) return { ...base, eligibility: "flag-off", amount: 0, result: "loss", status: "refused", rewardedToday: 0 };
      if (!(await tablesOrSkip())) return { ...base, eligibility: "practice-earns-zero", amount: 0, result: "loss", status: "refused", rewardedToday: 0 };
      const release = await getAccountXpRelease();
      if (!release) return { ...base, eligibility: "pre-release", amount: 0, result: "loss", status: "refused", rewardedToday: 0 };
      const ev = await getBotMatchEvidence(matchId);
      if (!ev || ev.source !== "unranked-fallback") {
        return { ...base, eligibility: "practice-earns-zero", amount: 0, result: "loss", status: "refused", rewardedToday: 0 };
      }
      const playerId = ev.playerId;
      const existing = await getAccountXpRun(playerId, "unranked-fallback", matchId);
      if (existing && existing.status !== "pending") {
        if (existing.status === "done") {
          return { ...base, eligibility: "duplicate", amount: 0, result: "loss", status: "confirmed", rewardedToday: await countBotGoldToday(playerId).catch(() => 0) };
        }
        const prior = (existing.details as { reason?: unknown } | null)?.reason;
        const eligibility = typeof prior === "string" ? (prior as AccountXpEligibility) : "replay-mismatch";
        const status = existing.status === "capped" ? "capped" : "refused";
        return { ...base, eligibility, amount: 0, result: "loss", status, rewardedToday: await countBotGoldToday(playerId).catch(() => 0) };
      }
      // Trustworthy start boundary first: history earns zero even with Gold.
      if (!ev.startedAt || new Date(ev.startedAt) < release.activatedAt) {
        await claimAccountXpRun(playerId, "unranked-fallback", matchId, { reason: "pre-release" });
        await markAccountXpRun(playerId, "unranked-fallback", matchId, "refused", 0, { reason: "pre-release" });
        return { ...base, eligibility: "pre-release", amount: 0, result: "loss", status: "refused", rewardedToday: 0 };
      }
      const config = ev.config as Parameters<typeof runMatch>[0];
      const commands = ev.commands as Parameters<typeof runMatch>[1];
      const replay = runMatch(config, commands);
      if (
        replay.result.stateHash !== ev.liveHash ||
        replay.result.stateHash !== ev.replayHash ||
        replay.result.winner !== (ev.winnerSeat === null ? "draw" : (ev.winnerSeat as 0 | 1)) ||
        replay.result.ticks !== ev.ticks
      ) {
        await claimAccountXpRun(playerId, "unranked-fallback", matchId, { reason: "replay-mismatch" });
        await markAccountXpRun(playerId, "unranked-fallback", matchId, "refused", 0, { reason: "replay-mismatch" });
        return { ...base, eligibility: "replay-mismatch", amount: 0, result: "loss", status: "refused", rewardedToday: 0 };
      }
      const rejected = new Set(
        replay.state.events
          .filter((e): e is Extract<typeof e, { type: "command_rejected" }> => e.type === "command_rejected")
          .filter((e) => (e.player ?? -1) === ev.humanSeat)
          .map((e) => e.seq)
      );
      const accepted = extractBotDeployments(commands, rejected, ev.humanSeat as 0 | 1);
      const deploys = [...accepted.values()].reduce((sum, n) => sum + n, 0);
      // Shared allowance: only matches with a confirmed bot Gold award earn.
      const gold = await getBotGoldAward(matchId, playerId);
      const gateResult = accountXpBotGate({ source: ev.source, ticks: replay.result.ticks, acceptedDeploys: deploys, goldConfirmed: !!gold });
      if (gateResult !== "eligible") {
        // A missing award stays pending while Gold is still pending. Once
        // Gold reaches a terminal refusal or cap, XP reaches the matching
        // terminal state instead of retrying forever.
        if (gateResult === "awaiting-gold") {
          const terminal =
            ev.status === "capped" ? "capped" : ev.status === "refused" ? (replay.result.ticks < 600 ? "short-match" : deploys < 3 ? "too-few-deploys" : "replay-mismatch") : null;
          if (terminal === "capped") {
            await claimAccountXpRun(playerId, "unranked-fallback", matchId, { reason: terminal });
            await markAccountXpRun(playerId, "unranked-fallback", matchId, "capped", 0, { reason: terminal });
            return { ...base, eligibility: "capped", amount: 0, result: "loss", status: "capped", rewardedToday: await countBotGoldToday(playerId).catch(() => 0) };
          }
          if (terminal) {
            await claimAccountXpRun(playerId, "unranked-fallback", matchId, { reason: terminal });
            await markAccountXpRun(playerId, "unranked-fallback", matchId, "refused", 0, { reason: terminal });
            return { ...base, eligibility: terminal as AccountXpEligibility, amount: 0, result: "loss", status: "refused", rewardedToday: 0 };
          }
          await claimAccountXpRun(playerId, "unranked-fallback", matchId, { reason: "awaiting-gold" });
          return { ...base, eligibility: "awaiting-gold", amount: 0, result: "loss", status: "pending", rewardedToday: 0 };
        }
        await claimAccountXpRun(playerId, "unranked-fallback", matchId, { reason: gateResult });
        await markAccountXpRun(playerId, "unranked-fallback", matchId, gateResult === "capped" ? "capped" : "refused", 0, { reason: gateResult });
        return { ...base, eligibility: gateResult, amount: 0, result: "loss", status: gateResult === "capped" ? "capped" : "refused", rewardedToday: 0 };
      }
      const humanSeat = ev.humanSeat as 0 | 1;
      const result = replay.result.winner === "draw" ? "draw" : replay.result.winner === humanSeat ? "win" : "loss";
      const amount = accountXpForResult("unranked-fallback", result);
      await claimAccountXpRun(playerId, "unranked-fallback", matchId, { result, deploys });
      const staged = await stageAccountXpBotAward({ matchId, playerId, amount, result });
      await markAccountXpRun(playerId, "unranked-fallback", matchId, "done", 1, { result, amount });
      return {
        ...base,
        eligibility: staged.status === "duplicate" ? "duplicate" : "eligible",
        amount: staged.status === "duplicate" ? 0 : amount,
        result,
        status: "confirmed",
        rewardedToday: await countBotGoldToday(playerId).catch(() => 0),
      };
    } catch (err) {
      logger.error("account xp bot award failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
      return { ...base, eligibility: "replay-mismatch", amount: 0, result: "loss", status: "pending", rewardedToday: 0 };
    }
  }

  /** Finish pending work after interruption or restart. Never throws. */
  async reconcile(limit = 50): Promise<{ processed: number; awarded: number }> {
    try {
      if (!this.enabled) return { processed: 0, awarded: 0 };
      if (!(await tablesOrSkip())) return { processed: 0, awarded: 0 };
      const rows = await pendingAccountXpRuns(limit);
      let awarded = 0;
      for (const r of rows) {
        if (r.source === "matchmaking") {
          const out = await this.processPvpMatch(r.matchId);
          if (out.status === "confirmed") awarded += 1;
        } else {
          const out = await this.processBotMatch(r.matchId);
          if (out.status === "confirmed") awarded += 1;
        }
      }
      if (rows.length > 0) logger.info("account xp reconcile", { processed: rows.length, awarded });
      return { processed: rows.length, awarded };
    } catch (err) {
      logger.error("account xp reconcile failed", { reason: err instanceof Error ? err.message : String(err) });
      return { processed: 0, awarded: 0 };
    }
  }
}

let shared: AccountXpService | null = null;
/** Process-wide service shared by settlement hooks and sweepers. */
export function accountXpService(deps?: AccountXpServiceDeps): AccountXpService {
  if (deps) return new AccountXpService(deps);
  return (shared ??= new AccountXpService());
}

/** Outcome input for one player's receipt. Matches service outcome shapes. */
export interface AccountXpOutcomeLike {
  eligibility: AccountXpEligibility;
  amount: number;
  result: "win" | "loss" | "draw";
  status: "confirmed" | "pending" | "refused" | "capped";
}

/** Builds the server-owned receipt for one player's award outcome.
 * Snapshots come from the award row's durable (xp_before, xp_after),
 * written atomically with the award insert in the same statement that
 * serializes the per-player heads bump. They never derive from a later
 * lifetime total, so later matches cannot rewrite history and concurrent
 * awards cannot claim the same crossing twice. Duplicates repeat the
 * stored snapshots and never imply a second award. Rows without snapshots
 * (pre-0027) stay honestly unproven: no level-up claim is emitted. */
export async function buildAccountXpReceipt(
  playerId: string,
  source: "matchmaking" | "unranked-fallback",
  matchId: string,
  outcome: AccountXpOutcomeLike
): Promise<AccountXpReceipt> {
  const unproven = (): AccountXpReceipt => ({
    matchId,
    source,
    policyVersion: ACCOUNT_XP_POLICY_VERSION,
    status: outcome.status,
    eligibility: outcome.eligibility,
    result: outcome.status === "pending" ? null : outcome.result,
    amount: 0,
    playerId,
    totalXp: null,
    levelBefore: null,
    levelAfter: null,
    leveledUp: null,
  });
  try {
    if (outcome.status !== "confirmed") return unproven();
    const [row, totalXp] = await Promise.all([
      getAccountXpAward(playerId, source, matchId),
      getAccountXpTotal(playerId),
    ]);
    // No award row despite a confirmed outcome (deleted or raced), or a
    // legacy row without durable snapshots: report as not yet available,
    // never fabricate snapshots from the outcome or a later total.
    if (!row || row.amount < 0 || row.xpBefore === null || row.xpAfter === null) {
      return {
        matchId,
        source,
        policyVersion: ACCOUNT_XP_POLICY_VERSION,
        status: "pending",
        eligibility: "unknown",
        result: null,
        amount: 0,
        playerId,
        totalXp: null,
        levelBefore: null,
        levelAfter: null,
        leveledUp: null,
      };
    }
    const levelBefore = levelForTotalXp(row.xpBefore);
    const levelAfter = levelForTotalXp(row.xpAfter);
    return {
      matchId,
      source,
      policyVersion: ACCOUNT_XP_POLICY_VERSION,
      status: "confirmed",
      eligibility: "eligible",
      result: row.result,
      amount: row.amount,
      playerId,
      totalXp,
      levelBefore,
      levelAfter,
      leveledUp: levelAfter > levelBefore,
    };
  } catch (err) {
    logger.error("account xp receipt failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
    return unproven();
  }
}

export { ACCOUNT_XP_POLICY_VERSION, ACCOUNT_XP_PVP_DAILY_CAP, countAccountXpPvpToday };
