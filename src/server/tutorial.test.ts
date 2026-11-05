import { describe, expect, it } from "vitest";
import { decideTutorialAccess } from "@/server/tutorial";

const release = { enforcedAt: new Date("2025-01-01T00:00:00Z"), grandfatherBefore: new Date("2025-01-01T00:00:00Z") };
const oldPlayer = new Date("2024-01-01T00:00:00Z");
const newPlayer = new Date("2026-01-01T00:00:00Z");

describe("Training Camp access policy", () => {
  it("allows everyone while the enforcement flag is off", () => {
    const decision = decideTutorialAccess({ schemaPresent: true, enforcementEnabled: false, release, playerCreatedAt: newPlayer, progress: null });
    expect(decision).toMatchObject({ access: "gate-off", allowed: true, markGrandfathered: false });
  });

  it("fails open when the schema is missing so a rollout mistake cannot lock everyone", () => {
    expect(decideTutorialAccess({ schemaPresent: false, enforcementEnabled: true, release, playerCreatedAt: newPlayer, progress: null })).toMatchObject({
      access: "schema-unavailable",
      allowed: true,
    });
  });

  it("fails open until the explicit release boundary exists", () => {
    expect(decideTutorialAccess({ schemaPresent: true, enforcementEnabled: true, release: null, playerCreatedAt: newPlayer, progress: null })).toMatchObject({
      access: "no-release",
      allowed: true,
    });
  });

  it("allows graduated and explicitly grandfathered players", () => {
    expect(decideTutorialAccess({ schemaPresent: true, enforcementEnabled: true, release, playerCreatedAt: newPlayer, progress: { stage: 3, grandfatheredAt: null } })).toMatchObject({
      access: "graduated",
      allowed: true,
    });
    expect(decideTutorialAccess({ schemaPresent: true, enforcementEnabled: true, release, playerCreatedAt: newPlayer, progress: { stage: 1, grandfatheredAt: new Date() } })).toMatchObject({
      access: "grandfathered",
      allowed: true,
    });
  });

  it("grandfathers accounts created before the release boundary and denies newer accounts", () => {
    expect(decideTutorialAccess({ schemaPresent: true, enforcementEnabled: true, release, playerCreatedAt: oldPlayer, progress: null })).toMatchObject({
      access: "grandfathered",
      allowed: true,
      markGrandfathered: true,
    });
    expect(decideTutorialAccess({ schemaPresent: true, enforcementEnabled: true, release, playerCreatedAt: newPlayer, progress: { stage: 1, grandfatheredAt: null } })).toMatchObject({
      access: "training-required",
      allowed: false,
      markGrandfathered: false,
      completedStages: 1,
    });
  });

  it("never lets a forged stage above three or a negative stage escape the contract", () => {
    expect(decideTutorialAccess({ schemaPresent: true, enforcementEnabled: true, release, playerCreatedAt: newPlayer, progress: { stage: 99, grandfatheredAt: null } }).completedStages).toBe(3);
    expect(decideTutorialAccess({ schemaPresent: true, enforcementEnabled: true, release, playerCreatedAt: newPlayer, progress: { stage: -1, grandfatheredAt: null } }).completedStages).toBe(0);
  });
});
