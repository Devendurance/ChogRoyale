import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ABILITY_RUNTIME_V1, SPELL_CARDS_V1, runtimeAbilities } from "@/lib/combat";
import {
  ABILITY_STATUS,
  SPELL_STATUS,
  TEX_RADIUS,
  VFX_LIMITS,
  VFX_S,
  VFX_URL,
  abilityVfx,
  admitSprites,
  commanderEntityFor,
  projectileStyleFor,
  spellCastVfx,
  spellImpactVfx,
  spriteAlpha,
  statusesFromEvent,
  type StatusUnit,
  type VfxManifest,
} from "./battle-vfx";

const ROOT = join(process.cwd(), "public", VFX_URL);
const manifest = JSON.parse(readFileSync(join(ROOT, "manifests/vfx.runtime.json"), "utf8")) as VfxManifest;
const radius = (id: string) => SPELL_CARDS_V1[id]?.radius;
const ctx = { radius, reduced: false };
const unit = (id: string, owner: number, x: number, y: number, kind: StatusUnit["kind"] = "troop", cardId = "choglings"): StatusUnit => ({ id, owner, x, y, kind, cardId });

describe("battle VFX manifest", () => {
  it("ships every texture on disk by hash and size, within a small RGBA budget", () => {
    let total = 0;
    for (const [key, t] of Object.entries(manifest.textures)) {
      const buf = readFileSync(join(ROOT, t.path));
      expect(createHash("sha256").update(buf).digest("hex"), key).toBe(t.sha256);
      expect([buf.readUInt32BE(16), buf.readUInt32BE(20), buf[25]]).toEqual([t.width, t.height, 6]);
      if (t.kind === "sheet") expect(t.frameWidth! * t.frames!).toBe(t.width);
      total += t.width * t.height * 4;
    }
    expect(total).toBeLessThan(3 * 1024 * 1024);
  });

  it("provides every texture the planners and canvas reference", () => {
    for (const k of ["glow", "ring", "ground-ring", "spark", "streak", "muzzle", "burst", "smoke", "debris", "bolt", "comet", "comet-trail", "horn", "snare-sigil", "snare-bind", "shield", "summon", "arrow", "net", "star"]) {
      expect(manifest.textures[k], k).toBeDefined();
    }
  });
});

describe("spell effects", () => {
  const cast = (cardId: string, extra = {}) => ({ type: "spell_cast", tick: 40, player: 0, cardId, x: 30, y: 60, affected: 1, ...extra });

  it("draws each area boundary at exactly the ruleset radius", () => {
    for (const id of ["chaos_bolt", "rally_horn", "rift_snare", "chaos_comet"]) {
      const r = SPELL_CARDS_V1[id]!.radius;
      const rings = spellCastVfx(cast(id), ctx).filter((s) => s.tex === "ring");
      expect(rings.some((s) => Math.abs((s.scale1 ?? s.scale) * TEX_RADIUS.ring - r * VFX_S) < 1e-6), id).toBe(true);
    }
    const sigil = spellCastVfx(cast("rift_snare"), ctx).find((s) => s.tex === "snare-sigil")!;
    expect(sigil.scale1! * TEX_RADIUS["snare-sigil"]).toBeCloseTo(SPELL_CARDS_V1.rift_snare!.radius * VFX_S, 6);
  });

  it("keeps spell effects short-lived and bounded", () => {
    for (const id of ["chaos_bolt", "rally_horn", "rift_snare", "chaos_comet"]) {
      const s = spellCastVfx(cast(id), ctx);
      expect(s.length).toBeLessThanOrEqual(16);
      for (const sp of s) expect((sp.delay ?? 0) + sp.life).toBeLessThanOrEqual(1200);
    }
    const impact = spellImpactVfx({ type: "spell_impact", tick: 46, player: 0, cardId: "chaos_comet", impactId: "i1", x: 30, y: 60 }, ctx);
    expect(impact.length).toBeLessThanOrEqual(24);
    expect(spellImpactVfx({ type: "spell_impact", tick: 46, player: 0, cardId: "rift_snare", impactId: "i2", x: 30, y: 60 }, ctx)).toEqual([]);
  });

  it("is deterministic per event and lighter under reduced motion", () => {
    const e = cast("chaos_bolt");
    expect(spellCastVfx(e, ctx)).toEqual(spellCastVfx(e, ctx));
    expect(spellCastVfx(e, { radius, reduced: true }).length).toBeLessThan(spellCastVfx(e, ctx).length);
  });

  it("never recolours elemental effects by allegiance", () => {
    for (const id of ["chaos_bolt", "rally_horn", "rift_snare"]) {
      const tints = (p: number) => spellCastVfx(cast(id, { player: p }), ctx).map((s) => s.tint);
      expect(tints(1)).toEqual(tints(0));
    }
  });
});

describe("status markers mirror the rule each event applied", () => {
  const units = [unit("a", 0, 30, 60), unit("b", 0, 30, 73), unit("c", 1, 34, 62), unit("d", 1, 30, 66, "commander", "cmdr:free-warden"), unit("e", 0, 31, 61, "commander", "cmdr:free-scout")];

  it("buffs only friendly troops inside Rally Horn's radius for 120 ticks", () => {
    const s = statusesFromEvent({ type: "spell_cast", tick: 10, player: 0, cardId: "rally_horn", x: 30, y: 60 }, units);
    expect(s.map((x) => x.entityId)).toEqual(["a"]);
    expect(s[0]!.until).toBe(10 + SPELL_CARDS_V1.rally_horn!.buffDurationTicks);
    expect(SPELL_STATUS.rally_horn.radius).toBe(SPELL_CARDS_V1.rally_horn!.radius);
  });

  it("snares enemy troops and commanders inside Rift Snare's radius for its slow", () => {
    const s = statusesFromEvent({ type: "spell_impact", tick: 20, player: 0, cardId: "rift_snare", x: 30, y: 60 }, units);
    expect(s.map((x) => x.entityId).sort()).toEqual(["c", "d"]);
    expect(s[0]!.until).toBe(20 + SPELL_CARDS_V1.rift_snare!.impact!.slowDurationTicks);
    expect(SPELL_STATUS.rift_snare.radius).toBe(SPELL_CARDS_V1.rift_snare!.radius);
  });

  it("marks commander abilities on their authoritative targets and durations", () => {
    const fired = (abilityId: string, player: number, commanderId: string, activeUntil: number | null, x = 30, y = 66) =>
      ({ type: "ability_fired", tick: 50, player, commanderId, abilityId, trigger: "active", x, y, radius: null, activeUntil });
    const nf = statusesFromEvent(fired("warden-null-field", 1, "free-warden", 90), units);
    expect(nf.find((s) => s.kind === "null-shield")?.entityId).toBe("d");
    // b sits 7 units from the Warden, inside the 8-unit field.
    expect(nf.filter((s) => s.kind === "null-slow").map((s) => s.entityId).sort()).toEqual(["a", "b", "e"]);
    expect(nf.find((s) => s.kind === "null-slow")!.until).toBe(50 + ABILITY_STATUS.nullFieldTicks);
    const pf = statusesFromEvent(fired("scout-pathfinder", 0, "free-scout", 100, 31, 61), units);
    // b sits 12 units from the Scout, outside the 10-unit radius.
    expect(pf.map((s) => s.entityId).sort()).toEqual(["a", "e"]);
    expect(commanderEntityFor(fired("bulwark-aegis-wall", 0, "free-scout", 90), units)?.id).toBe("e");
    // Ruleset parity for the mirrored radii and durations.
    expect(ABILITY_RUNTIME_V1["warden-null-field"]![0]!.radius).toBe(ABILITY_STATUS.nullFieldRadius);
    expect(ABILITY_RUNTIME_V1["scout-pathfinder"]![0]!.radius).toBe(ABILITY_STATUS.pathfinderRadius);
    expect(runtimeAbilities("warden").find((a) => a.id === "warden-null-field")!.effects[0]!.durationMs).toBe(ABILITY_STATUS.nullFieldTicks * 100);
    expect(runtimeAbilities("scout").find((a) => a.id === "scout-pathfinder")!.effects[0]!.durationMs).toBe(ABILITY_STATUS.pathfinderTicks * 100);
  });

  it("fires a Piercing Volley arrow at each enemy inside its radius only", () => {
    const e = { type: "ability_fired", tick: 5, player: 0, commanderId: "free-deadeye", abilityId: "deadeye-piercing-volley", trigger: "active", x: 30, y: 60, radius: 14 };
    const arrows = abilityVfx(e, [...units, unit("far", 1, 30, 90)], false).filter((s) => s.tex === "arrow");
    expect(arrows.map((a) => a.to)).toEqual([{ x: 34, y: 62 }, { x: 30, y: 66 }]);
  });
});

describe("projectiles and pool limits", () => {
  it("styles a projectile by the nearest same-owner shooter that fires projectiles", () => {
    const shooters = [{ owner: 0, x: 10, y: 10, cardId: "sparkcaster" }, { owner: 1, x: 10.5, y: 10, cardId: "hexwing" }, { owner: 0, x: 40, y: 40, cardId: "gale_netter" }];
    expect(projectileStyleFor({ owner: 0, x: 10.2, y: 10 }, shooters)).toBe("spark");
    expect(projectileStyleFor({ owner: 1, x: 10.2, y: 10 }, shooters)).toBe("hex");
    expect(projectileStyleFor({ owner: 0, x: 40, y: 41 }, shooters)).toBe("net");
    expect(projectileStyleFor({ owner: 0, x: 70, y: 70 }, shooters)).toBe("plain");
  });

  it("drops new sprites beyond the live cap without evicting live ones", () => {
    const specs = Array.from({ length: 10 }, () => ({ tex: "spark", x: 0, y: 0, life: 100, scale: 1, layer: "top" as const }));
    expect(admitSprites(VFX_LIMITS.maxSprites - 4, specs)).toHaveLength(4);
    expect(admitSprites(VFX_LIMITS.maxSprites, specs)).toHaveLength(0);
  });

  it("fades by fadeIn and fadeAt", () => {
    const s = { tex: "x", x: 0, y: 0, life: 100, scale: 1, layer: "top" as const, alpha: 1, alpha1: 0, fadeIn: 0.2, fadeAt: 0.6 };
    expect(spriteAlpha(s, 0.1)).toBeCloseTo(0.5);
    expect(spriteAlpha(s, 0.4)).toBe(1);
    expect(spriteAlpha(s, 0.8)).toBeCloseTo(0.5);
  });
});
