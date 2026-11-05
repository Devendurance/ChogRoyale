import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb, resetDbCache, routeDalToTestDb } from "@/db/client";
import { playerTutorialProgress, players, tutorialRelease } from "@/db/schema";
import { provisionPlayer } from "@/db/players";
import {
  completeTutorialStage,
  ensureTutorialRelease,
  getTutorialProgress,
} from "@/db/tutorial";
import { resetEnvCache } from "@/lib/env";
import { getTutorialSnapshot } from "@/server/tutorial";

const ids: string[] = [];

async function clean() {
  const db = getDb();
  if (ids.length) {
    await db.delete(playerTutorialProgress).where(inArray(playerTutorialProgress.playerId, ids));
    await db.delete(players).where(inArray(players.id, ids));
  }
  await db.delete(tutorialRelease).where(eq(tutorialRelease.id, 1));
}

beforeAll(async () => {
  routeDalToTestDb();
  await clean();
  process.env.TUTORIAL_ENFORCEMENT_ENABLED = "1";
  resetEnvCache();
});

afterAll(async () => {
  await clean();
  delete process.env.TUTORIAL_ENFORCEMENT_ENABLED;
  resetEnvCache();
  resetDbCache();
});

async function player(name: string, createdAt?: Date) {
  const row = await provisionPlayer({ privyDid: `did:privy:tutorial-${name}-${randomUUID()}`, displayName: name });
  ids.push(row.id);
  if (createdAt) await getDb().update(players).set({ createdAt }).where(eq(players.id, row.id));
  return row;
}

describe("Training Camp persistence", () => {
  it("advances one stage exactly once and refuses skips", async () => {
    const p = await player("progress");
    expect(await getTutorialProgress(p.id)).toBeNull();

    const skipped = await completeTutorialStage(p.id, 2);
    expect(skipped.status).toBe("out-of-order");
    expect(await getTutorialProgress(p.id)).toBeNull();

    const first = await completeTutorialStage(p.id, 1);
    expect(first.status).toBe("completed");
    expect(first.progress?.stage).toBe(1);
    const firstAt = first.progress?.stage1CompletedAt?.getTime();

    const duplicate = await completeTutorialStage(p.id, 1);
    expect(duplicate.status).toBe("already-complete");
    expect(duplicate.progress?.stage).toBe(1);
    expect(duplicate.progress?.stage1CompletedAt?.getTime()).toBe(firstAt);

    const second = await completeTutorialStage(p.id, 2);
    expect(second.status).toBe("completed");
    expect(second.progress?.stage).toBe(2);
    const secondAt = second.progress?.stage2CompletedAt?.getTime();
    const third = await completeTutorialStage(p.id, 3);
    expect(third.status).toBe("completed");
    expect(third.progress?.stage).toBe(3);
    expect(third.progress?.graduatedAt).not.toBeNull();
    expect(third.progress?.stage1CompletedAt?.getTime()).toBe(firstAt);
    expect(third.progress?.stage2CompletedAt?.getTime()).toBe(secondAt);

    // Graduation is written once and a replay never moves a timestamp.
    const graduatedAt = third.progress?.graduatedAt?.getTime();
    const replay = await completeTutorialStage(p.id, 3);
    expect(replay.status).toBe("already-complete");
    expect(replay.progress?.graduatedAt?.getTime()).toBe(graduatedAt);
    expect(replay.progress?.stage1CompletedAt?.getTime()).toBe(firstAt);
    expect(replay.progress?.stage2CompletedAt?.getTime()).toBe(secondAt);
  });

  it("survives two concurrent graduation attempts without a double write", async () => {
    const p = await player("concurrent");
    await completeTutorialStage(p.id, 1);
    await completeTutorialStage(p.id, 2);
    const results = await Promise.all([completeTutorialStage(p.id, 3), completeTutorialStage(p.id, 3)]);
    expect(results.map((entry) => entry.status).sort()).toEqual(["already-complete", "completed"]);
    const stored = await getTutorialProgress(p.id);
    expect(stored?.stage).toBe(3);
    expect(stored?.graduatedAt).not.toBeNull();
    expect(stored?.stage3CompletedAt?.getTime()).toBe(stored?.graduatedAt?.getTime());
  });

  it("keeps accounts isolated and does not fabricate another player's stage", async () => {
    const a = await player("isolated-a");
    const b = await player("isolated-b");
    expect((await completeTutorialStage(a.id, 1)).status).toBe("completed");
    expect(await getTutorialProgress(b.id)).toBeNull();
    expect((await getTutorialSnapshot(b.id)).completedStages).toBe(0);
  });

  it("grandfathers accounts before the release boundary and gates newer accounts", async () => {
    const oldAccount = await player("old", new Date("2020-01-01T00:00:00Z"));
    const newAccount = await player("new", new Date("2030-01-01T00:00:00Z"));
    const graduated = await player("graduated");
    await completeTutorialStage(graduated.id, 1);
    await completeTutorialStage(graduated.id, 2);
    await completeTutorialStage(graduated.id, 3);

    const release = await ensureTutorialRelease(new Date("2025-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"));
    expect(release.fresh).toBe(true);
    expect((await ensureTutorialRelease(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))).fresh).toBe(false);

    const oldView = await getTutorialSnapshot(oldAccount.id);
    expect(oldView.access).toBe("grandfathered");
    expect(oldView.grandfathered).toBe(true);
    expect((await getTutorialProgress(oldAccount.id))?.grandfatheredAt).not.toBeNull();

    expect((await getTutorialSnapshot(newAccount.id)).access).toBe("training-required");
    expect((await getTutorialSnapshot(graduated.id)).access).toBe("graduated");
  });

  it("returns to gate-off when enforcement is disabled", async () => {
    const p = await player("gate-off");
    delete process.env.TUTORIAL_ENFORCEMENT_ENABLED;
    resetEnvCache();
    expect((await getTutorialSnapshot(p.id)).access).toBe("gate-off");
    process.env.TUTORIAL_ENFORCEMENT_ENABLED = "1";
    resetEnvCache();
  });
});
