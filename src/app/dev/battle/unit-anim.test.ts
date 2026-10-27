import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILDING_CARDS_V1, COMMANDER_COMBAT_PROFILE_V1, SPAWNED_TROOPS_V1, TICKS_PER_SECOND, TROOP_CARDS_V1, initMatch, reach2, stepMatch, type CombatState } from "@/lib/combat";
import { deckWith, scenarioConfig } from "@/lib/arena-scenarios";
import { portraitCandidatesForCard, portraitForCommanderClass, resolveCommanderAsset, resolveEntityAsset, type SpriteManifest } from "./sprite-registry";
import {
  UNITS_URL,
  clipDurationMs,
  clipFrame,
  clipsFor,
  defeatAlpha,
  engagedFoe,
  newUnitAnimState,
  nextView,
  reachSq,
  sentryTrack,
  stepSentry,
  unitAnimFor,
  unitFrame,
  updateEngagement,
  type SentryFighter,
  type SentryTrack,
  type UnitAnimManifest,
  type UnitAnimRecord,
  type UnitClipName,
} from "./unit-anim";

const PUBLIC_ROOT = join(process.cwd(), "public");
const UNITS_ROOT = join(PUBLIC_ROOT, UNITS_URL);
const manifest = JSON.parse(readFileSync(join(UNITS_ROOT, "manifests/units.runtime.json"), "utf8")) as UnitAnimManifest;
const kit = JSON.parse(readFileSync(join(PUBLIC_ROOT, "assets/chog-kit/v001/manifests/phaser-assets.runtime.json"), "utf8")) as SpriteManifest;
const ORDER: UnitClipName[] = ["idle", "move", "attack", "hit", "defeat"];

const png = (file: string) => {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  // IHDR: width, height, bit depth, colour type (6 = RGBA).
  return { buf, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
};

// Final assets: every card troop, the four buildings, the five commander
// classes and the spawned Burrow Scrapper animate from the same package.
const byKind = (kind: UnitAnimRecord["kind"]) => Object.values(manifest.units).filter((u) => u.kind === kind);
const CLIP_ORDER: Record<string, UnitClipName[]> = {
  troop: ORDER,
  spawned: ORDER,
  building: ["idle", "deploy", "attack", "hit", "defeat"],
  commander: ["idle", "move", "attack", "hit", "defeat", "ability"],
};
const orderFor = (u: UnitAnimRecord) => CLIP_ORDER[u.kind ?? "troop"]!;
const ms = (ticks: number) => (ticks * 1000) / TICKS_PER_SECOND;

describe("unit animation manifest", () => {
  it("ships a sheet for every troop card in the ruleset, each with a legacy static fallback", () => {
    const troops = byKind(undefined);
    expect(troops.map((u) => u.entityId).sort()).toEqual(Object.keys(TROOP_CARDS_V1).sort());
    expect(troops).toHaveLength(12);
    for (const u of troops) expect(resolveEntityAsset(kit, "troop", u.entityId)?.stableAssetId).toBe(`troop:${u.entityId}`);
  });

  it("ships the four buildings, five commander classes and the spawned scrapper, each with a v001 fallback", () => {
    expect(byKind("building").map((u) => u.entityId).sort()).toEqual(Object.keys(BUILDING_CARDS_V1).sort());
    for (const u of byKind("building")) expect(resolveEntityAsset(kit, "building", u.entityId)?.stableAssetId).toBe(`building:${u.entityId}`);
    const classes = Object.keys(COMMANDER_COMBAT_PROFILE_V1);
    expect(byKind("commander").map((u) => u.entityId).sort()).toEqual(classes.map((c) => `commander_${c}`).sort());
    for (const cls of classes) expect(resolveCommanderAsset(kit, cls)?.stableAssetId).toBe(`commander:${cls}`);
    expect(byKind("spawned").map((u) => u.entityId)).toEqual(Object.keys(SPAWNED_TROOPS_V1));
    expect(resolveEntityAsset(kit, "troop", "burrow_scrapper")?.stableAssetId).toBe("spawned:burrow_scrapper");
  });

  it("matches every sheet on disk by hash, size and RGBA within the texture budget", () => {
    for (const u of Object.values(manifest.units)) {
      const sheet = png(join(UNITS_ROOT, u.sheet));
      expect(createHash("sha256").update(sheet.buf).digest("hex")).toBe(u.sha256);
      expect([sheet.width, sheet.height, sheet.colorType]).toEqual([u.width, u.height, 6]);
      expect(u.width).toBe(u.columns * u.frameWidth);
      expect(Math.ceil(u.frameCount / u.columns) * u.frameHeight).toBe(u.height);
      // Card troops keep their unused Slice 3-4 renders on disk. Final assets ship none.
      if (u.kind) expect(u.portrait).toBeUndefined();
      else {
        const portrait = png(join(UNITS_ROOT, u.portrait!));
        expect(createHash("sha256").update(portrait.buf).digest("hex")).toBe(u.portraitSha256);
        expect([portrait.width, portrait.height, portrait.colorType]).toEqual([256, 256, 6]);
      }
      // Mobile texture budget: each sheet stays under 6 MB of RGBA.
      expect(u.width * u.height * 4).toBeLessThan(6 * 1024 * 1024);
    }
    const rgba = (list: UnitAnimRecord[]) => list.reduce((n, u) => n + u.width * u.height * 4, 0);
    // The twelve card troops stay under 24 MB of RGBA and the whole package under 40 MB.
    expect(rgba(byKind(undefined))).toBeLessThan(24 * 1024 * 1024);
    expect(rgba(Object.values(manifest.units))).toBeLessThan(40 * 1024 * 1024);
  });

  it("lays out front then rear clips contiguously with a shared pivot", () => {
    for (const u of Object.values(manifest.units)) {
      const order = orderFor(u);
      let next = 0;
      for (const name of order) {
        const c = u.clips[name];
        expect(c, `${u.entityId} ${name}`).toBeDefined();
        expect(c!.start, `${u.entityId} ${name}`).toBe(next);
        expect(c!.count).toBeGreaterThanOrEqual(3);
        next += c!.count;
      }
      // Rear three-quarter clips mirror the front ones in count, fps, loop and
      // impact. The Decoy Totem and Chog Burrow face the camera only.
      if (u.rearClips) {
        for (const name of order) {
          const r = u.rearClips[name]!;
          expect(r.start, `${u.entityId} rear ${name}`).toBe(next);
          expect({ ...r, start: 0 }).toEqual({ ...u.clips[name], start: 0 });
          next += r.count;
        }
      } else expect(["decoy_totem", "chog_burrow"]).toContain(u.entityId);
      expect(next).toBe(u.frameCount);
      expect(u.clips.idle.loop).toBe(true);
      if (u.clips.move) expect(u.clips.move.loop).toBe(true);
      expect(u.clips.attack.loop || u.clips.hit.loop || u.clips.defeat.loop || !!u.clips.deploy?.loop || !!u.clips.ability?.loop).toBe(false);
      expect(u.clips.attack.impact).toBeGreaterThan(0);
      expect(u.clips.attack.impact).toBeLessThan(u.clips.attack.count);
      expect(u.pivotNormalized[0]).toBeCloseTo(u.pivot[0] / u.frameWidth, 6);
      expect(u.pivotNormalized[1]).toBeCloseTo(u.pivot[1] / u.frameHeight, 6);
      expect(u.facing).toBe("right");
    }
  });

  it("derives swing period and reach from the live ruleset", () => {
    for (const u of [...byKind(undefined), ...byKind("spawned")]) {
      const card = (TROOP_CARDS_V1[u.entityId] ?? SPAWNED_TROOPS_V1[u.entityId])!;
      expect(u.attackPeriodMs).toBe(ms(card.attackIntervalTicks));
      expect(u.reach).toBe(card.range);
      // engagedFoe only counts flying foes for units the ruleset lets hit air.
      expect(u.hitsAir).toBe(card.hitsAir);
      expect(u.air).toBe(card.moveType === "air");
      // The swing must finish inside one attack interval.
      expect(clipDurationMs(u.clips.attack)).toBeLessThan(u.attackPeriodMs);
    }
    for (const u of byKind("commander")) {
      const p = COMMANDER_COMBAT_PROFILE_V1[u.entityId.replace("commander_", "") as keyof typeof COMMANDER_COMBAT_PROFILE_V1];
      expect(u.attackPeriodMs).toBe(ms(p.intervalTicks));
      expect(u.reach).toBe(p.range);
      expect(u.hitsAir).toBe(p.hitsAir);
      expect(u.air).toBe(false);
      expect(clipDurationMs(u.clips.attack)).toBeLessThan(u.attackPeriodMs);
    }
    // Sentry and Mortar swing at their authored cadence and range. The
    // Burrow's spawn clip fits its wave interval. The Totem never attacks,
    // so its lure is a presentation-only cadence.
    const sentry = BUILDING_CARDS_V1.rift_sentry!;
    const mortar = BUILDING_CARDS_V1.rift_mortar!;
    const burrow = BUILDING_CARDS_V1.chog_burrow!;
    expect(manifest.units.rift_sentry!.attackPeriodMs).toBe(ms(sentry.attackIntervalTicks));
    expect(manifest.units.rift_sentry!.reach).toBe(sentry.range);
    expect(manifest.units.rift_sentry!.hitsAir).toBe(sentry.hitsAir);
    expect(manifest.units.rift_mortar!.attackPeriodMs).toBe(ms(mortar.attackIntervalTicks));
    expect(manifest.units.rift_mortar!.reach).toBe(mortar.range);
    expect(manifest.units.chog_burrow!.attackPeriodMs).toBe(ms(burrow.spawnIntervalTicks!));
    expect(BUILDING_CARDS_V1.decoy_totem!.damage).toBe(0);
    for (const u of byKind("building")) {
      expect(clipDurationMs(u.clips.attack)).toBeLessThan(u.attackPeriodMs);
      // The deploy clip never outlasts the slowest authored deploy (Mortar, 3 s).
      expect(clipDurationMs(u.clips.deploy!)).toBeLessThanOrEqual(ms(mortar.deployTicks));
    }
  });

  it("anchors muzzles inside their cells for the Sentry and Mortar", () => {
    for (const id of ["rift_sentry", "rift_mortar"]) {
      const u = manifest.units[id]!;
      for (const view of ["front", "rear"] as const) {
        const p = u.anchors?.muzzle?.[view]?.attack;
        expect(p, `${id} ${view}`).toBeDefined();
        expect(p![0]).toBeGreaterThan(0);
        expect(p![0]).toBeLessThan(u.frameWidth);
        expect(p![1]).toBeGreaterThan(0);
        expect(p![1]).toBeLessThan(u.pivot[1]);
      }
    }
  });

  it("keeps the original 2D illustration as the only card art for every card", () => {
    for (const u of [...byKind(undefined), ...byKind("building")]) {
      const candidates = portraitCandidatesForCard(kit, u.entityId);
      expect(candidates).toEqual([`/assets/chog-kit/v001/cards/derivatives/${u.entityId}/portrait.png`]);
      // The 3D renders never reach a card.
      expect(candidates.some((s) => s.startsWith(UNITS_URL))).toBe(false);
    }
    for (const cls of Object.keys(COMMANDER_COMBAT_PROFILE_V1)) {
      expect(portraitForCommanderClass(kit, cls)).toBe(`/assets/chog-kit/v001/cards/derivatives/commander_${cls}/portrait.png`);
    }
  });

  it("keeps Boulderback visibly heavier and slower than Choglings", () => {
    const c = manifest.units.choglings!;
    const b = manifest.units.boulderback!;
    expect(b.visibleHeight * b.displayScale).toBeGreaterThan(c.visibleHeight * c.displayScale * 1.3);
    expect(clipDurationMs(b.clips.move!)).toBeGreaterThan(clipDurationMs(c.clips.move!));
    expect(b.clips.move!.fps).toBeLessThan(c.clips.move!.fps);
  });
});

describe("unit animation state", () => {
  const rec = manifest.units.choglings!;

  it("wraps loops and holds one-shots on their last frame", () => {
    const { idle, defeat } = rec.clips;
    expect(clipFrame(idle, 0)).toBe(idle.start);
    expect(clipFrame(idle, clipDurationMs(idle))).toBe(idle.start);
    expect(clipFrame(defeat, 1e6)).toBe(defeat.start + defeat.count - 1);
    expect(clipFrame(defeat, -50)).toBe(defeat.start);
  });

  it("orders defeat over swing over hit over move over idle", () => {
    const now = 10_000;
    const st = newUnitAnimState(0);
    expect(unitFrame(rec, st, { now, moving: false }).clip).toBe("idle");
    expect(unitFrame(rec, st, { now, moving: true }).clip).toBe("move");
    const hit = { ...st, hitAt: now - 10 };
    expect(unitFrame(rec, hit, { now, moving: true }).clip).toBe("hit");
    const swinging = { ...hit, engagedSince: now - 20 };
    expect(unitFrame(rec, swinging, { now, moving: false }).clip).toBe("attack");
    expect(unitFrame(rec, { ...swinging, goneAt: now - 5 }, { now, moving: false }).clip).toBe("defeat");
  });

  it("repeats the swing once per attack interval and idles between swings", () => {
    const st = { ...newUnitAnimState(0), engagedSince: 0 };
    const swing = clipDurationMs(rec.clips.attack);
    expect(unitFrame(rec, st, { now: 0, moving: false }).frame).toBe(rec.clips.attack.start);
    expect(unitFrame(rec, st, { now: swing + 1, moving: false }).clip).toBe("idle");
    expect(unitFrame(rec, st, { now: rec.attackPeriodMs, moving: false }).frame).toBe(rec.clips.attack.start);
  });

  it("anchors engagement on its rising edge and clears it on release", () => {
    let st = newUnitAnimState(0);
    st = updateEngagement(st, true, 100);
    st = updateEngagement(st, true, 400);
    expect(st.engagedSince).toBe(100);
    expect(updateEngagement(st, false, 500).engagedSince).toBeNull();
  });

  it("fades the defeat clip only in its final stretch", () => {
    expect(defeatAlpha(rec, 0)).toBe(1);
    expect(defeatAlpha(rec, rec.defeatMs * 0.6)).toBe(1);
    expect(defeatAlpha(rec, rec.defeatMs)).toBe(0);
  });

  it("measures reach exactly like the combat ruleset", () => {
    for (const [ux, uy, t] of [
      [10, 10, { x: 12, y: 11, r: 0 }],
      [30, 34, { x: 30, y: 40, r: 3 }],
      [55, 150, { x: 50, y: 152, r: 4 }],
    ] as const) {
      expect(reachSq(ux, uy, t)).toBe(reach2(ux, uy, t));
    }
  });

  it("counts flying foes only for units that can hit air", () => {
    const u = { x: 30, y: 30 };
    const flyer = { x: 30, y: 44, r: 0, air: true };
    expect(engagedFoe(u, 14, [flyer])).toBeNull();
    expect(engagedFoe(u, 14, [flyer], undefined, true)).toBe(flyer);
    expect(engagedFoe(u, 12, [flyer], undefined, true)).toBeNull();
    const archer = manifest.units.chaos_archer!;
    expect(engagedFoe(u, archer.reach, [flyer], undefined, archer.hitsAir)).toBe(flyer);
  });

  it("engages the nearest ground foe in reach and ignores air", () => {
    // One cell short of the tower's footprint ring: gap 1, inside reach 2.
    const u = { x: 30, y: 35 };
    const tower = { x: 30, y: 40, r: 3 };
    const flyer = { x: 30, y: 35.5, r: 0, air: true };
    expect(engagedFoe(u, 2, [flyer])).toBeNull();
    expect(engagedFoe(u, 2, [flyer, tower])).toBe(tower);
    const close = { x: 30.5, y: 35, r: 0 };
    expect(engagedFoe(u, 2, [tower, close])).toBe(close);
    expect(engagedFoe({ x: 30, y: 20 }, 2, [tower])).toBeNull();
  });

  it("faces the rear view when heading up the screen and the front when heading down", () => {
    expect(nextView("front", 0, -1)).toBe("rear");
    expect(nextView("rear", 0.4, 1)).toBe("front");
    expect(nextView("front", -1, -1)).toBe("rear");
    // Near-horizontal or no heading keeps the current view, so there's no flicker.
    expect(nextView("rear", 1, 0.1)).toBe("rear");
    expect(nextView("front", -1, -0.2)).toBe("front");
    expect(nextView("rear", 0, 0)).toBe("rear");
  });

  it("swaps only the clip table between views, keeping the frame index in step", () => {
    const st = newUnitAnimState(0);
    for (const [moving, clip] of [[false, "idle"], [true, "move"]] as const) {
      for (const now of [0, 130, 777]) {
        const f = unitFrame(rec, st, { now, moving, view: "front" });
        const r = unitFrame(rec, st, { now, moving, view: "rear" });
        expect(f.clip).toBe(clip);
        expect(r.clip).toBe(clip);
        expect(r.frame - rec.rearClips![clip]!.start).toBe(f.frame - rec.clips[clip]!.start);
      }
    }
    const dying = { ...st, goneAt: 0 };
    expect(unitFrame(rec, dying, { now: 200, moving: false, view: "rear" }).frame).toBeGreaterThanOrEqual(rec.rearClips!.defeat.start);
    // Older sheets without rear clips fall back to the front table.
    const frontOnly = { ...rec, rearClips: undefined };
    expect(clipsFor(frontOnly, "rear")).toBe(frontOnly.clips);
    expect(unitFrame(frontOnly, st, { now: 0, moving: false, view: "rear" }).frame).toBe(rec.clips.idle.start);
  });

  it("returns null for ids without an animation sheet", () => {
    expect(unitAnimFor(manifest, "chaos_bolt")).toBeNull();
    expect(unitAnimFor(manifest, "commander_paragon")).toBeNull();
    expect(unitAnimFor(null, "choglings")).toBeNull();
    expect(unitAnimFor(manifest, "choglings")?.entityId).toBe("choglings");
  });
});

describe("Rift Sentry fire replica", () => {
  const SENTRY = BUILDING_CARDS_V1.rift_sentry!;
  const rule = { range: SENTRY.range, interval: SENTRY.attackIntervalTicks };
  const b = { owner: 0, x: 50, y: 40 };
  const f = (id: string, x: number, y: number, hp = 100, o: Partial<SentryFighter> = {}): SentryFighter => ({ id, owner: 1, x, y, hp, maxHp: 100, shield: 0, air: false, ...o });

  it("matches the manifest timing to the live ruleset", () => {
    const rec = manifest.units.rift_sentry!;
    expect(rec.reach).toBe(SENTRY.range);
    expect(Math.round(rec.attackPeriodMs / 100)).toBe(SENTRY.attackIntervalTicks);
  });

  it("waits for activeAt, then fires at most once per interval at the nearest landed target", () => {
    let t = sentryTrack(20);
    expect(stepSentry(t, b, rule, 19, [f("a", 50, 50)], [f("a", 50, 50, 84)]).shot).toBeNull();
    t = stepSentry(t, b, rule, 19, [f("a", 50, 50)], [f("a", 50, 50, 84)]).track;
    const s = stepSentry(t, b, rule, 20, [f("a", 50, 50), f("b", 50, 45)], [f("a", 50, 50, 84), f("b", 50, 45, 84)]);
    expect(s.shot?.id).toBe("b");
    expect(s.track.nextShot).toBe(20 + SENTRY.attackIntervalTicks);
    expect(stepSentry(s.track, b, rule, 21, [f("b", 50, 45, 84)], [f("b", 50, 45, 60)]).shot).toBeNull();
  });

  it("keeps its lock, skips air, out-of-range and friendly fighters, and needs a visible hit", () => {
    const t = { ...sentryTrack(0), targetId: "far", lastTick: 9 };
    const prev = [f("far", 50, 55), f("near", 50, 42)];
    expect(stepSentry(t, b, rule, 10, prev, [f("far", 50, 55, 84), f("near", 50, 42, 84)]).shot?.id).toBe("far");
    const out = [f("air", 50, 41, 100, { air: true }), f("own", 50, 41, 100, { owner: 0 }), f("edge", 50, 56.01)];
    expect(stepSentry(sentryTrack(0), b, rule, 10, out, out.map((x) => ({ ...x, hp: 50 }))).shot).toBeNull();
    const noHit = stepSentry(sentryTrack(0), b, rule, 10, [f("a", 50, 50)], [f("a", 50, 50)]);
    expect(noHit.shot).toBeNull();
    expect(noHit.track.nextShot).toBe(10 + SENTRY.attackIntervalTicks);
    expect(stepSentry(sentryTrack(0), b, rule, 10, [f("a", 50, 50, 100, { shield: 30 })], [f("a", 50, 50, 100, { shield: 14 })]).shot?.id).toBe("a");
    expect(stepSentry(sentryTrack(0), b, rule, 10, [f("a", 50, 50, 10)], []).shot?.id).toBe("a");
    expect(stepSentry({ ...sentryTrack(0), lastTick: 7 }, b, rule, 10, [f("a", 50, 50)], [f("a", 50, 50, 84)]).shot).toBeNull();
  });

  it("lands every replicated shot on the tick and target the real engine fires", () => {
    const s = initMatch(scenarioConfig(deckWith("rift_sentry"), deckWith("boulderback", "choglings")));
    const cmds = [
      { seq: 1, player: 0 as const, tick: 1, cardId: "rift_sentry", x: 40, y: 70 },
      { seq: 2, player: 1 as const, tick: 2, cardId: "boulderback", x: 30, y: 100 },
      { seq: 3, player: 1 as const, tick: 40, cardId: "choglings", x: 50, y: 100 },
    ];
    const pub = (st: CombatState): SentryFighter[] =>
      [...st.troops, ...st.commanders].filter((u) => u.hp > 0).map((u) => ({ id: u.id, owner: u.owner, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, shield: u.shieldHp, air: u.moveType === "air" }));
    let prev: SentryFighter[] = [];
    let track: SentryTrack | null = null;
    let real = 0;
    let shown = 0;
    for (let i = 0; i < 400 && s.phase !== "final"; i++) {
      const before = s.buildings[0] ? { cd: s.buildings[0].cooldownUntil } : null;
      stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
      const sb = s.buildings.find((x) => x.cardId === "rift_sentry");
      const cur = pub(s);
      if (sb) {
        track ??= sentryTrack(sb.cooldownUntil);
        const fired = before !== null && sb.cooldownUntil !== before.cd;
        const step = stepSentry(track, sb, rule, s.tick, prev, cur);
        track = step.track;
        if (fired) real += 1;
        if (step.shot) {
          shown += 1;
          expect(fired).toBe(true);
          expect(step.shot.id).toBe(sb.targetId);
        }
      }
      prev = cur;
    }
    expect(real).toBeGreaterThan(5);
    expect(shown).toBe(real);
  });
});
