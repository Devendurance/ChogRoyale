// Chaos Pulse engine tests (pure, fixtures labeled as fixtures).

import { describe, it, expect } from "vitest";
import {
  deriveChaosSchedule,
  familyForSlot,
  pickInBounds,
  CHAOS_BOUNDS_V1,
  CHAOS_TIMELINE_V1,
  type ChaosSchedule,
} from "@/lib/chaos";
import type { PatronConfig } from "@/lib/patrons";

function fixturePatron(overrides: Partial<PatronConfig> = {}): PatronConfig {
  return {
    rulesetVersion: "v1",
    tokenId: "1",
    name: "CHOG #1462",
    tier: "Uncommon",
    aura: null,
    auraFallback: true,
    theme: "frost",
    themeSignal: "Deep Aqua",
    metadataContentHash: "ed8a767d4563322675da8d3ea789c011eb892f222960ad20646d5c8c12b6a697",
    configHash: "bcf85486dbcd20cbea38fe84c4933288155a0eeec587dedc3caf6037aff48c1a",
    ...overrides,
  };
}

describe("deriveChaosSchedule", () => {
  it("is deterministic for identical inputs", () => {
    const a = deriveChaosSchedule({ patron: fixturePatron(), serverSeed: "seed-1", matchKey: "m-1" });
    const b = deriveChaosSchedule({ patron: fixturePatron(), serverSeed: "seed-1", matchKey: "m-1" });
    expect(a).toEqual(b);
    expect(a.scheduleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.events).toHaveLength(3);
  });

  it("opens with the patron theme family (selection precedence)", () => {
    const s = deriveChaosSchedule({ patron: fixturePatron({ theme: "ember" }), serverSeed: "x" });
    expect(s.events[0]?.family).toBe("ember_rift");
    expect(familyForSlot("prismatic", 0, 3)).toBe("chaos_rally");
  });

  it("varies with seed but stays within versioned bounds", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const s: ChaosSchedule = deriveChaosSchedule({ patron: fixturePatron(), serverSeed: `seed-${i}` });
      seen.add(s.scheduleHash);
      for (const e of s.events) {
        expect(e.warnMs).toBeLessThan(e.activationMs);
        expect(e.expireMs).toBeGreaterThan(e.activationMs);
        expect(e.expireMs).toBeLessThanOrEqual(CHAOS_TIMELINE_V1.durationMs + CHAOS_TIMELINE_V1.overtimeMs);
        expect(e.telegraphed).toBe(true);
        expect(e.zones.length).toBeGreaterThan(0);
        const fx = e.effect as { durationMs?: number; dps?: number; multiplierPct?: number; deltaPct?: number };
        if (fx.durationMs !== undefined) {
          expect(fx.durationMs).toBeGreaterThanOrEqual(CHAOS_BOUNDS_V1.durationMs.min);
          expect(fx.durationMs).toBeLessThanOrEqual(CHAOS_BOUNDS_V1.durationMs.max);
        }
        if (fx.dps !== undefined) {
          expect(fx.dps).toBeGreaterThanOrEqual(CHAOS_BOUNDS_V1.hazardDps.min);
          expect(fx.dps).toBeLessThanOrEqual(CHAOS_BOUNDS_V1.hazardDps.max);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("is tier-neutral: rarity changes names only, never magnitudes", () => {
    const tiers = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
    const schedules = tiers.map((tier) =>
      deriveChaosSchedule({ patron: fixturePatron({ tier }), serverSeed: "fixed-seed" })
    );
    const first = JSON.stringify(schedules[0]?.events.map((e) => ({ ...e, displayName: "X", id: "Y" })));
    for (const s of schedules) {
      expect(JSON.stringify(s.events.map((e) => ({ ...e, displayName: "X", id: "Y" })))).toBe(first);
    }
    expect(schedules[0]?.events[0]?.displayName).toMatch(/^Common /);
    expect(schedules[4]?.events[0]?.displayName).toMatch(/^Legendary /);
  });

  it("keeps effects symmetrical (no owner/player-specific payloads)", () => {
    const s = deriveChaosSchedule({ patron: fixturePatron(), serverSeed: "sym" });
    for (const e of s.events) {
      expect(["all_units", "both_players", "both_players_units"]).toContain(e.effect.scope);
      expect(JSON.stringify(e.effect)).not.toMatch(/owner|player1|player2|wallet|advantage/i);
    }
  });

  it("uses the documented neutral zone order without aura", () => {
    const noAura = deriveChaosSchedule({ patron: fixturePatron({ aura: null }), serverSeed: "z" });
    const frost = noAura.events.find((e) => e.family === "frost_crossing");
    if (frost) expect(frost.zones).toEqual(["north", "center", "south"]);
  });

  it("rejects invalid inputs", () => {
    expect(() => deriveChaosSchedule({ patron: fixturePatron({ tokenId: "abc" }), serverSeed: "s" })).toThrow();
    expect(() => deriveChaosSchedule({ patron: fixturePatron(), serverSeed: "" })).toThrow();
    expect(() =>
      deriveChaosSchedule({ patron: fixturePatron({ configHash: "short" }), serverSeed: "s" })
    ).toThrow();
  });

  it("picks quantized values inside bounds", () => {
    for (let i = 0; i < 50; i++) {
      const v = pickInBounds("t", [`p${i}`], 90, 135, 5);
      expect(v).toBeGreaterThanOrEqual(90);
      expect(v).toBeLessThanOrEqual(135);
      expect(v % 5).toBe(0);
    }
  });
});
