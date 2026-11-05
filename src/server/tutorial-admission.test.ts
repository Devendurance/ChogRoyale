import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";

// The admission path owns exactly one decision: deny an ungraduated new player
// when the read works, and fail open when the tutorial read itself is down.
const db = vi.hoisted(() => ({
  fail: false,
  present: true,
  release: {
    enforcedAt: new Date("2025-01-01T00:00:00Z"),
    grandfatherBefore: new Date("2025-01-01T00:00:00Z"),
  },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  progress: null as { stage: number; grandfatheredAt: Date | null } | null,
}));

vi.mock("@/db/tutorial", () => ({
  tutorialTablesPresent: async () => {
    if (db.fail) throw new Error("tutorial database unavailable");
    return db.present;
  },
  getTutorialRelease: async () => db.release,
  getPlayerCreatedAt: async () => db.createdAt,
  getTutorialProgress: async () => db.progress,
  markTutorialGrandfathered: async () => ({
    playerId: "player",
    stage: 0,
    grandfatheredAt: new Date("2025-01-01T00:00:00Z"),
  }),
}));

import { getTutorialAdmission } from "./tutorial";

const originalFlag = process.env.TUTORIAL_ENFORCEMENT_ENABLED;

function enforcement(on: boolean) {
  process.env.TUTORIAL_ENFORCEMENT_ENABLED = on ? "1" : "0";
  resetEnvCache();
}

beforeEach(() => {
  db.fail = false;
  db.present = true;
  db.progress = null;
  db.createdAt = new Date("2026-01-01T00:00:00Z");
});

afterAll(() => {
  if (originalFlag === undefined) delete process.env.TUTORIAL_ENFORCEMENT_ENABLED;
  else process.env.TUTORIAL_ENFORCEMENT_ENABLED = originalFlag;
  resetEnvCache();
});

describe("tutorial admission fail-open", () => {
  it("still denies an ungraduated new player when enforcement is active", async () => {
    enforcement(true);
    await expect(getTutorialAdmission("new-player")).resolves.toEqual({
      allowed: false,
      access: "training-required",
    });
  });

  it("allows graduated and explicitly grandfathered players", async () => {
    enforcement(true);
    db.progress = { stage: 3, grandfatheredAt: null };
    await expect(getTutorialAdmission("graduated")).resolves.toEqual({
      allowed: true,
      access: "graduated",
    });

    db.progress = { stage: 1, grandfatheredAt: new Date("2025-06-01T00:00:00Z") };
    await expect(getTutorialAdmission("grandfathered")).resolves.toEqual({
      allowed: true,
      access: "grandfathered",
    });
  });

  it("fails open only when the tutorial read is unavailable", async () => {
    enforcement(true);
    db.fail = true;
    await expect(getTutorialAdmission("new-player")).resolves.toEqual({
      allowed: true,
      access: "schema-unavailable",
    });
  });

  it("does not read the tutorial database while enforcement is off", async () => {
    enforcement(false);
    db.fail = true;
    await expect(getTutorialAdmission("any-player")).resolves.toEqual({
      allowed: true,
      access: "gate-off",
    });
  });
});
