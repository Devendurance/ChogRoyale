// Ranked Chaos Pulse spatial fairness evidence (v13).
//
// Pure: no DB, no network. Patron configs come from the real B1.4a
// derivation over trait inputs; schedules from the real B1.4b derivation.
// Shared by src/lib/chaos-fairness.test.ts and scripts/chaos-fairness.ts.

import { runMatch, rankedChaosZones, type PlayerIndex } from "@/lib/combat";
import { derivePatronConfig } from "@/lib/patrons";
import { deriveChaosSchedule, type ChaosFamily, type ChaosSchedule } from "@/lib/chaos";
import { scenarioConfig, botMatch } from "@/lib/arena-scenarios";
import { measure, mirrorCommand, mirrorSchedule } from "@/lib/building-matchup";

type Attr = { trait_type: string; value: string };
/** Trait sets covering every patron theme, with and without a real Aura. */
export const FAIRNESS_PATRONS: Record<string, Attr[]> = {
  emberAura: [{ trait_type: "Background", value: "Crimson Glow" }, { trait_type: "Aura", value: "Ember Glow" }, { trait_type: "Tier", value: "Legendary" }],
  frostAura: [{ trait_type: "Background", value: "Deep Frost" }, { trait_type: "Aura", value: "Frost Mist" }, { trait_type: "Tier", value: "Common" }],
  surge: [{ trait_type: "Background", value: "Volt Surge" }, { trait_type: "Tier", value: "Rare" }],
  rift: [{ trait_type: "Background", value: "Purple Void" }],
  rallyAura: [{ trait_type: "Background", value: "Jade Forest" }, { trait_type: "Aura", value: "Spirit Bloom" }, { trait_type: "Tier", value: "Epic" }],
  neutral: [],
};

export function fairnessSchedule(patron: string, seed: string): ChaosSchedule {
  const cfg = derivePatronConfig({ tokenId: String(Object.keys(FAIRNESS_PATRONS).indexOf(patron) + 1), attributes: FAIRNESS_PATRONS[patron]!, metadataContentHash: "f".repeat(64), name: `fair-${patron}` });
  return deriveChaosSchedule({ patron: cfg, serverSeed: seed, matchKey: `fair-${patron}-${seed}` });
}

/** Zones an event acts on spatially, or null when the family is board-wide. */
function spatialZones(ev: ChaosSchedule["events"][number]): string[] | null {
  if (ev.effect.kind === "hazard") return ev.effect.zones;
  if (ev.effect.kind === "zone") return [ev.effect.crossing];
  return null;
}

const mirrorInvariant = (zs: string[]) => {
  const s = new Set(zs);
  return s.has("north") === s.has("south");
};

export interface Exposure { p0Home: number; p1Home: number; shared: number }

/**
 * Per-side spatial exposure of one schedule: zone-ticks weighted by the
 * authored intensity (Ember Rift per-tick damage, Rift Shift 1 per zone
 * tick). South is P0's home third, north P1's, center shared. "absolute"
 * reads raw zones (v12), "ranked" applies the v13 mirror closure.
 */
export function chaosExposure(s: ChaosSchedule, mode: "absolute" | "ranked"): Record<"ember_rift" | "rift_shift", Exposure> {
  const out = { ember_rift: { p0Home: 0, p1Home: 0, shared: 0 }, rift_shift: { p0Home: 0, p1Home: 0, shared: 0 } };
  for (const ev of s.events) {
    const zs = spatialZones(ev);
    if (!zs) continue;
    const dur = Math.max(1, Math.round(ev.effect.durationMs / 100));
    const intensity = ev.effect.kind === "hazard" ? Math.max(1, Math.round(ev.effect.dps / 10)) : 1;
    const r = mode === "ranked" ? rankedChaosZones(zs) : { zones: zs, num: 1, den: 1 };
    const budget = (intensity * dur * r.num) / r.den;
    const bucket = out[ev.family as "ember_rift" | "rift_shift"];
    for (const z of r.zones) {
      if (z === "south") bucket.p0Home += budget;
      else if (z === "north") bucket.p1Home += budget;
      else bucket.shared += budget;
    }
  }
  return out;
}

/** Raw-schedule audit: how many spatial events name a side-biased zone set. */
export function rawZoneAudit(patrons = Object.keys(FAIRNESS_PATRONS), seeds = Array.from({ length: 50 }, (_, i) => `z${i}`)) {
  const byFamily: Record<string, { events: number; biased: number; toP1Home: number; toP0Home: number }> = {};
  for (const p of patrons) {
    for (const seed of seeds) {
      for (const ev of fairnessSchedule(p, seed).events) {
        const f = (byFamily[ev.family] ??= { events: 0, biased: 0, toP1Home: 0, toP0Home: 0 });
        f.events += 1;
        const zs = spatialZones(ev);
        if (!zs || mirrorInvariant(zs)) continue;
        f.biased += 1;
        if (zs.includes("north")) f.toP1Home += 1;
        else f.toP0Home += 1;
      }
    }
  }
  return byFamily;
}

/**
 * Side-swap check with real schedules. Records a bot command stream for
 * deck A (P0) vs deck B (P1), then replays the player-mirrored stream with
 * decks swapped under (a) the unchanged raw schedule, which is what a live
 * side swap would see, and (b) the board-mirrored schedule. A side-neutral
 * ranked rule must swap winner, crowns, tower damage, energy and deaths
 * exactly under (a).
 */
export function chaosSwapCheck(decks: [string[], string[]], patrons = Object.keys(FAIRNESS_PATRONS), seeds = ["s1", "s2", "s3", "s4"]) {
  const swapW = (w: PlayerIndex | "draw" | null) => (w === 0 ? 1 : w === 1 ? 0 : w);
  const [da, db] = decks;
  const rows: Array<{ patron: string; seed: string; families: ChaosFamily[]; biasedEvents: number; raw: boolean; mirrored: boolean; detail: string }> = [];
  for (const patron of patrons) {
    for (const seed of seeds) {
      const sched = fairnessSchedule(patron, seed);
      const bot = botMatch(scenarioConfig(da, db, sched, seed), 3100, 20);
      const x = measure(runMatch(scenarioConfig(da, db, sched, seed), bot.commands).state);
      const swapped = bot.commands.map(mirrorCommand);
      const yRaw = measure(runMatch(scenarioConfig(db, da, sched, seed), swapped).state);
      const yMir = measure(runMatch(scenarioConfig(db, da, mirrorSchedule(sched), seed), swapped).state);
      const same = (y: typeof x) =>
        swapW(x.winner) === y.winner && x.ticks === y.ticks && x.crowns.join() === [...y.crowns].reverse().join() &&
        x.towerDamage.join() === [...y.towerDamage].reverse().join() && x.energySpent.join() === [...y.energySpent].reverse().join() &&
        x.deaths.join() === [...y.deaths].reverse().join();
      const fmt = (m: typeof x) => `${m.winner} ${m.endReason} ${m.crowns.join("-")} @${m.ticks} td ${m.towerDamage.join("/")} deaths ${m.deaths.join("/")}`;
      const biasedEvents = sched.events.filter((ev) => {
        const zs = spatialZones(ev);
        return zs !== null && !mirrorInvariant(zs);
      }).length;
      rows.push({ patron, seed, families: sched.events.map((e) => e.family), biasedEvents, raw: same(yRaw), mirrored: same(yMir), detail: `${fmt(x)} | raw-swap ${fmt(yRaw)}` });
    }
  }
  return {
    games: rows.length,
    rawExact: rows.filter((r) => r.raw).length,
    mirroredExact: rows.filter((r) => r.mirrored).length,
    withBiasedEvents: rows.filter((r) => r.biasedEvents > 0).length,
    rawMismatchesWithoutBiasedEvents: rows.filter((r) => !r.raw && r.biasedEvents === 0).length,
    mismatches: rows.filter((r) => !r.raw || !r.mirrored),
  };
}
