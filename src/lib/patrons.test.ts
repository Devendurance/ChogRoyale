// Arena Patron derivation tests (pure, no DB).

import { describe, it, expect } from "vitest";
import {
  derivePatronConfig,
  selectPatronTokenId,
  themeForBackground,
  PATRON_RULESET_VERSION,
} from "@/lib/patrons";

const ATTRS = [
  { trait_type: "Background", value: "Light Magenta" },
  { trait_type: "Skin", value: "Red" },
  { trait_type: "Aura", value: "Ember Glow" },
  { trait_type: "Tier", value: "Legendary" },
];

describe("derivePatronConfig", () => {
  it("derives deterministically from the same inputs", () => {
    const a = derivePatronConfig({ tokenId: "1", attributes: ATTRS, metadataContentHash: "abc123" });
    const b = derivePatronConfig({ tokenId: BigInt(1), attributes: ATTRS, metadataContentHash: "abc123" });
    expect(a).toEqual(b);
    expect(a.rulesetVersion).toBe(PATRON_RULESET_VERSION);
    expect(a.configHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("maps distinct traits to distinct configs", () => {
    const common = derivePatronConfig({
      tokenId: "2",
      attributes: [
        { trait_type: "Background", value: "Deep Frost" },
        { trait_type: "Tier", value: "Common" },
      ],
      metadataContentHash: "def456",
    });
    const legendary = derivePatronConfig({ tokenId: "1", attributes: ATTRS, metadataContentHash: "abc123" });
    expect(legendary.theme).toBe("ember");
    expect(common.theme).toBe("frost");
    expect(legendary.configHash).not.toBe(common.configHash);
  });

  it("uses documented neutral fallbacks without inventing values", () => {
    const bare = derivePatronConfig({ tokenId: "3", attributes: [], metadataContentHash: "fff" });
    expect(bare.theme).toBe("prismatic");
    expect(bare.themeSignal).toBeNull();
    expect(bare.aura).toBeNull();
    expect(bare.auraFallback).toBe(true);
    expect(bare.tier).toBeNull();
  });

  it("carries no power numbers (fairness by construction)", () => {
    const c = derivePatronConfig({ tokenId: "1", attributes: ATTRS, metadataContentHash: "abc123" });
    expect(Object.keys(c).sort()).toEqual(
      ["aura", "auraFallback", "configHash", "metadataContentHash", "name", "rulesetVersion", "theme", "themeSignal", "tier", "tokenId"].sort()
    );
    expect(JSON.stringify(c)).not.toMatch(/power|stat|buff|multiplier|damage/i);
  });

  it("rejects bad token IDs and unresolved metadata", () => {
    expect(() => derivePatronConfig({ tokenId: "abc", attributes: [], metadataContentHash: "x" })).toThrow();
    expect(() => derivePatronConfig({ tokenId: "1", attributes: [], metadataContentHash: "unresolved" })).toThrow();
    expect(() => derivePatronConfig({ tokenId: "1", attributes: [], metadataContentHash: "" })).toThrow();
  });

  it("ignores non-string attribute values, keeps first of each signal", () => {
    const c = derivePatronConfig({
      tokenId: "4",
      attributes: [
        { trait_type: "Tier", value: 5 },
        { trait_type: "Tier", value: "Common" },
        { trait_type: "Tier", value: "Rare" },
      ],
      metadataContentHash: "x1",
    });
    expect(c.tier).toBe("Common");
  });
});

describe("themeForBackground", () => {
  it("falls back to prismatic for unmapped backgrounds", () => {
    expect(themeForBackground("Light Magenta")).toEqual({ theme: "ember", signal: "Light Magenta" });
    expect(themeForBackground("Chartreuse Dots")).toEqual({ theme: "prismatic", signal: "Chartreuse Dots" });
    expect(themeForBackground(null)).toEqual({ theme: "prismatic", signal: null });
  });
});

describe("selectPatronTokenId", () => {
  const pool = ["3", "1", "2"];
  it("is deterministic and order-independent", () => {
    const a = selectPatronTokenId("match-seed-1", pool);
    const b = selectPatronTokenId("match-seed-1", ["1", "2", "3"]);
    expect(a).toBe(b);
    expect(pool).toContain(a);
  });
  it("varies with seed", () => {
    const picks = new Set(Array.from({ length: 20 }, (_, i) => selectPatronTokenId(`seed-${i}`, pool)));
    expect(picks.size).toBeGreaterThan(1);
  });
  it("rejects empty seed and empty pool", () => {
    expect(() => selectPatronTokenId("", pool)).toThrow();
    expect(() => selectPatronTokenId("s", [])).toThrow();
  });
});
