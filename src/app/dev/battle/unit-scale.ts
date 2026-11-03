// Central draw-size policy for animated unit sheets. Pure, no Phaser.
//
// The packed sheets carry `displayScale` (board px per sheet px) chosen per
// unit so every sheet samples near 1:1. That left a Boulderback no taller
// than a Chog Guardian and both barely above a Choglings, so mass read as
// noise. This module maps each animated entity to an explicit size class and
// a target drawn height in board px (the 500x800 canvas, 5 board px per arena
// unit). Every consumer of the drawn size (sprite scale, contact ring,
// shadow, HP bar, hit ring lift, status markers, muzzle/tip anchors) goes
// through `unitDrawScale` / `unitDrawnHeight`, so the art, its ground pivot
// and its effects stay locked together. Presentation only: it never touches
// the authoritative position, hitbox, reach, spacing or the 100x160 mapping.
//
// Policy: drawScale = displayScale * clamp(target / currentDrawn, 0.85, 1.45)
// where currentDrawn = visibleHeight * displayScale. The clamp keeps a sheet
// from being upsampled into mush or shrunk below its authored detail.
//
// Calibration (fixture captures from a local BattleSession recording drawn by
// the real BattleCanvas, game-feel-overhaul/battle in ChogRoyale-Assets).
// CSS px = board px x canvas CSS width / 500. The HUD board measured 338 CSS
// px wide at 390x844 (0.676) and 354 at 1366x768 (0.708).
//
//   class         target  before board / CSS@390   after board / CSS@390 / CSS@1366
//   swarm           38     38 / 25.7                38 / 25.7 / 26.9
//   flying_swarm    36     34 / 23.0                36 / 24.3 / 25.5
//   regular         48     44-48 / 29.7-32.4        48 / 32.4 / 34.0
//   flying          50     50 / 33.8                50 / 33.8 / 35.4
//   heavy           56     50-54 / 33.8-36.5        56 / 37.9 / 39.6
//   commander       58     50-58                    58 / 39.2 / 41.1 (computed, no commander in fixture)
//   titan           62     52 / 35.2                62 / 41.9 / 43.9
//
// The first targets (regular 50, heavy 62, titan 74,
// commander 64) were measured and pulled down: at 74 the Boulderback's idle
// frame was 78 board px wide and its attack frame 85, wider than a bridge
// (13 arena units = 65 board px, measured 64 on the v003 art). At 62 its
// widest idle/move frame is 65-66 board px, about one bridge width, and its
// attack swing peaks at 72. It does not cover a tower in the captures.
// Heavy and the rest step down to keep swarm < regular < heavy < titan.
// Commanders sit at 58, below the titan's 62, so the Boulderback stays the
// largest actor on the board. Their 58 is computed from sheet metadata
// (visibleHeight x displayScale, multiplier inside the clamp), not captured:
// no commander appears in the fixture, so that row is still unverified.
// Swarms stay above 22 CSS px at 390 wide.
//
// Full-screen world pass (PR #24 correction): the owner judged the targets
// above too small on real screens. Measured against the reference battler
// footage, a regular troop there stands about 11-12% of the field width and
// its titan about 15%; ours stood 9.6% and 12.4%. Targets rise about 25%:
// swarm 46 (9%), regular 60 (12%), heavy 70, commander 72, titan 78 (15.6%).
// The titan's widest idle frame becomes about 1.2 bridges. Buildings take a
// flat 1.2 so a Rift Sentry stays at regular-troop height. The clamp ceiling
// rises to 1.6 because the titan needs 1.5x its packed size.

import type { UnitAnimRecord } from "./unit-anim";

export type UnitSizeClass = "swarm" | "flying_swarm" | "regular" | "flying" | "heavy" | "titan" | "commander" | "building";

/** Target drawn idle height (ground pivot to top of art) in board px. */
export const SIZE_CLASS_TARGET: Record<Exclude<UnitSizeClass, "building">, number> = {
  swarm: 46,
  flying_swarm: 44,
  regular: 60,
  flying: 62,
  heavy: 70,
  titan: 78,
  commander: 72,
};

/** Flat presentation multiplier for building sheets (no per-class target). */
export const BUILDING_SIZE_MULT = 1.2;

/**
 * Explicit roster table, from TROOP_CARDS_V1 (checked by unit-scale.test):
 * swarm = count >= 3 or spawned, flying_swarm = air with count >= 2,
 * heavy = hp 220-260 ground tanks, titan = the max-hp troop (Boulderback, 400),
 * regular = everything else on the ground, flying = single air unit.
 */
export const UNIT_SIZE_CLASS: Record<string, UnitSizeClass> = {
  choglings: "swarm",
  burrow_scrapper: "swarm",
  rift_sprites: "flying_swarm",
  chaos_archer: "regular",
  rift_runner: "regular",
  sparkcaster: "regular",
  gale_netter: "regular",
  hexwing: "flying",
  chog_guardian: "heavy",
  frostshell: "heavy",
  riftbreaker: "heavy",
  ember_mauler: "heavy",
  boulderback: "titan",
};

export const SCALE_CLAMP = [0.85, 1.6] as const;

/** Size class for an animated record. Buildings and unknown ids keep their packed size. */
export function sizeClassOf(rec: Pick<UnitAnimRecord, "entityId" | "kind">): UnitSizeClass | null {
  if (rec.kind === "building") return "building";
  if (rec.kind === "commander" || rec.entityId.startsWith("commander_")) return "commander";
  return UNIT_SIZE_CLASS[rec.entityId] ?? null;
}

/** Multiplier applied on top of the packed displayScale. */
export function unitSizeMult(rec: Pick<UnitAnimRecord, "entityId" | "kind" | "visibleHeight" | "displayScale">): number {
  const cls = sizeClassOf(rec);
  if (cls === "building") return BUILDING_SIZE_MULT;
  if (!cls) return 1;
  const current = rec.visibleHeight * rec.displayScale;
  if (!(current > 0)) return 1;
  return Math.min(SCALE_CLAMP[1], Math.max(SCALE_CLAMP[0], SIZE_CLASS_TARGET[cls] / current));
}

/** Board px per sheet px as drawn. Use this everywhere instead of `displayScale`. */
export const unitDrawScale = (rec: Pick<UnitAnimRecord, "entityId" | "kind" | "visibleHeight" | "displayScale">): number =>
  rec.displayScale * unitSizeMult(rec);

/** Drawn idle height in board px (ground pivot to top of the art). */
export const unitDrawnHeight = (rec: Pick<UnitAnimRecord, "entityId" | "kind" | "visibleHeight" | "displayScale">): number =>
  rec.visibleHeight * unitDrawScale(rec);

/** Small classes get a compact HP bar and badge. */
export const isSmallClass = (cls: UnitSizeClass | null): boolean => cls === "swarm" || cls === "flying_swarm";

/** HP bar width in board px for a unit, by class. */
export function hpBarWidth(cls: UnitSizeClass | null, drawn: number): number {
  switch (cls) {
    case "swarm":
    case "flying_swarm":
      return 26;
    case "regular":
    case "flying":
      return 36;
    case "heavy":
    case "commander":
      return 44;
    case "titan":
      return 54;
    default:
      return Math.max(26, Math.min(54, drawn * 0.6));
  }
}

/** Presentation weight for landing dust, death puffs and footsteps. */
export function classWeight(cls: UnitSizeClass | null): number {
  switch (cls) {
    case "titan":
      return 1.6;
    case "heavy":
    case "commander":
      return 1.25;
    case "swarm":
    case "flying_swarm":
      return 0.7;
    default:
      return 1;
  }
}

/** Heavy-footed classes leave footstep puffs while observed moving. */
export const hasFootsteps = (cls: UnitSizeClass | null): boolean => cls === "heavy" || cls === "titan";
