// B3.3a durable match settlement. Offchain results only: no ratings,
// rewards, leaderboards or NFT legacy writes live here.
//
// Guarantees:
// - Exactly one DB record per matchId. A duplicate insert races resolve to
//   "already-settled" when the stored evidence hash matches, "conflict" when
//   it does not (never overwritten).
// - Before anything is written, the recorded evidence ({config, commands})
//   is replayed through runMatch and must reproduce the live state hash plus
//   the recorded winner, crowns and endReason. Anything that fails
//   verification is refused and never reaches the database.
// - After verification the record is durably staged in the settlement
//   outbox (pending/*.json) before the first DB attempt, so results survive
//   DB outages and battle-server restarts as long as the local file
//   survives. A result is lost only if the host disk is lost before the DB
//   confirms. Successful files are deleted; permanent failures move to
//   failed/ with the reason; transient exhaustion leaves the file pending
//   for the sweeper.
// - The outbox contains seeds and full command streams. It stays local,
//   gitignored, and is never served by any API.

import { createHash, randomUUID } from "crypto";
import { mkdirSync, readFileSync, renameSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { runMatch, type CombatCommand, type CombatConfig } from "@/lib/combat";
import { BATTLE_PROTOCOL_VERSION, type CommanderIdentity } from "@/lib/battle-protocol";
import { getDb } from "@/db/client";
import { matchEvidence, matchParticipants, matches } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { ReplayRecord, SeatPlayer } from "@/server/battle/session";
import type { LegacyProcessor } from "@/server/battle/legacy";

type Db = ReturnType<typeof getDb>;

export class SettlementVerificationError extends Error {}
export class SettlementConflictError extends Error {}
/** Constraint/FK violations and other non-retryable DB rejections. */
export class SettlementPermanentError extends Error {}

export interface SettlementRecord {
  matchId: string;
  roomId: string;
  matchType: "private" | "matchmaking";
  rulesetVersion: string;
  protocolVersion: string;
  startedAt: string;
  finishedAt: string;
  outcome: "win" | "draw";
  winnerSeat: 0 | 1 | null;
  endReason: string;
  crowns: [number, number];
  ticks: number;
  liveHash: string;
  replayHash: string;
  /** Players indexed by seat (0 then 1). */
  players: [SeatPlayer, SeatPlayer];
  /** Locked 8-card engine decks indexed by seat. */
  decks: [string[], string[]];
  /** Locked commander identity snapshots indexed by seat. */
  commanders: [CommanderIdentity, CommanderIdentity];
  /** Verified owner wallets (lowercase) per seat; null for free commanders. Not part of the evidence hash. */
  owners: [string | null, string | null];
  evidence: { formatVersion: 1; config: CombatConfig; commands: CombatCommand[] };
  evidenceSha256: string;
}

/** Order-stable JSON so evidence_sha256 is deterministic across processes. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function evidenceDigest(evidence: SettlementRecord["evidence"]): string {
  return createHash("sha256").update(canonicalJson(evidence), "utf8").digest("hex");
}

/** Builds the durable record from a finished session's replay plus room facts. */
export function recordFromReplay(
  replay: ReplayRecord,
  opts: {
    matchId: string;
    roomId: string;
    matchType: "private" | "matchmaking";
    startedAt: Date;
    finishedAt?: Date;
    crowns: [number, number];
  }
): SettlementRecord {
  const evidence = { formatVersion: 1 as const, config: replay.config, commands: replay.commands };
  return {
    matchId: opts.matchId,
    roomId: opts.roomId,
    matchType: opts.matchType,
    rulesetVersion: replay.config.rulesetVersion,
    protocolVersion: BATTLE_PROTOCOL_VERSION,
    startedAt: opts.startedAt.toISOString(),
    finishedAt: (opts.finishedAt ?? new Date()).toISOString(),
    outcome: replay.winner === "draw" ? "draw" : "win",
    winnerSeat: replay.winner === "draw" ? null : (replay.winner as 0 | 1),
    endReason: replay.endReason ?? "unknown",
    crowns: opts.crowns,
    ticks: replay.ticks,
    liveHash: replay.liveHash,
    replayHash: replay.replayHash,
    players: replay.players,
    decks: [replay.config.decks[0], replay.config.decks[1]],
    commanders: replay.commanders,
    owners: replay.owners,
    evidence,
    evidenceSha256: evidenceDigest(evidence),
  };
}

/**
 * Independently re-runs the recorded evidence and cross-checks every field
 * of the record against it. Throws SettlementVerificationError on any
 * mismatch; nothing failing this check is ever written.
 */
export function verifySettlement(record: SettlementRecord): void {
  const fail = (reason: string): never => {
    throw new SettlementVerificationError(reason);
  };
  if (!record.endReason) fail("missing endReason");
  const expectedWinner = record.outcome === "draw" ? "draw" : record.winnerSeat;
  if (expectedWinner === null || expectedWinner === undefined) fail("missing winner");
  const [a, b] = record.players;
  if (!a?.playerId || !b?.playerId || a.playerId === b.playerId) fail("seats must hold two distinct players");
  for (const seat of [0, 1] as const) {
    const deck = record.decks[seat];
    const cfg = record.evidence.config.decks?.[seat];
    if (!Array.isArray(deck) || !Array.isArray(cfg) || deck.length !== cfg.length || deck.some((c, i) => c !== cfg[i])) {
      fail(`deck for seat ${seat} does not match evidence config`);
    }
  }
  for (const seat of [0, 1] as const) {
    const identity = record.commanders[seat];
    const slotRaw = record.evidence.config.commanders?.[seat] ?? null;
    const owner = record.owners[seat];
    if (slotRaw === null) fail(`missing commander slot for seat ${seat}`);
    const slot = slotRaw!;
    if (identity.commanderId !== slot.commanderId) fail(`commander for seat ${seat} does not match evidence config`);
    if (identity.kind === "nft") {
      if (!identity.tokenId || slot.commanderId !== `nft-${identity.tokenId}`) {
        fail(`nft commander token for seat ${seat} does not match evidence slot`);
      }
      if (identity.basis !== "direct-owner" || !identity.verifiedAt || !owner) {
        fail(`nft commander for seat ${seat} lacks direct-owner provenance`);
      }
    } else {
      if (identity.kind !== "free" || identity.basis !== "free" || owner !== null) {
        fail(`free commander provenance for seat ${seat} is malformed`);
      }
    }
  }
  if (evidenceDigest(record.evidence) !== record.evidenceSha256) fail("evidence hash mismatch");
  const replay = runMatch(record.evidence.config, record.evidence.commands);
  if (replay.result.stateHash !== record.liveHash || replay.result.stateHash !== record.replayHash) {
    fail("replay hash does not reproduce the recorded live hash");
  }
  const replayWinner = replay.result.winner;
  if (replayWinner !== expectedWinner) fail("replay winner mismatch");
  if (replay.result.endReason !== record.endReason) fail("replay endReason mismatch");
  if (replay.result.crowns[0] !== record.crowns[0] || replay.result.crowns[1] !== record.crowns[1]) {
    fail("replay crowns mismatch");
  }
}

function isPgError(err: unknown): err is Error & { code: string; constraint?: string } {
  return typeof (err as { code?: unknown })?.code === "string";
}

function participantResult(record: SettlementRecord, seat: 0 | 1): "win" | "loss" | "draw" {
  if (record.outcome === "draw") return "draw";
  return record.winnerSeat === seat ? "win" : "loss";
}

/**
 * Atomic insert of one matches row, two participant rows and the evidence
 * row in a single drizzle neon-http batch (one request, ordered). A 23505
 * on the match id resolves idempotently: same evidence -> already-settled,
 * different evidence -> SettlementConflictError, never overwritten.
 */
export async function settleMatch(record: SettlementRecord, db: Db): Promise<"settled" | "already-settled"> {
  try {
    await db.batch([
      db.insert(matches).values({
        id: record.matchId,
        roomId: record.roomId,
        matchType: record.matchType,
        rulesetVersion: record.rulesetVersion,
        protocolVersion: record.protocolVersion,
        startedAt: new Date(record.startedAt),
        finishedAt: new Date(record.finishedAt),
        // Millisecond precision on purpose: the history keyset cursor is a JS Date.
        settledAt: new Date(),
        outcome: record.outcome,
        winnerSeat: record.winnerSeat,
        endReason: record.endReason,
        crowns0: record.crowns[0],
        crowns1: record.crowns[1],
        ticks: record.ticks,
        liveHash: record.liveHash,
        replayHash: record.replayHash,
        evidenceSha256: record.evidenceSha256,
        verification: "replay-verified",
      }),
      db.insert(matchParticipants).values(
        ([0, 1] as const).map((seat) => ({
          matchId: record.matchId,
          seat,
          playerId: record.players[seat].playerId,
          result: participantResult(record, seat),
          crowns: record.crowns[seat],
          deck: record.decks[seat],
          commanderKind: record.commanders[seat].kind,
          commanderClass: record.commanders[seat].class,
          nftTokenId: record.commanders[seat].tokenId,
          commanderIdentity: record.commanders[seat] as unknown as Record<string, unknown>,
          entitlementOwner: record.owners[seat],
        }))
      ),
      db.insert(matchEvidence).values({
        matchId: record.matchId,
        formatVersion: 1,
        evidence: record.evidence as unknown as Record<string, unknown>,
        evidenceSha256: record.evidenceSha256,
      }),
    ]);
    return "settled";
  } catch (err) {
    if (isPgError(err) && err.code === "23505") {
      const existing = await db.select().from(matches).where(eq(matches.id, record.matchId)).limit(1);
      const row = existing[0];
      if (row && row.evidenceSha256 === record.evidenceSha256) return "already-settled";
      throw new SettlementConflictError("a different match already owns this match id");
    }
    // Constraint and FK violations are data errors; retrying cannot fix them.
    if (isPgError(err) && /^2[0-9A-Z]{4}$/.test(err.code)) {
      throw new SettlementPermanentError(err.message);
    }
    throw err;
  }
}

export interface SettlementServiceDeps {
  /** Outbox directory; holds seeds, stays local and private. */
  dir?: string;
  sweepMs?: number;
  retryDelaysMs?: number[];
  /** DB resolver; defaults to the shared DAL connection. */
  db?: () => Db;
  sleep?: (ms: number) => Promise<void>;
  /** Optional B3.3b NFT legacy pass. Runs after a durable settle and via
   * reconciliation in every sweep; failures never change the settlement
   * result already reported to clients. */
  legacy?: LegacyProcessor | null;
}

export type SubmitStatus = "settled" | "already-settled" | "pending" | "conflict" | "failed" | "refused";

const DEFAULT_DELAYS = [500, 2000, 5000];

export class SettlementService {
  readonly dir: string;
  private readonly delays: number[];
  private readonly dbOf: () => Db;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly sweepMs: number;
  private readonly legacy: LegacyProcessor | null;
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private readonly inFlight = new Set<string>();

  constructor(deps: SettlementServiceDeps = {}) {
    this.dir = deps.dir ?? path.join(process.cwd(), ".battle-settlements");
    this.delays = deps.retryDelaysMs ?? DEFAULT_DELAYS;
    this.dbOf = deps.db ?? getDb;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.sweepMs = deps.sweepMs ?? 60_000;
    this.legacy = deps.legacy ?? null;
  }

  /** Legacy writes are decoupled: settlement is already durable, and a
   * failed pass leaves no marker so reconcile can retry later. */
  private async runLegacy(matchId: string): Promise<void> {
    if (!this.legacy) return;
    try {
      await this.legacy.processMatch(matchId);
    } catch (err) {
      logger.error("legacy processing failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  private pendingPath(matchId: string): string {
    return path.join(this.dir, "pending", `${matchId}.json`);
  }

  /** Verify, durably stage, then attempt settlement with bounded retries. */
  async submit(record: SettlementRecord): Promise<SubmitStatus> {
    try {
      verifySettlement(record);
    } catch (err) {
      logger.error("settlement refused", { matchId: record.matchId, reason: err instanceof Error ? err.message : String(err) });
      return "refused";
    }
    const pendingDir = path.join(this.dir, "pending");
    const failedDir = path.join(this.dir, "failed");
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(failedDir, { recursive: true });
    const target = this.pendingPath(record.matchId);
    const tmp = `${target}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(record));
    renameSync(tmp, target);
    return this.attempt(record, target);
  }

  /** Retry loop for one staged record; safe to re-enter via the sweeper. */
  private async attempt(record: SettlementRecord, file: string): Promise<SubmitStatus> {
    if (this.inFlight.has(record.matchId)) return "pending";
    this.inFlight.add(record.matchId);
    try {
      for (let tryN = 0; ; tryN += 1) {
        try {
          const status = await settleMatch(record, this.dbOf());
          try {
            unlinkSync(file);
          } catch {
            /* file already moved */
          }
          logger.info("match settled", { matchId: record.matchId, status });
          await this.runLegacy(record.matchId);
          return status;
        } catch (err) {
          if (err instanceof SettlementConflictError) {
            this.moveFailed(file, record.matchId, err.message);
            return "conflict";
          }
          if (err instanceof SettlementPermanentError) {
            this.moveFailed(file, record.matchId, err.message);
            logger.error("settlement permanently failed", { matchId: record.matchId, reason: err.message });
            return "failed";
          }
          if (tryN < this.delays.length) {
            await this.sleep(this.delays[tryN]!);
            continue;
          }
          logger.error("settlement pending after retries", { matchId: record.matchId, reason: err instanceof Error ? err.message : String(err) });
          return "pending";
        }
      }
    } finally {
      this.inFlight.delete(record.matchId);
    }
  }

  private moveFailed(file: string, matchId: string, reason: string) {
    try {
      const target = path.join(this.dir, "failed", `${matchId}.json`);
      const record = JSON.parse(readFileSync(file, "utf8"));
      writeFileSync(target, JSON.stringify({ ...record, failureReason: reason }));
      unlinkSync(file);
    } catch (err) {
      logger.error("could not move settlement to failed", { matchId, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Re-attempt every staged pending record (startup + periodic sweep). */
  async sweep(): Promise<void> {
    const dir = path.join(this.dir, "pending");
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      let record: SettlementRecord;
      try {
        record = JSON.parse(readFileSync(file, "utf8")) as SettlementRecord;
      } catch {
        this.moveFailed(file, f.replace(/\.json$/, ""), "unreadable pending record");
        continue;
      }
      // Files on disk are re-verified: a tampered or corrupted record never settles.
      try {
        verifySettlement(record);
      } catch (err) {
        this.moveFailed(file, record.matchId ?? f.replace(/\.json$/, ""), `verification failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      await this.attempt(record, file);
    }
    // Picks up settled matches that have no legacy run marker yet.
    if (this.legacy) {
      try {
        await this.legacy.reconcile();
      } catch (err) {
        logger.error("legacy reconcile failed", { reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  startSweeper(): void {
    if (this.sweeper) return;
    void this.sweep();
    this.sweeper = setInterval(() => void this.sweep(), this.sweepMs);
    if (typeof this.sweeper.unref === "function") this.sweeper.unref();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }
}
