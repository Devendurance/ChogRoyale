// NFT legacy persistence: append-only verified history + achievement awards.
//
// TRUST BOUNDARY: recordVerifiedNftLegacyEvent accepts server-origin events
// only. The caller must name an authoritative source from the allowlist
// (B3 settlement in production, manual correction with a human actor).
// There is deliberately NO public API route that calls this function, so
// users cannot award themselves victories or achievements. Unknown sources
// are rejected with FORBIDDEN, and this is machine-tested.
//
// Integrity: authorityKey is globally unique (idempotent retries, replay
// safe). Conflicting outcomes for the same match+token are rejected.
// Corrections never overwrite: a correction event supersedes its target,
// which is then excluded from all aggregates.

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  nftLegacyEvents,
  legacyAchievements,
  nftAchievementAwards,
  type NftLegacyEvent,
  type NftAchievementAward,
} from "@/db/schema";
import { CHOG_GENESIS_ADDRESS } from "@/lib/chain";
import { getNftByTokenId } from "@/db/nfts";
import {
  ACHIEVEMENT_DEFINITIONS,
  LEGACY_SCHEMA_VERSION,
  aggregateLegacyStats,
  evaluateAchievements,
  validateLegacyEventInput,
  type LegacyEventInput,
  type NftLegacyStats,
  type StoredLegacyEvent,
} from "@/lib/legacy";
import { AppError } from "@/lib/errors";

export const TRUSTED_LEGACY_SOURCES = ["b3-settlement", "manual-correction"] as const;

export interface RecordLegacyEventInput extends LegacyEventInput {
  source: string;
  actor: string;
  occurredAt?: Date;
}

function toStored(e: NftLegacyEvent): StoredLegacyEvent {
  return {
    authorityKey: e.authorityKey,
    category: e.category as StoredLegacyEvent["category"],
    tokenId: e.tokenId,
    matchId: e.matchId,
    matchStatus: e.matchStatus,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    superseded: e.status !== "recorded",
  };
}

export async function ensureLegacyAchievements() {
  const db = getDb();
  for (const def of ACHIEVEMENT_DEFINITIONS) {
    await db
      .insert(legacyAchievements)
      .values({
        code: def.code,
        version: def.version,
        name: def.name,
        description: def.description,
        eligibility: def.eligibility,
      })
      .onConflictDoUpdate({
        target: [legacyAchievements.code],
        set: { version: def.version, name: def.name, description: def.description, eligibility: def.eligibility },
      });
  }
}

export async function recordVerifiedNftLegacyEvent(
  input: RecordLegacyEventInput
): Promise<{ event: NftLegacyEvent; created: boolean; award: NftAchievementAward | null }> {
  if (!(TRUSTED_LEGACY_SOURCES as readonly string[]).includes(input.source)) {
    throw new AppError("FORBIDDEN", `Untrusted legacy event source: ${input.source}`);
  }
  if (!input.actor || input.actor.trim().length === 0) {
    throw new AppError("FORBIDDEN", "Legacy event requires an accountable actor");
  }
  try {
    validateLegacyEventInput(input);
  } catch (err) {
    throw new AppError("BAD_REQUEST", err instanceof Error ? err.message : "Invalid legacy event");
  }
  const tokenId = input.tokenId.toString();
  const db = getDb();
  const replayed = await db
    .select()
    .from(nftLegacyEvents)
    .where(eq(nftLegacyEvents.authorityKey, input.authorityKey))
    .limit(1);
  if (replayed[0]) return { event: replayed[0], created: false, award: null };

  const nft = await getNftByTokenId(tokenId);
  if (!nft || nft.token.contractAddress.toLowerCase() !== CHOG_GENESIS_ADDRESS.toLowerCase()) {
    throw new AppError("NOT_FOUND", `Genesis NFT ${tokenId} not found`);
  }

  if (input.category === "commander_outcome" && input.matchId) {
    const prior = await db
      .select()
      .from(nftLegacyEvents)
      .where(
        and(
          eq(nftLegacyEvents.nftId, nft.token.id),
          eq(nftLegacyEvents.category, "commander_outcome"),
          eq(nftLegacyEvents.matchId, input.matchId)
        )
      );
    for (const p of prior) {
      if (p.status !== "recorded") continue;
      // A correction explicitly superseding this row is a revision, not a conflict.
      if (input.supersedesAuthorityKey && p.authorityKey === input.supersedesAuthorityKey) continue;
      const prevResult = (p.payload as { result?: string } | null)?.result;
      const nextResult = (input.payload as { result?: string }).result;
      if (prevResult !== nextResult) {
        throw new AppError("CONFLICT", `Conflicting outcome for match ${input.matchId} on token ${tokenId}`);
      }
    }
  }

  let supersedesEventId: string | null = null;
  if (input.supersedesAuthorityKey) {
    const target = await db
      .select()
      .from(nftLegacyEvents)
      .where(eq(nftLegacyEvents.authorityKey, input.supersedesAuthorityKey))
      .limit(1);
    if (!target[0] || target[0].nftId !== nft.token.id) {
      throw new AppError("UNPROCESSABLE", "Correction target not found for this NFT");
    }
    supersedesEventId = target[0].id;
  }

  const rows = await db
    .insert(nftLegacyEvents)
    .values({
      authorityKey: input.authorityKey,
      nftId: nft.token.id,
      tokenId,
      category: input.category,
      matchId: input.matchId,
      matchStatus: input.matchStatus,
      payload: input.payload,
      rulesetRefs: { ...input.rulesetRefs, legacySchema: LEGACY_SCHEMA_VERSION },
      source: input.source,
      actor: input.actor,
      supersedesEventId,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing({ target: [nftLegacyEvents.authorityKey] })
    .returning();
  const event = rows[0];
  if (!event) {
    const winner = await db
      .select()
      .from(nftLegacyEvents)
      .where(eq(nftLegacyEvents.authorityKey, input.authorityKey))
      .limit(1);
    if (!winner[0]) throw new Error("Legacy event insert failed");
    return { event: winner[0], created: false, award: null };
  }
  if (supersedesEventId) {
    await db
      .update(nftLegacyEvents)
      .set({ status: "corrected" })
      .where(eq(nftLegacyEvents.id, supersedesEventId));
  }

  let award: NftAchievementAward | null = null;
  if (input.category === "achievement") {
    const code = (input.payload as { code?: string }).code;
    const def = code ? ACHIEVEMENT_DEFINITIONS.find((d) => d.code === code) : undefined;
    if (!def || !code) throw new AppError("BAD_REQUEST", `Unknown achievement code: ${code}`);
    await ensureLegacyAchievements();
    const history = await db
      .select()
      .from(nftLegacyEvents)
      .where(eq(nftLegacyEvents.nftId, nft.token.id));
    const earned = evaluateAchievements(history.map(toStored));
    if (!earned.includes(code)) {
      throw new AppError("UNPROCESSABLE", `Achievement ${code} not yet earned by token ${tokenId}`);
    }
    const awarded = await db
      .insert(nftAchievementAwards)
      .values({ nftId: nft.token.id, tokenId, achievementCode: code, evidence: { authorityKey: input.authorityKey } })
      .onConflictDoNothing({ target: [nftAchievementAwards.nftId, nftAchievementAwards.achievementCode] })
      .returning();
    award = awarded[0] ?? null;
  }
  return { event, created: true, award };
}

export interface NftLegacyRead {
  tokenId: string;
  stats: NftLegacyStats;
  achievements: Array<{ code: string; name: string; awardedAt: Date | null }>;
  history: NftLegacyEvent[];
  total: number;
}

export async function getNftLegacy(
  tokenId: string | bigint,
  opts?: { limit?: number; offset?: number }
): Promise<NftLegacyRead> {
  const tid = tokenId.toString();
  if (!/^[0-9]{1,78}$/.test(tid)) throw new AppError("BAD_REQUEST", `Invalid token ID: ${tid}`);
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 50);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const db = getDb();
  const nft = await getNftByTokenId(tid);
  if (!nft || nft.token.contractAddress.toLowerCase() !== CHOG_GENESIS_ADDRESS.toLowerCase()) {
    throw new AppError("NOT_FOUND", `Genesis NFT ${tid} not found`);
  }
  const all = await db.select().from(nftLegacyEvents).where(eq(nftLegacyEvents.nftId, nft.token.id));
  const totalRows = await db.execute(
    sql`select count(*)::int as n from nft_legacy_events where nft_id = ${nft.token.id}`
  );
  const total = (totalRows as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? all.length;
  const history = await db
    .select()
    .from(nftLegacyEvents)
    .where(eq(nftLegacyEvents.nftId, nft.token.id))
    .orderBy(desc(nftLegacyEvents.occurredAt))
    .limit(limit)
    .offset(offset);
  const awards = await db
    .select()
    .from(nftAchievementAwards)
    .where(eq(nftAchievementAwards.nftId, nft.token.id));
  const awardByCode = new Map(awards.map((a) => [a.achievementCode, a.awardedAt]));
  const stats = aggregateLegacyStats(all.map(toStored));
  await ensureLegacyAchievements();
  const defs = await db.select().from(legacyAchievements);
  const defByCode = new Map(defs.map((d) => [d.code, d.name]));
  return {
    tokenId: tid,
    stats,
    achievements: stats.achievements.map((code) => ({
      code,
      name: defByCode.get(code) ?? code,
      awardedAt: awardByCode.get(code) ?? null,
    })),
    history,
    total,
  };
}
