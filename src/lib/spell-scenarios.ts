// B2.7b headless tactical-card scenarios (Chaos Comet, Rift Snare, Rift
// Sprites). Real engine runs driven only by legal commands read from the
// real hand, energy and board (no state surgery, no scripted outcomes).
// Shared by the Vitest suite and scripts/arena-scenarios.ts. Pure.

import {
  initMatch,
  stepMatch,
  runMatch,
  stateHash,
  buildingDeployCheck,
  CARDS_V1,
  BUILDING_CARDS_V1,
  isCommanderCard,
  type CombatConfig,
  type CombatState,
  type DeployCommand,
  type PlayerIndex,
} from "@/lib/combat";
import { scenarioConfig, deckWith, traceMatch, botMatch, riftSchedule, type TraceSample } from "@/lib/arena-scenarios";
import { MATCHUP_DECKS_V9 } from "@/lib/building-matchup";

const d = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const hpOf = (s: CombatState, id: string) => s.structures.find((x) => x.id === id)?.hp ?? s.buildings.find((b) => b.id === id)?.hp ?? 0;
const impacts = (s: CombatState) => s.events.flatMap((e) => (e.type === "spell_impact" ? [{ tick: e.tick, cardId: e.cardId, units: e.units, buildings: e.buildings, structures: e.structures }] : []));
const rejected = (s: CombatState) => s.events.flatMap((e) => (e.type === "command_rejected" ? [`${e.seq}:${e.reason}`] : []));
const deaths = (s: CombatState, owner: PlayerIndex) => s.events.filter((e) => e.type === "death" && e.owner === owner).length;
export const P0_LEFT = "s-p0-tower-30";
export const P1_LEFT = "s-p1-tower-30";
export const P1_RIGHT = "s-p1-tower-70";

type Move = { player: PlayerIndex; cardId: string; x: number; y: number };

/** Step the real engine; `decide` reads state at tick T and returns plays for T+1. */
function stepped(cfg: CombatConfig, upto: number, decide: (s: CombatState) => Move[], fixed: DeployCommand[] = []) {
  const state = initMatch(cfg);
  const commands: DeployCommand[] = [];
  let seq = 1000;
  while (state.phase !== "final" && state.tick < upto) {
    const due = [...fixed.filter((c) => c.tick === state.tick + 1), ...decide(state).map((m) => ({ ...m, seq: ++seq, tick: state.tick + 1 }))];
    commands.push(...due);
    stepMatch(state, due);
  }
  return { state, commands };
}

/**
 * First tick at/after `from` where every sampled unit of `cardId` owned by
 * `owner` holds the same cell for `hold` consecutive ticks (engaged in a
 * fight). Used to aim the delayed Comet at what a player would see standing.
 */
export function holdSpot(samples: TraceSample[], owner: PlayerIndex, cardId: string, hold: number, from = 0): { tick: number; x: number; y: number } | null {
  const units = samples.filter((s) => s.owner === owner && s.cardId === cardId && s.tick >= from);
  const ticks = [...new Set(units.map((s) => s.tick))].sort((a, b) => a - b);
  const key = (t: number) => units.filter((s) => s.tick === t).map((s) => `${s.id}:${s.x},${s.y}`).join("|");
  for (const t of ticks) {
    const k = key(t);
    let ok = true;
    for (let i = 1; i <= hold; i++) if (key(t + i) !== k) ok = false;
    if (ok && k) {
      const first = units.find((s) => s.tick === t)!;
      return { tick: t, x: first.x, y: first.y };
    }
  }
  return null;
}

/** A. Comet on choglings attacking P0's tower: all hit at once, P0's own tower and troops untouched. */
export function cometTroops() {
  const p0 = deckWith("chaos_comet", "choglings");
  const p1 = deckWith("choglings");
  const atk = d(1, 1, 5, "choglings", 30, 100);
  const probe = traceMatch(scenarioConfig(p0, p1), [atk], 400);
  const spot = holdSpot(probe.samples, 1, "choglings", 7)!;
  const cast = d(3, 0, spot.tick, "chaos_comet", spot.x, spot.y);
  const run = traceMatch(scenarioConfig(p0, p1), [atk, cast], spot.tick + 12);
  const control = traceMatch(scenarioConfig(p0, p1), [atk], spot.tick + 12);
  return {
    castTick: spot.tick,
    impacts: impacts(run.state),
    p1Alive: run.state.troops.filter((t) => t.owner === 1).length,
    p1AliveControl: control.state.troops.filter((t) => t.owner === 1).length,
    // P0's own tower sits inside the blast: only the choglings ever hurt it.
    ownTowerHp: hpOf(run.state, P0_LEFT),
    ownTowerHpControl: hpOf(control.state, P0_LEFT),
  };
}

/** B. Comet damages enemy buildings; Chaos Bolt on the same building does nothing (troops-only). */
export function cometBuilding() {
  const cfg = () => scenarioConfig(deckWith("chaos_comet", "chaos_bolt"), deckWith("decoy_totem", "rift_sentry"));
  const totem = d(1, 1, 2, "decoy_totem", 30, 104);
  const comet = runMatch(cfg(), [totem, d(3, 0, 5, "chaos_comet", 30, 104)], 20).state;
  const bolt = runMatch(cfg(), [totem, d(3, 0, 5, "chaos_bolt", 30, 104)], 20).state;
  const sentryComet = runMatch(cfg(), [d(2, 1, 3, "rift_sentry", 70, 104), d(3, 0, 5, "chaos_comet", 70, 104)], 20).state;
  const hp = (s: CombatState, card: string) => s.buildings.find((b) => b.cardId === card)?.hp ?? 0;
  return {
    totemAfterComet: hp(comet, "decoy_totem"),
    totemAfterBolt: hp(bolt, "decoy_totem"),
    sentryAfterComet: hp(sentryComet, "rift_sentry"),
    boltAffected: bolt.events.flatMap((e) => (e.type === "spell_cast" ? [e.affected] : [])),
    impacts: impacts(comet),
  };
}

/** C. Reduced structure damage: tower and Core take 42 (troops take 140, see A). */
export function cometStructures() {
  const s0 = initMatch(scenarioConfig(deckWith(), deckWith()));
  const tower = s0.structures.find((x) => x.id === P1_LEFT)!;
  const core = s0.structures.find((x) => x.id === "s-p1-core")!;
  const cfg = () => scenarioConfig(deckWith("chaos_comet"), deckWith());
  const t = runMatch(cfg(), [d(1, 0, 2, "chaos_comet", tower.x, tower.y)], 9).state;
  const c = runMatch(cfg(), [d(1, 0, 2, "chaos_comet", core.x, core.y)], 9).state;
  return { towerHp: hpOf(t, P1_LEFT), coreHp: hpOf(c, "s-p1-core"), impacts: [...impacts(t), ...impacts(c)] };
}

const HOME_SPOTS_P0: Array<[number, number]> = [[12, 22], [88, 22], [12, 44], [88, 44], [22, 12], [78, 12], [50, 30]];

/**
 * D. Comet-only siege into sudden death. P0 never deploys a moving unit:
 * it casts Comets at P1's left tower and cycles the hand with the cheapest
 * static plays (buildings at home, spells on empty ground). It holds the
 * finishing Comet until overtime, which the 0-0 regulation forces.
 */
export function cometSuddenDeath() {
  const p0 = deckWith("chaos_comet", "rift_snare", "rally_horn", "decoy_totem", "chaos_bolt", "rift_sentry", "rift_sprites");
  const cfg = scenarioConfig(p0, deckWith());
  const stat = { comets: 0, cyclePlays: 0, energySpent: 0 };
  const run = stepped(cfg, 3100, (s) => {
    if (s.pendingImpacts.length > 0) return [];
    const tower = s.structures.find((x) => x.id === P1_LEFT)!;
    if (!tower.alive) return [];
    const hand = s.hands[0];
    const energy = s.energy[0];
    const finishing = tower.hp <= 42;
    if (finishing && s.phase !== "overtime") return [];
    if (hand.includes("chaos_comet")) {
      if (energy < 4) return [];
      stat.comets += 1;
      stat.energySpent += 4;
      return [{ player: 0, cardId: "chaos_comet", x: tower.x, y: tower.y }];
    }
    const options = hand.filter((c) => !isCommanderCard(c) && c !== "rift_sprites").sort((a, b) => CARDS_V1[a]!.cost - CARDS_V1[b]!.cost || (a < b ? -1 : 1));
    for (const card of options) {
      const cost = CARDS_V1[card]!.cost;
      if (cost > energy) return [];
      const bdef = BUILDING_CARDS_V1[card];
      const spot = bdef ? HOME_SPOTS_P0.find(([x, y]) => buildingDeployCheck(s, 0, x, y, bdef).ok) : ([50, 20] as [number, number]);
      if (!spot) continue;
      stat.cyclePlays += 1;
      stat.energySpent += cost;
      return [{ player: 0, cardId: card, x: spot[0], y: spot[1] }];
    }
    return [];
  });
  const s = run.state;
  const destroyed = s.events.find((e) => e.type === "structure_destroyed");
  const destroyTick = destroyed?.tick ?? null;
  // Authoritative accounting from accepted engine events (not bot intents):
  // every spell_cast / deploy charges its card's cost exactly once.
  const energyByCard: Record<string, { plays: number; energy: number }> = {};
  for (const e of s.events) {
    if ((e.type !== "spell_cast" && e.type !== "deploy") || e.player !== 0) continue;
    const row = (energyByCard[e.cardId] ??= { plays: 0, energy: 0 });
    row.plays += 1;
    row.energy += CARDS_V1[e.cardId]!.cost;
  }
  const engineSpent = Object.values(energyByCard).reduce((n, r) => n + r.energy, 0);
  return {
    ...stat,
    energyByCard,
    cometEnergy: energyByCard.chaos_comet?.energy ?? 0,
    cycleEnergy: engineSpent - (energyByCard.chaos_comet?.energy ?? 0),
    engineSpent,
    energyLeft: s.energy[0],
    winner: s.winner,
    endReason: s.endReason,
    crowns: [...s.crowns],
    destroyTick,
    destroyedBy: impacts(s).filter((i) => i.tick === destroyTick),
    p0UnitsEver: s.events.filter((e) => e.type === "deploy" && e.player === 0 && !BUILDING_CARDS_V1[e.cardId]).length,
    rejected: rejected(s),
    endTick: s.tick,
    commands: run.commands,
    cfg,
  };
}

/** E. Rift Snare: 25 damage, 40% slow for 50 ticks on a walking Guardian, then full speed again. */
export function snareSlow() {
  const cfg = () => scenarioConfig(deckWith("rift_snare"), deckWith("chog_guardian"));
  const deploy = d(1, 1, 2, "chog_guardian", 30, 140);
  const snared = traceMatch(cfg(), [deploy, d(2, 0, 3, "rift_snare", 30, 140)], 70);
  const control = traceMatch(cfg(), [deploy], 70);
  const progress = (samples: TraceSample[], from: number, to: number) => {
    const g = samples.filter((x) => x.cardId === "chog_guardian");
    let n = 0;
    for (let t = from; t < to; t++) {
      const a = g.find((x) => x.tick === t);
      const b = g.find((x) => x.tick === t + 1);
      if (a && b) n += Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    return n;
  };
  const g = snared.state.troops.find((x) => x.cardId === "chog_guardian")!;
  return {
    impacts: impacts(snared.state),
    hp: g.hp,
    baseSpeed: g.speed,
    slowUntil: g.slowUntil,
    cellsDuringSlow: { snared: progress(snared.samples, 3, 53), control: progress(control.samples, 3, 53) },
    cellsAfterSlow: { snared: progress(snared.samples, 53, 63), control: progress(control.samples, 53, 63) },
  };
}

/**
 * F. Ground/air rules: Snare and Comet hit an air Hexwing; Rift Sprites
 * (air) are never targeted by the ground-only Sentry, while P0's tower
 * shoots them; Sprites never target the Hexwing (they cannot hit air).
 */
export function airGroundRules() {
  const snareOn = (card: string) => runMatch(scenarioConfig(deckWith("rift_snare"), deckWith(card)), [d(1, 1, 2, card, 50, 100), d(2, 0, 2, "rift_snare", 50, 100)], 3).state;
  const snare = snareOn("hexwing");
  const snareGround = snareOn("choglings");
  const p0 = deckWith("chaos_comet", "rift_sentry", "hexwing");
  const p1 = deckWith("hexwing", "rift_sprites");
  const hexAtk = d(1, 1, 5, "hexwing", 30, 100);
  const probe = traceMatch(scenarioConfig(p0, p1), [hexAtk], 400);
  const spot = holdSpot(probe.samples, 1, "hexwing", 7)!;
  const comet = traceMatch(scenarioConfig(p0, p1), [hexAtk, d(2, 0, spot.tick, "chaos_comet", spot.x, spot.y)], spot.tick + 8).state;
  const s = initMatch(scenarioConfig(p0, p1));
  const cmds = [d(1, 0, 2, "rift_sentry", 30, 56), d(2, 0, 3, "hexwing", 70, 40), d(3, 1, 5, "rift_sprites", 30, 100)];
  let sentryHitSprites = false;
  let spritesTargetedHex = false;
  let towerTargetedSprites = false;
  for (let i = 0; i < 300 && s.phase !== "final"; i++) {
    stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
    const sprites = s.troops.filter((t) => t.cardId === "rift_sprites");
    const hex = s.troops.find((t) => t.cardId === "hexwing");
    const sentry = s.buildings.find((b) => b.cardId === "rift_sentry");
    if (sentry && sprites.some((x) => x.id === sentry.targetId)) sentryHitSprites = true;
    if (hex && sprites.some((x) => x.targetId === hex.id)) spritesTargetedHex = true;
  }
  towerTargetedSprites = s.events.some((e) => e.type === "death" && e.owner === 1);
  return {
    snareAirUnits: impacts(snare)[0]?.units ?? 0,
    snareGroundUnits: impacts(snareGround)[0]?.units ?? 0,
    hexSlowed: (snare.troops.find((t) => t.cardId === "hexwing")?.activeSlowPct ?? 0) > 0,
    cometOnHex: impacts(comet),
    hexAliveAfterComet: comet.troops.some((t) => t.cardId === "hexwing" && t.owner === 1),
    sentryHitSprites,
    spritesTargetedHex,
    spritesDied: towerTargetedSprites,
  };
}

/** Boulderback vs P0's left tower: measured at boulderback death (or the cap). */
function boulderDefense(extra: DeployCommand[], p0Deck: string[]) {
  const atk = d(1, 1, 5, "boulderback", 30, 100);
  const r = traceMatch(scenarioConfig(p0Deck, deckWith("boulderback")), [atk, ...extra], 600);
  const bb = r.samples.filter((x) => x.cardId === "boulderback");
  return { towerHp: hpOf(r.state, P0_LEFT), boulderbackDied: !r.state.troops.some((t) => t.cardId === "boulderback"), lastSeen: bb[bb.length - 1]?.tick ?? null, p0Deaths: deaths(r.state, 0) };
}

/**
 * G/H. Cheap defense vs an unsupported 5-energy Boulderback. Sprites (1)
 * dropped as it reaches the tower; a Totem (2) inside tower range; control.
 */
export function cheapDefense() {
  const probe = traceMatch(scenarioConfig(deckWith("rift_sprites"), deckWith("boulderback")), [d(1, 1, 5, "boulderback", 30, 100)], 600);
  const arrive = probe.samples.find((x) => x.cardId === "boulderback" && x.targetId === P0_LEFT && x.y < 74)?.tick ?? 60;
  const control = boulderDefense([], deckWith("rift_sprites", "decoy_totem"));
  const sprites = boulderDefense([d(2, 0, arrive, "rift_sprites", 30, 50)], deckWith("rift_sprites", "decoy_totem"));
  const totem = boulderDefense([d(2, 0, 40, "decoy_totem", 30, 58)], deckWith("rift_sprites", "decoy_totem"));
  return { arriveTick: arrive, control, sprites, totem };
}

/** G. Offensive Sprites: Boulderback alone vs Boulderback + Sprites into P1's left tower. */
export function spritesSoak() {
  const p0 = deckWith("boulderback", "rift_sprites");
  const atk = d(1, 0, 5, "boulderback", 30, 60);
  const probe = traceMatch(scenarioConfig(p0, deckWith()), [atk], 600);
  const arrive = probe.samples.find((x) => x.cardId === "boulderback" && x.targetId === P1_LEFT && x.y > 86)?.tick ?? 80;
  const alone = runMatch(scenarioConfig(p0, deckWith()), [atk], 600).state;
  const withSprites = runMatch(scenarioConfig(p0, deckWith()), [atk, d(2, 0, arrive, "rift_sprites", 30, 60)], 600).state;
  return { arriveTick: arrive, towerAlone: hpOf(alone, P1_LEFT), towerWithSprites: hpOf(withSprites, P1_LEFT) };
}

/**
 * I. A Sentry stops a Rift Runner rush outright. Against a Boulderback
 * push, a Comet cast on the Sentry first breaks it sooner and the push
 * reaches the tower with more HP left.
 */
export function buildingSpellCounter() {
  const p0 = deckWith("rift_sentry");
  const p1 = deckWith("rift_runner", "boulderback", "chaos_comet");
  const sentry = d(1, 0, 2, "rift_sentry", 30, 56);
  const removedAt = (s: CombatState) => {
    const removed = s.events.find((e) => e.type === "building_removed");
    return removed?.type === "building_removed" ? `${removed.reason}@${removed.tick}` : "alive";
  };
  const rush = runMatch(scenarioConfig(p0, p1), [sentry, d(2, 1, 30, "rift_runner", 30, 100)], 300).state;
  const bb = d(2, 1, 120, "boulderback", 30, 100);
  const push = traceMatch(scenarioConfig(p0, p1), [sentry, bb], 600);
  const comet = traceMatch(scenarioConfig(p0, p1), [sentry, d(3, 1, 10, "chaos_comet", 30, 56), bb], 600);
  const bbDeath = (s: CombatState) => s.events.find((e) => e.type === "death" && e.owner === 1)?.tick ?? null;
  return {
    rush: { sentry: removedAt(rush), runnerAlive: rush.troops.some((t) => t.cardId === "rift_runner"), tower: hpOf(rush, P0_LEFT) },
    push: { sentry: removedAt(push.state), boulderbackDeath: bbDeath(push.state), tower: hpOf(push.state, P0_LEFT) },
    cometPush: { sentry: removedAt(comet.state), boulderbackDeath: bbDeath(comet.state), tower: hpOf(comet.state, P0_LEFT), impacts: impacts(comet.state) },
  };
}

/**
 * J. P1 commits an unsupported Boulderback (5) left. P0 answers with
 * Choglings (2) on it and a Runner (3) + Sprites (1) push right, versus P0
 * only defending. Measured at tick 500.
 */
export function oppositeLane() {
  const p0 = deckWith("choglings", "rift_runner", "rift_sprites");
  const p1 = deckWith("boulderback");
  const bb = d(1, 1, 5, "boulderback", 30, 100);
  const defend = d(2, 0, 60, "choglings", 30, 60);
  const counter = [d(3, 0, 40, "rift_runner", 70, 60), d(4, 0, 42, "rift_sprites", 70, 62)];
  const only = runMatch(scenarioConfig(p0, p1), [bb, defend], 500).state;
  const both = runMatch(scenarioConfig(p0, p1), [bb, defend, ...counter], 500).state;
  const sum = (s: CombatState, owner: PlayerIndex) => s.structures.filter((x) => x.owner === owner && x.structure === "tower").reduce((n, x) => n + 600 - x.hp, 0);
  return {
    defendOnly: { p0TowerDamage: sum(only, 0), p1TowerDamage: sum(only, 1), crowns: [...only.crowns] },
    counterPush: { p0TowerDamage: sum(both, 0), p1TowerDamage: sum(both, 1), crowns: [...both.crowns] },
    energy: { p1Spent: 5, p0Spent: 6 },
  };
}

/** K/L. Full bot match with v9 decks, commanders and Chaos Pulses; replayed three ways. */
export function tacticalMatch(seed = "b27b", p0 = "control", p1 = "siege") {
  const cfg = () => scenarioConfig(MATCHUP_DECKS_V9[p0]!, MATCHUP_DECKS_V9[p1]!, riftSchedule(seed), seed);
  const bot = botMatch(cfg(), 3100, 20);
  const a = runMatch(cfg(), bot.commands);
  const b = runMatch(cfg(), [...bot.commands].reverse());
  const ev = a.state.events;
  const cometSeq = bot.commands.find((c) => "cardId" in c && c.cardId === "chaos_comet")?.seq;
  const dropped = cometSeq === undefined ? null : runMatch(cfg(), bot.commands.filter((c) => c.seq !== cometSeq)).result.stateHash;
  const imp = impacts(a.state);
  return {
    commands: bot.commands.length,
    rejected: ev.filter((e) => e.type === "command_rejected").length,
    spells: ev.reduce<Record<string, number>>((m, e) => (e.type === "spell_cast" ? ((m[e.cardId] = (m[e.cardId] ?? 0) + 1), m) : m), {}),
    cometImpacts: imp.filter((i) => i.cardId === "chaos_comet"),
    snareUnitsHit: imp.filter((i) => i.cardId === "rift_snare").reduce((n, i) => n + i.units, 0),
    spritesDeployed: ev.filter((e) => e.type === "deploy" && e.cardId === "rift_sprites").length,
    buildingsSpawned: ev.filter((e) => e.type === "building_spawned").length,
    commanderDeploys: ev.filter((e) => e.type === "commander_deployed").length,
    abilityActivations: ev.filter((e) => e.type === "ability_fired" && e.trigger === "active").length,
    pulses: ev.filter((e) => e.type === "pulse_active").length,
    result: a.result,
    replayIdentical: a.result.stateHash === b.result.stateHash && JSON.stringify(a.state.events) === JSON.stringify(b.state.events),
    steppedEqualsReplay: stateHash(bot.state) === a.result.stateHash,
    droppingCometChangesHash: dropped !== null && dropped !== a.result.stateHash,
  };
}
