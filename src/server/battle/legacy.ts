// B3.3b NFT legacy processing. Consumes ONLY durable settlement rows
// (matches, match_participants, match_evidence), never in-memory room or
// session state, so it recovers after battle-server restarts.
//
// Flow: re-verify the match (replay-verified, live==replay, evidence hash
// recomputes, runMatch reproduces the live hash), then emit B1 legacy
// events for each eligible NFT commander that actually deployed (the
// replay's commander_deployed event marks the battle appearance). Free
// commanders, undeployed NFTs, missing owner provenance and malformed
// identities are skipped. Patron appearances are never emitted: battle
// patrons are synthetic fairness data, not real NFTs, so paragon is never
// issued. After all events succeed a match_legacy_runs marker is written;
// any failure before that leaves the match for a later reconcile pass.
// Every write is idempotent by authorityKey, so retries and concurrent
// passes cannot duplicate events or awards.

import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { runMatch } from "@/lib/combat";
import { getDb } from "@/db/client";
import { matchEvidence, matchLegacyRuns, matchParticipants, matches, nftAchievementAwards, nftLegacyEvents } from "@/db/schema";
import { getNftByTokenId } from "@/db/nfts";
import { recordVerifiedNftLegacyEvent } from "@/db/legacy";
import { evaluateAchievements, type StoredLegacyEvent } from "@/lib/legacy";
import { ACHIEVEMENT_DEFINITIONS } from "@/lib/legacy";
import { evidenceDigest, type SettlementRecord } from "@/server/battle/settlement";
import { logger } from "@/lib/logger";
import type { CommanderIdentity } from "@/lib/battle-protocol";

type Db = ReturnType<typeof getDb>;

export class LegacyVerificationError extends Error {}

const LEGACY_SOURCE = "b3-settlement";
const LEGACY_ACTOR = "battle-server";
/** Battle-issued achievements only; paragon needs real patron history and
 * battle patrons are synthetic, so it is never emitted. */
const BATTLE_ACHIEVEMENT_CODES = new Set(["first_blood", "first_victory", "veteran"]);

interface EligibleSeat {
  seat: 0 | 1;
  tokenId: string;
  commanderClass: string;
  variant: string | null;
  derivationHash: string | null;
}

export class LegacyProcessor {
  private readonly dbOf: () => Db;
  private readonly inFlight = new Set<string>();
  /** Matches whose stored evidence failed re-verification in this process.
   * Skipped by reconcile so they can't starve newer matches; retried once
   * per process start. */
  private readonly refused = new Set<string>();

  constructor(deps: { db?: () => Db } = {}) {
    this.dbOf = deps.db ?? getDb;
  }

  /**
   * Re-verifies the settled match from durable rows and emits the NFT
   * legacy events it earned. Throws LegacyVerificationError when the
   * stored settlement does not reproduce; the match is then left without
   * a run marker, logged, and skipped by reconcile for the rest of this
   * process lifetime.
   */
  async processMatch(matchId: string): Promise<{ status: "done" | "no-eligible"; eventsCreated: number }> {
    const db = this.dbOf();
    const match = (await db.select().from(matches).where(eq(matches.id, matchId)).limit(1))[0];
    const refuse = (reason: string): never => {
      throw new LegacyVerificationError(`match ${matchId}: ${reason}`);
    };
    if (!match) refuse("not found");
    if (match.verification !== "replay-verified") refuse(`verification is ${match.verification}`);
    if (match.liveHash !== match.replayHash) refuse("live and replay hashes differ");

    const evidenceRow = (await db.select().from(matchEvidence).where(eq(matchEvidence.matchId, matchId)).limit(1))[0];
    if (!evidenceRow) refuse("evidence row missing");
    const evidence = evidenceRow.evidence as SettlementRecord["evidence"];
    if (evidenceDigest(evidence) !== match.evidenceSha256) refuse("stored evidence hash does not recompute");

    const replay = runMatch(evidence.config, evidence.commands);
    if (replay.result.stateHash !== match.liveHash) refuse("stored evidence does not reproduce the live hash");
    if (replay.result.endReason !== match.endReason) refuse("stored evidence endReason differs");

    // Deployment markers: the replay's commander_deployed event is the
    // authoritative battle appearance, seat-keyed by event.player.
    const deployed = new Map<number, string>();
    for (const e of replay.state.events) {
      if (e.type === "commander_deployed") deployed.set(e.player, e.commanderId);
    }

    const participants = await db
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, matchId))
      .orderBy(asc(matchParticipants.seat));

    const rulesetRefs = {
      combat: match.rulesetVersion ?? "unknown",
      protocol: match.protocolVersion ?? "unknown",
      commander: "v1",
    };
    const skips: string[] = [];
    const eligible: EligibleSeat[] = [];
    const outcomeBySeat = new Map<number, "victory" | "defeat">();
    if (match.outcome === "win" && match.winnerSeat !== null) {
      outcomeBySeat.set(match.winnerSeat, "victory");
      outcomeBySeat.set(match.winnerSeat === 0 ? 1 : 0, "defeat");
    }
    const resultBySeat = (seat: number): "win" | "loss" | "draw" =>
      match.outcome === "draw" ? "draw" : match.winnerSeat === seat ? "win" : "loss";

    for (const p of participants) {
      const seat = p.seat as 0 | 1;
      const identity = p.commanderIdentity as unknown as CommanderIdentity;
      const slot = evidence.config.commanders?.[seat];
      const deployedId = deployed.get(seat);
      const skip = (reason: string) => skips.push(`seat${seat}:${reason}`);
      if (p.commanderKind !== "nft") {
        skip("free-commander");
        continue;
      }
      if (identity?.kind !== "nft" || identity.basis !== "direct-owner" || !identity.verifiedAt) {
        skip("identity-provenance");
        continue;
      }
      if (!p.entitlementOwner) {
        skip("missing-owner");
        continue;
      }
      if (!p.nftTokenId || p.nftTokenId !== identity.tokenId) {
        skip("token-mismatch");
        continue;
      }
      if (!slot || slot.commanderId !== `nft-${p.nftTokenId}` || identity.commanderId !== slot.commanderId) {
        skip("slot-mismatch");
        continue;
      }
      if (deployedId !== slot.commanderId) {
        skip("not-deployed");
        continue;
      }
      // An unindexed token would make every retry fail; skip it with a reason instead.
      if (!(await getNftByTokenId(p.nftTokenId))) {
        skip("unknown-token");
        continue;
      }
      eligible.push({
        seat,
        tokenId: p.nftTokenId,
        commanderClass: p.commanderClass,
        variant: identity.variant ?? null,
        derivationHash: identity.derivationHash ?? null,
      });
    }

    let created = 0;
    for (const e of eligible) {
      const tokenId = e.tokenId;
      const appearance = await recordVerifiedNftLegacyEvent({
        source: LEGACY_SOURCE,
        actor: LEGACY_ACTOR,
        authorityKey: `b3:${matchId}:${tokenId}:appearance`,
        category: "commander_appearance",
        tokenId,
        matchId,
        matchStatus: "finalized",
        payload: {
          seat: e.seat,
          matchType: match.matchType,
          result: resultBySeat(e.seat),
          crowns: { mine: e.seat === 0 ? match.crowns0 : match.crowns1, opponent: e.seat === 0 ? match.crowns1 : match.crowns0 },
          endReason: match.endReason,
          commanderClass: e.commanderClass,
          variant: e.variant,
          derivationHash: e.derivationHash,
          basis: "direct-owner",
          evidenceSha256: match.evidenceSha256,
        },
        rulesetRefs,
        occurredAt: match.finishedAt,
      });
      if (appearance.created) created += 1;

      const outcome = outcomeBySeat.get(e.seat);
      if (outcome) {
        const event = await recordVerifiedNftLegacyEvent({
          source: LEGACY_SOURCE,
          actor: LEGACY_ACTOR,
          authorityKey: `b3:${matchId}:${tokenId}:outcome`,
          category: "commander_outcome",
          tokenId,
          matchId,
          matchStatus: "finalized",
          payload: {
            result: outcome,
            crowns: [match.crowns0, match.crowns1],
            endReason: match.endReason,
          },
          rulesetRefs,
          occurredAt: match.finishedAt,
        });
        if (event.created) created += 1;
      }

      created += await this.emitNewAchievements(matchId, tokenId, match.finishedAt, rulesetRefs);
    }

    const status = eligible.length > 0 ? "done" : "no-eligible";
    await db
      .insert(matchLegacyRuns)
      .values({
        matchId,
        status,
        eventsCreated: created,
        details: { eligible: eligible.length, skips },
      })
      .onConflictDoNothing({ target: [matchLegacyRuns.matchId] });
    return { status, eventsCreated: created };
  }

  /**
   * Evaluates the token's full history after this match's events and emits
   * an achievement event for each newly earned battle achievement that has
   * no award yet. Idempotent by authorityKey; returns events created.
   */
  private async emitNewAchievements(
    matchId: string,
    tokenId: string,
    occurredAt: Date,
    rulesetRefs: Record<string, string>
  ): Promise<number> {
    const db = this.dbOf();
    const nft = await getNftByTokenId(tokenId);
    if (!nft) return 0;
    const history = await db.select().from(nftLegacyEvents).where(eq(nftLegacyEvents.nftId, nft.token.id));
    const earned = evaluateAchievements(
      history.map((e): StoredLegacyEvent => ({
        authorityKey: e.authorityKey,
        category: e.category as StoredLegacyEvent["category"],
        tokenId: e.tokenId,
        matchId: e.matchId,
        matchStatus: e.matchStatus,
        payload: (e.payload ?? {}) as Record<string, unknown>,
        superseded: e.status !== "recorded",
      }))
    );
    const awards = await db.select().from(nftAchievementAwards).where(eq(nftAchievementAwards.nftId, nft.token.id));
    const awarded = new Set(awards.map((a) => a.achievementCode));
    let created = 0;
    for (const code of earned) {
      if (!BATTLE_ACHIEVEMENT_CODES.has(code) || awarded.has(code)) continue;
      const def = ACHIEVEMENT_DEFINITIONS.find((d) => d.code === code);
      if (!def) continue;
      const res = await recordVerifiedNftLegacyEvent({
        source: LEGACY_SOURCE,
        actor: LEGACY_ACTOR,
        authorityKey: `b3:achievement:${tokenId}:${code}`,
        category: "achievement",
        tokenId,
        matchId,
        matchStatus: "finalized",
        payload: { code, earnedInMatch: matchId },
        rulesetRefs,
        occurredAt,
      });
      if (res.created) created += 1;
    }
    return created;
  }

  /**
   * Processes settled matches that have no match_legacy_runs marker,
   * oldest first. Errors are logged and left for the next pass.
   * `onlyIds` scopes the scan; production sweeps call it unscoped.
   */
  async reconcile(limit = 50, onlyIds?: string[]): Promise<void> {
    const db = this.dbOf();
    const unmarked = isNull(matchLegacyRuns.matchId);
    const notRefused = this.refused.size > 0 ? notInArray(matches.id, [...this.refused]) : undefined;
    const due = await db
      .select({ id: matches.id })
      .from(matches)
      .leftJoin(matchLegacyRuns, eq(matchLegacyRuns.matchId, matches.id))
      .where(and(unmarked, notRefused, onlyIds ? inArray(matches.id, onlyIds) : undefined))
      .orderBy(asc(matches.settledAt))
      .limit(limit);
    for (const row of due) {
      if (this.inFlight.has(row.id)) continue;
      this.inFlight.add(row.id);
      try {
        await this.processMatch(row.id);
      } catch (err) {
        if (err instanceof LegacyVerificationError) this.refused.add(row.id);
        logger.error("legacy reconcile match failed", { matchId: row.id, reason: err instanceof Error ? err.message : String(err) });
      } finally {
        this.inFlight.delete(row.id);
      }
    }
  }
}
