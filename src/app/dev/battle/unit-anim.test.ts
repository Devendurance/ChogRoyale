import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TICKS_PER_SECOND, TROOP_CARDS_V1, reach2 } from "@/lib/combat";
import { portraitCandidatesForCard, resolveEntityAsset, type SpriteManifest } from "./sprite-registry";
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
  unitAnimFor,
  unitFrame,
  updateEngagement,
  type UnitAnimManifest,
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

describe("unit animation manifest", () => {
  it("ships a sheet for every troop card in the ruleset, each with a legacy static fallback", () => {
    expect(Object.keys(manifest.units).sort()).toEqual(Object.keys(TROOP_CARDS_V1).sort());
    expect(Object.keys(manifest.units)).toHaveLength(12);
    for (const id of Object.keys(manifest.units)) {
      expect(resolveEntityAsset(kit, "troop", id)?.stableAssetId).toBe(`troop:${id}`);
    }
  });

  it("matches every sheet and portrait on disk by hash, size and RGBA", () => {
    for (const u of Object.values(manifest.units)) {
      const sheet = png(join(UNITS_ROOT, u.sheet));
      expect(createHash("sha256").update(sheet.buf).digest("hex")).toBe(u.sha256);
      expect([sheet.width, sheet.height, sheet.colorType]).toEqual([u.width, u.height, 6]);
      expect(u.width).toBe(u.columns * u.frameWidth);
      expect(Math.ceil(u.frameCount / u.columns) * u.frameHeight).toBe(u.height);
      const portrait = png(join(UNITS_ROOT, u.portrait));
      expect(createHash("sha256").update(portrait.buf).digest("hex")).toBe(u.portraitSha256);
      expect([portrait.width, portrait.height, portrait.colorType]).toEqual([256, 256, 6]);
      // Mobile texture budget: each sheet stays under 6 MB of RGBA.
      expect(u.width * u.height * 4).toBeLessThan(6 * 1024 * 1024);
    }
    // All twelve sheets together stay under 24 MB of RGBA.
    const total = Object.values(manifest.units).reduce((n, u) => n + u.width * u.height * 4, 0);
    expect(total).toBeLessThan(24 * 1024 * 1024);
  });

  it("lays out front then rear clips contiguously with a shared pivot", () => {
    for (const u of Object.values(manifest.units)) {
      let next = 0;
      for (const name of ORDER) {
        const c = u.clips[name];
        expect(c.start, `${u.entityId} ${name}`).toBe(next);
        expect(c.count).toBeGreaterThanOrEqual(3);
        next += c.count;
      }
      // Rear three-quarter clips mirror the front ones in count, fps, loop and impact.
      for (const name of ORDER) {
        const r = u.rearClips![name];
        expect(r.start, `${u.entityId} rear ${name}`).toBe(next);
        expect({ ...r, start: 0 }).toEqual({ ...u.clips[name], start: 0 });
        next += r.count;
      }
      expect(next).toBe(u.frameCount);
      expect(u.clips.idle.loop && u.clips.move.loop).toBe(true);
      expect(u.clips.attack.loop || u.clips.hit.loop || u.clips.defeat.loop).toBe(false);
      expect(u.clips.attack.impact).toBeGreaterThan(0);
      expect(u.clips.attack.impact).toBeLessThan(u.clips.attack.count);
      expect(u.pivotNormalized[0]).toBeCloseTo(u.pivot[0] / u.frameWidth, 6);
      expect(u.pivotNormalized[1]).toBeCloseTo(u.pivot[1] / u.frameHeight, 6);
      expect(u.facing).toBe("right");
    }
  });

  it("derives swing period and reach from the live ruleset", () => {
    for (const u of Object.values(manifest.units)) {
      const card = TROOP_CARDS_V1[u.entityId]!;
      expect(u.attackPeriodMs).toBe((card.attackIntervalTicks * 1000) / TICKS_PER_SECOND);
      expect(u.reach).toBe(card.range);
      // engagedFoe only counts flying foes for units the ruleset lets hit air.
      expect(u.hitsAir).toBe(card.hitsAir);
      expect(u.air).toBe(card.moveType === "air");
      // The swing must finish inside one attack interval.
      expect(clipDurationMs(u.clips.attack)).toBeLessThan(u.attackPeriodMs);
    }
  });

  it("keeps the original 2D illustration as the only card art for every troop", () => {
    for (const u of Object.values(manifest.units)) {
      const candidates = portraitCandidatesForCard(kit, u.entityId);
      expect(candidates).toEqual([`/assets/chog-kit/v001/cards/derivatives/${u.entityId}/portrait.png`]);
      // The 3D portrait renders stay on disk but never reach a card.
      expect(candidates.some((s) => s.startsWith(UNITS_URL))).toBe(false);
    }
    expect(portraitCandidatesForCard(kit, "rift_sentry")).toEqual(["/assets/chog-kit/v001/cards/derivatives/rift_sentry/portrait.png"]);
  });

  it("keeps Boulderback visibly heavier and slower than Choglings", () => {
    const c = manifest.units.choglings!;
    const b = manifest.units.boulderback!;
    expect(b.visibleHeight * b.displayScale).toBeGreaterThan(c.visibleHeight * c.displayScale * 1.3);
    expect(clipDurationMs(b.clips.move)).toBeGreaterThan(clipDurationMs(c.clips.move));
    expect(b.clips.move.fps).toBeLessThan(c.clips.move.fps);
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
        expect(r.frame - rec.rearClips![clip].start).toBe(f.frame - rec.clips[clip].start);
      }
    }
    const dying = { ...st, goneAt: 0 };
    expect(unitFrame(rec, dying, { now: 200, moving: false, view: "rear" }).frame).toBeGreaterThanOrEqual(rec.rearClips!.defeat.start);
    // Older sheets without rear clips fall back to the front table.
    const frontOnly = { ...rec, rearClips: undefined };
    expect(clipsFor(frontOnly, "rear")).toBe(frontOnly.clips);
    expect(unitFrame(frontOnly, st, { now: 0, moving: false, view: "rear" }).frame).toBe(rec.clips.idle.start);
  });

  it("returns null for cards without an animation sheet", () => {

    expect(unitAnimFor(manifest, "rift_sentry")).toBeNull();
    expect(unitAnimFor(manifest, "burrow_scrapper")).toBeNull();
    expect(unitAnimFor(null, "choglings")).toBeNull();
    expect(unitAnimFor(manifest, "choglings")?.entityId).toBe("choglings");
  });
});
