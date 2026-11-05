// Training Camp persistence. Additive player progress plus the owner-gated
// release boundary. Nothing here is called from the browser except through
// authenticated reads. Stage completion is server-owned and exactly once.
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { playerTutorialProgress, players, tutorialRelease, type PlayerTutorialProgressRow } from "@/db/schema";
import type { TutorialStage } from "@/lib/tutorial-camp";

export async function tutorialTablesPresent(): Promise<boolean> {
  const db = getDb();
  const res = await db.execute(sql`
    select to_regclass('public.player_tutorial_progress') as progress,
           to_regclass('public.tutorial_release') as release
  `);
  const row = (res.rows as Array<{ progress: string | null; release: string | null }>)[0];
  return !!row?.progress && !!row?.release;
}

export async function getTutorialProgress(playerId: string): Promise<PlayerTutorialProgressRow | null> {
  const db = getDb();
  const rows = await db.select().from(playerTutorialProgress).where(eq(playerTutorialProgress.playerId, playerId)).limit(1);
  return rows[0] ?? null;
}

export async function getPlayerCreatedAt(playerId: string): Promise<Date | null> {
  const db = getDb();
  const rows = await db.select({ createdAt: players.createdAt }).from(players).where(eq(players.id, playerId)).limit(1);
  return rows[0]?.createdAt ?? null;
}

export async function getTutorialRelease(): Promise<{ enforcedAt: Date; grandfatherBefore: Date } | null> {
  const db = getDb();
  const rows = await db.select().from(tutorialRelease).where(eq(tutorialRelease.id, 1)).limit(1);
  const row = rows[0];
  return row ? { enforcedAt: row.enforcedAt, grandfatherBefore: row.grandfatherBefore } : null;
}

/** Owner-only activation helper. Idempotent: the singleton never moves. */
export async function ensureTutorialRelease(
  enforcedAt: Date,
  grandfatherBefore: Date,
): Promise<{ enforcedAt: Date; grandfatherBefore: Date; fresh: boolean }> {
  const db = getDb();
  const inserted = await db
    .insert(tutorialRelease)
    .values({ id: 1, enforcedAt, grandfatherBefore })
    .onConflictDoNothing({ target: [tutorialRelease.id] })
    .returning({ enforcedAt: tutorialRelease.enforcedAt, grandfatherBefore: tutorialRelease.grandfatherBefore });
  if (inserted[0]) return { ...inserted[0], fresh: true };
  const existing = await getTutorialRelease();
  if (!existing) throw new Error("Tutorial release missing after insert");
  return { ...existing, fresh: false };
}

export type TutorialCompletionResult =
  | { status: "completed"; progress: PlayerTutorialProgressRow }
  | { status: "already-complete"; progress: PlayerTutorialProgressRow | null }
  | { status: "out-of-order"; progress: PlayerTutorialProgressRow | null };

/**
 * Advance exactly one stage. A duplicate is idempotent; a skip is refused.
 * The conditional upsert makes concurrent duplicates safe: the loser reads
 * the committed row instead of overwriting a timestamp or skipping ahead.
 */
export async function completeTutorialStage(playerId: string, stage: TutorialStage): Promise<TutorialCompletionResult> {
  const current = await getTutorialProgress(playerId);
  const currentStage = current?.stage ?? 0;
  if (currentStage >= stage) return { status: "already-complete", progress: current };
  if (currentStage !== stage - 1) return { status: "out-of-order", progress: current };

  const now = new Date();
  const db = getDb();
  if (!current) {
    const inserted = await db
      .insert(playerTutorialProgress)
      .values({
        playerId,
        stage,
        stage1CompletedAt: stage === 1 ? now : null,
        stage2CompletedAt: stage === 2 ? now : null,
        stage3CompletedAt: stage === 3 ? now : null,
        graduatedAt: stage === 3 ? now : null,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: playerTutorialProgress.playerId })
      .returning();
    if (inserted[0]) return { status: "completed", progress: inserted[0] };
    const after = await getTutorialProgress(playerId);
    return after && after.stage >= stage ? { status: "already-complete", progress: after } : { status: "out-of-order", progress: after };
  }

  const rows = await db
    .update(playerTutorialProgress)
    .set({
      stage,
      ...(stage === 1 ? { stage1CompletedAt: now } : {}),
      ...(stage === 2 ? { stage2CompletedAt: now } : {}),
      ...(stage === 3 ? { stage3CompletedAt: now, graduatedAt: now } : {}),
      updatedAt: now,
    })
    .where(and(eq(playerTutorialProgress.playerId, playerId), eq(playerTutorialProgress.stage, stage - 1)))
    .returning();
  if (rows[0]) return { status: "completed", progress: rows[0] };
  const after = await getTutorialProgress(playerId);
  return after && after.stage >= stage ? { status: "already-complete", progress: after } : { status: "out-of-order", progress: after };
}

/** Mark an existing account as exempt without inventing a stage completion. */
export async function markTutorialGrandfathered(playerId: string): Promise<PlayerTutorialProgressRow> {
  const now = new Date();
  const db = getDb();
  const rows = await db
    .insert(playerTutorialProgress)
    .values({ playerId, stage: 0, grandfatheredAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: playerTutorialProgress.playerId,
      set: {
        grandfatheredAt: sql`coalesce(${playerTutorialProgress.grandfatheredAt}, excluded.grandfathered_at)`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning();
  if (!rows[0]) throw new Error("Tutorial grandfather write returned no row");
  return rows[0];
}
