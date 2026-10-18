// Ruleset v1 engine tests: pure functions, no database, no network.
//
// Fixtures below labeled REAL-DATA are verbatim copies of resolved onchain
// Chog Genesis metadata (tokens 1-6, observed during B1 indexing). They are
// test INPUTS (layer A), never expected outputs. Synthetic fixtures are
// labeled SYNTHETIC.

import { describe, it, expect } from "vitest";
import {
  COMMANDER_RULESET_VERSION,
  COMMANDER_CLASSES,
  CLASS_ROSTER,
  POWER_BUDGET,
  deriveCommander,
  freeCommanderTemplates,
  rulesetSummary,
  type NftAttribute,
} from "./commanders";

// REAL-DATA fixture: token 1 (Uncommon, visor eyes, accessory, no aura).
const TOKEN_1: NftAttribute[] = [
  { trait_type: "Background", value: "Deep Aqua" },
  { trait_type: "Base", value: "Origin" },
  { trait_type: "Skin", value: "Pink" },
  { trait_type: "Side", value: "Left" },
  { trait_type: "Body", value: "Yellow 143 Jersey" },
  { trait_type: "Mouth", value: "Flat" },
  { trait_type: "Eyes", value: "BTC Glass" },
  { trait_type: "Head", value: "MCGA" },
  { trait_type: "Accessory", value: "Fwog" },
  { trait_type: "Form", value: "Chog" },
  { trait_type: "Tier", value: "Uncommon" },
  { trait_type: "Naked", value: "No" },
];

// REAL-DATA fixture: token 3 (Common, no aura, no accessory).
const TOKEN_3: NftAttribute[] = [
  { trait_type: "Background", value: "Rosie" },
  { trait_type: "Base", value: "Origin" },
  { trait_type: "Skin", value: "Red" },
  { trait_type: "Side", value: "Right" },
  { trait_type: "Body", value: "Red Chinese" },
  { trait_type: "Mouth", value: "Smile" },
  { trait_type: "Eyes", value: "Retro Glass" },
  { trait_type: "Head", value: "Red Peace Cap" },
  { trait_type: "Form", value: "Chog" },
  { trait_type: "Tier", value: "Common" },
  { trait_type: "Naked", value: "No" },
];

// REAL-DATA fixture: token 6 (Common, aura + laser eyes + cap).
const TOKEN_6: NftAttribute[] = [
  { trait_type: "Background", value: "Aqua Mint" },
  { trait_type: "Aura", value: "Light Purple" },
  { trait_type: "Base", value: "Origin" },
  { trait_type: "Skin", value: "Origin" },
  { trait_type: "Side", value: "Right" },
  { trait_type: "Body", value: "Black Trackset" },
  { trait_type: "Mouth", value: "wo" },
  { trait_type: "Eyes", value: "Green laser" },
  { trait_type: "Head", value: "TISM Cap" },
  { trait_type: "Form", value: "Chog" },
  { trait_type: "Tier", value: "Common" },
  { trait_type: "Naked", value: "No" },
];

describe("commander ruleset v1 determinism", () => {
  it("produces identical output for identical input", () => {
    const a = deriveCommander({ attributes: TOKEN_1 });
    const b = deriveCommander({ attributes: TOKEN_1 });
    expect(a).toEqual(b);
  });

  it("is independent of attribute ordering", () => {
    const shuffled = [...TOKEN_6].reverse();
    expect(deriveCommander({ attributes: shuffled })).toEqual(deriveCommander({ attributes: TOKEN_6 }));
  });

  it("does not mutate the input attributes", () => {
    const snapshot = JSON.parse(JSON.stringify(TOKEN_3));
    deriveCommander({ attributes: TOKEN_3 });
    expect(TOKEN_3).toEqual(snapshot);
  });

  it("stamps the ruleset version on every definition", () => {
    for (const attrs of [TOKEN_1, TOKEN_3, TOKEN_6]) {
      expect(deriveCommander({ attributes: attrs }).rulesetVersion).toBe(COMMANDER_RULESET_VERSION);
    }
  });
});

describe("real observed trait combinations", () => {
  it("resolves every real fixture to a valid class with complete stats and abilities", () => {
    for (const attrs of [TOKEN_1, TOKEN_3, TOKEN_6]) {
      const def = deriveCommander({ attributes: attrs });
      expect(COMMANDER_CLASSES).toContain(def.class);
      expect(COMMANDER_CLASSES).toContain(def.affinity);
      expect(def.stats.health).toBeGreaterThan(0);
      expect(def.stats.damage).toBeGreaterThan(0);
      expect(def.stats.dps).toBeGreaterThan(0);
      expect(def.abilities.length).toBeGreaterThan(0);
      for (const ab of def.abilities) {
        expect(ab.id).toBeTruthy();
        expect(ab.effects.length).toBeGreaterThan(0);
      }
      expect(def.derivationHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("resolves distinct real NFTs to (potentially) distinct commanders with documented signals", () => {
    const defs = [TOKEN_1, TOKEN_3, TOKEN_6].map((attributes) => deriveCommander({ attributes }));
    for (const def of defs) {
      expect(def.signals.length).toBeGreaterThan(0);
      for (const s of def.signals) {
        expect(s.reason).toBeTruthy();
      }
    }
    // Laser-eyed token 6 must lean ranged.
    const d6 = deriveCommander({ attributes: TOKEN_6 });
    expect(d6.scores.deadeye).toBeGreaterThan(0);
  });

  it("reports cosmetic Background traits as unmatched-cosmetic, never scored", () => {
    const def = deriveCommander({ attributes: TOKEN_3 });
    const bg = def.unmatchedTraits.find((u) => u.traitType === "Background");
    expect(bg).toBeDefined();
    expect(bg?.cosmetic).toBe(true);
    expect(def.signals.some((s) => s.traitType === "Background")).toBe(false);
  });
});

describe("unknown and missing traits (neutral fallback)", () => {
  it("handles empty attributes with a valid default commander", () => {
    const def = deriveCommander({ attributes: [] });
    expect(COMMANDER_CLASSES).toContain(def.class);
    expect(def.signals).toEqual([]);
    expect(def.stats.health).toBeGreaterThan(0);
    expect(def.abilities.length).toBeGreaterThan(0);
  });

  it("treats unknown trait types and values as neutral and reports them", () => {
    // SYNTHETIC: invented trait type that does not exist onchain.
    const def = deriveCommander({
      attributes: [
        { trait_type: "Wings", value: "Golden" },
        { trait_type: "Eyes", value: "Something Never Observed" },
      ],
    });
    expect(def.signals).toEqual([]);
    expect(def.unmatchedTraits).toHaveLength(2);
    expect(def.unmatchedTraits.every((u) => u.cosmetic === false)).toBe(true);
    expect(COMMANDER_CLASSES).toContain(def.class);
  });

  it("never invents attributes: every signal cites an observed input trait", () => {
    const def = deriveCommander({ attributes: TOKEN_1 });
    for (const s of def.signals) {
      const src = TOKEN_1.find((a) => a.trait_type === s.traitType && String(a.value) === s.traitValue);
      expect(src).toBeDefined();
    }
  });
});

describe("class mapping precedence", () => {
  it("breaks score ties by fixed precedence (bulwark before reaver)", () => {
    // SYNTHETIC: Metal skin (bulwark +3) vs Skull form (reaver +3) = tie.
    const def = deriveCommander({
      attributes: [
        { trait_type: "Skin", value: "Metal" },
        { trait_type: "Form", value: "Skull" },
      ],
    });
    expect(def.scores.bulwark).toBe(def.scores.reaver);
    expect(def.class).toBe("bulwark");
  });
});

describe("fairness invariants", () => {
  it("keeps every class base power score within tolerance of the mean", () => {
    const summary = rulesetSummary();
    const scores = summary.classes.map((c) => c.powerScore);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    for (const s of scores) {
      expect(Math.abs(s - mean) / mean).toBeLessThanOrEqual(POWER_BUDGET.classTolerance);
    }
  });

  it("gives Tier zero gameplay effect: same traits, different tiers, identical stats", () => {
    const base = TOKEN_3.filter((a) => a.trait_type !== "Tier");
    const tiers = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
    const defs = tiers.map((tier) => deriveCommander({ attributes: [...base, { trait_type: "Tier", value: tier }] }));
    for (const def of defs.slice(1)) {
      expect(def.stats).toEqual(defs[0]!.stats);
      expect(def.abilities).toEqual(defs[0]!.abilities);
      expect(def.powerScore).toBe(defs[0]!.powerScore);
      expect(def.class).toBe(defs[0]!.class);
    }
    expect(new Set(defs.map((d) => d.prestige)).size).toBe(tiers.length);
  });

  it("keeps sidegrade variants within tolerance of their class base", () => {
    // Battery of synthetic trait sets to cover all variant axes via hash spread.
    const skins = ["Origin", "Pink", "Red", "Yellow", "Black", "White", "Metal", "Blue", "Beige", "Green"];
    const eyes = ["Happy", "Dead", "Normal Eye", "Round", "Angry", "Tired", "Smirk", "MOG", "Teary", "fire laser"];
    for (let i = 0; i < skins.length; i++) {
      const def = deriveCommander({
        attributes: [
          { trait_type: "Skin", value: skins[i]! },
          { trait_type: "Eyes", value: eyes[i]! },
          { trait_type: "Tier", value: "Common" },
        ],
      });
      const summary = rulesetSummary();
      const classBase = summary.classes.find((c) => c.class === def.class)!;
      expect(Math.abs(def.powerScore - classBase.powerScore) / classBase.powerScore).toBeLessThanOrEqual(
        POWER_BUDGET.variantTolerance
      );
    }
  });

  it("grants free starters full parity with their NFT class peers", () => {
    const summary = rulesetSummary();
    const free = freeCommanderTemplates();
    expect(free).toHaveLength(COMMANDER_CLASSES.length);
    for (const t of free) {
      const peer = summary.classes.find((c) => c.class === t.class)!;
      expect(t.stats).toEqual(peer.baseStats);
      expect(t.abilities).toEqual(peer.abilities);
      expect(t.powerScore).toBe(peer.powerScore);
      expect(t.rulesetVersion).toBe(COMMANDER_RULESET_VERSION);
    }
  });
});

describe("ability specification validity (B2-consumable)", () => {
  const triggers = ["active", "deploy", "onDeath"];
  const kinds = ["damage", "heal", "shield", "slow", "stun", "haste", "cleanse", "damageBuff", "damageReflect"];
  const targets = ["self", "allies", "enemies", "enemiesInRadius"];

  it("uses only the typed trigger/effect/target vocabulary with sane timing", () => {
    for (const c of COMMANDER_CLASSES) {
      for (const ab of CLASS_ROSTER[c].abilities) {
        expect(triggers).toContain(ab.trigger);
        expect(ab.effects.length).toBeGreaterThan(0);
        if (ab.trigger === "active") expect(ab.cooldownMs).toBeGreaterThan(0);
        for (const fx of ab.effects) {
          expect(kinds).toContain(fx.kind);
          expect(targets).toContain(fx.target);
          expect(fx.magnitude).toBeGreaterThan(0);
        }
      }
    }
  });
});
