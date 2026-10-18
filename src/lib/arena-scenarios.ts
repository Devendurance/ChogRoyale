// B2.5 headless arena scenarios. Each scenario runs the real combat engine
// with ordinary deploy commands (no state surgery, no scripted outcomes)
// and returns measured evidence. Shared by the Vitest suite and
// scripts/arena-scenarios.ts. Pure: no DB, no network.

import {
  initMatch,
  stepMatch,
  runMatch,
  stateHash,
  inRiver,
  openCrossings,
  troopDeployCheck,
  reach2,
  ARENA_V2,
  COMBAT_RULESET_VERSION,
  CARDS_V1,
  COMMANDER_COMBAT_PROFILE_V1,
  ENERGY_V1,
  energyPhaseMult,
  isCommanderCard,
  freeStarterSlot,
  ABILITY_ACTIVATION_COST_V1,
  BUILDING_CARDS_V1,
  SPELL_CARDS_V1,
  buildingDeployCheck,
  buildingSolids,
  type BuildingCardDef,
  type CombatCommand,
  type CommanderSlotInput,
  type CombatConfig,
  type CombatState,
  type DeployCommand,
  type PlayerIndex,
  type MoveType,
} from "@/lib/combat";
import { derivePatronConfig } from "@/lib/patrons";
import { deriveChaosSchedule, type ChaosSchedule } from "@/lib/chaos";
import type { CommanderClass } from "@/lib/commanders";

export interface TraceSample {
  tick: number;
  id: string;
  owner: PlayerIndex;
  cardId: string;
  x: number;
  y: number;
  targetId: string | null;
  moveType: MoveType;
  riftOpen: boolean;
}

export type CrossingUse = "left" | "right" | "rift" | "water";

const ALL = ["chog_guardian", "boulderback", "chaos_archer", "rift_runner", "choglings", "frostshell", "sparkcaster", "hexwing"];

export const DEFAULT_SCENARIO_COMMANDER = "cmdr:free-bulwark";

/**
 * v6 deck: the requested cards first (they start in hand), then ordinary
 * cards in fixed order up to 7, plus exactly one commander card. A
 * `cmdr:` entry in `front` places the commander; otherwise the default free
 * commander card goes last (in the queue, not the opening hand).
 */
export function deckWith(...front: string[]): string[] {
  const cmdr = front.find((c) => isCommanderCard(c)) ?? null;
  const ordinary = [...front.filter((c) => !isCommanderCard(c)), ...ALL.filter((c) => !front.includes(c))].slice(0, 7);
  if (!cmdr) return [...ordinary, DEFAULT_SCENARIO_COMMANDER];
  const at = front.indexOf(cmdr);
  return [...ordinary.slice(0, at), cmdr, ...ordinary.slice(at)];
}

/** Free-starter slot inferred from a deck's `cmdr:free-<class>` card. */
export function slotForDeck(deck: string[]): CommanderSlotInput | null {
  const card = deck.find((c) => isCommanderCard(c));
  const id = card?.slice("cmdr:".length) ?? "";
  if (!id.startsWith("free-")) return null;
  return freeStarterSlot(id.slice("free-".length) as CommanderClass);
}

export function scenarioConfig(
  p0: string[],
  p1: string[],
  chaos: ChaosSchedule | null = null,
  seed = "arena",
  commanders?: [CommanderSlotInput | null, CommanderSlotInput | null]
): CombatConfig {
  return { rulesetVersion: COMBAT_RULESET_VERSION, seed, decks: [p0, p1], chaos, commanders: commanders ?? [slotForDeck(p0), slotForDeck(p1)] };
}

/** Run tick by tick through the real stepper, sampling every ground/air unit. */
export function traceMatch(config: CombatConfig, commands: DeployCommand[], upto: number): { state: CombatState; samples: TraceSample[] } {
  const state = initMatch(config);
  const sorted = [...commands].sort((a, b) => (a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick));
  const samples: TraceSample[] = [];
  let ci = 0;
  while (state.phase !== "final" && state.tick < upto) {
    const due: DeployCommand[] = [];
    while (ci < sorted.length && sorted[ci]!.tick <= state.tick + 1) due.push(sorted[ci++]!);
    stepMatch(state, due);
    const open = state.tick < state.riftOpenUntil;
    for (const t of state.troops) {
      samples.push({ tick: state.tick, id: t.id, owner: t.owner, cardId: t.cardId, x: t.x, y: t.y, targetId: t.targetId, moveType: t.moveType, riftOpen: open });
    }
    for (const c of state.commanders) {
      samples.push({ tick: state.tick, id: c.id, owner: c.owner, cardId: `commander:${c.class}`, x: c.x, y: c.y, targetId: c.targetId, moveType: c.moveType, riftOpen: open });
    }
  }
  return { state, samples };
}

/**
 * Legal bot move from the real current state: the first card in the real
 * hand that is affordable and has a legal placement. Troops rotate through
 * lane positions validated by troopDeployCheck; damage/control spells use
 * botSpellSpot (legal targets only); Rally Horn targets the bot's
 * most advanced troop. Returns null when no legal play exists.
 */
export function botMove(state: CombatState, p: PlayerIndex, n: number): { cardId: string; x: number; y: number } | null {
  const lanes = [30, 70, 50, 20, 80, 40, 60];
  const homeY = p === 0 ? 0 : 160;
  // Commander priority: a held commander card is played as soon as it is
  // affordable; until then the bot saves energy for it (plays nothing).
  const cmdrCard = state.hands[p].find((c) => isCommanderCard(c));
  const snapNow = state.commanderSnapshots[p];
  const order = cmdrCard ? [cmdrCard] : state.hands[p];
  if (cmdrCard && snapNow && COMMANDER_COMBAT_PROFILE_V1[snapNow.class].cost > state.energy[p]) return null;
  for (const card of order) {
    const snap = state.commanderSnapshots[p];
    const cost = isCommanderCard(card) ? (snap ? COMMANDER_COMBAT_PROFILE_V1[snap.class].cost : 99) : (CARDS_V1[card]?.cost ?? 99);
    if (cost > state.energy[p]) continue;
    if (isCommanderCard(card) && state.commanders.some((c) => c.owner === p && c.hp > 0)) continue;
    if (card === "chaos_bolt" || card === "chaos_comet" || card === "rift_snare") {
      const spot = botSpellSpot(state, p, card);
      if (spot) return { cardId: card, ...spot };
      continue;
    }
    if (card === "rally_horn") {
      const own = state.troops.filter((u) => u.owner === p && u.hp > 0);
      own.sort((a, b) => Math.abs(b.y - homeY) - Math.abs(a.y - homeY) || (a.id < b.id ? -1 : 1));
      if (own[0]) return { cardId: card, x: own[0].x, y: own[0].y };
      continue;
    }
    const bdef = BUILDING_CARDS_V1[card];
    if (bdef) {
      const spot = botBuildingSpot(state, p, bdef);
      if (spot) return { cardId: card, ...spot };
      continue;
    }
    if (card === "gale_netter") {
      const spot = botAntiAirSpot(state, p);
      if (spot) return { cardId: card, ...spot };
      continue;
    }
    if (card === "ember_mauler") {
      const spot = botAntiSwarmSpot(state, p);
      if (spot) return { cardId: card, ...spot };
    }
    // Side-neutral: the same (n, k) gives the same lane and the same depth
    // behind the bank for either player (p1 y is the y -> 160 - y mirror).
    for (let k = 0; k < lanes.length * 4; k++) {
      const x = lanes[(n + k) % lanes.length]!;
      const depth = (n * 7 + k * 5) % 24;
      const y = p === 0 ? 50 + depth : ARENA_V2.maxY - 50 - depth;
      if (troopDeployCheck(state.structures, p, x, y, buildingSolids(state.buildings)).ok) return { cardId: card, x, y };
    }
  }
  return null;
}

/**
 * B2.7b spell targeting (testing bot, not AI). Only aims at targets the
 * spell can legally affect; returns null (card skipped, hand cycles on) when
 * none exist. Ties: closest to the bot's own Core, then id.
 * - Chaos Bolt: enemy troops only (it never hits commanders).
 * - Rift Snare: an enemy troop/commander on the bot's half.
 * - Chaos Comet: an enemy building, else an enemy unit with 2+ enemies
 *   within the radius, else an enemy tower it can finish.
 */
export function botSpellSpot(state: CombatState, p: PlayerIndex, card: string): { x: number; y: number } | null {
  const homeY = p === 0 ? 0 : 160;
  const byHome = <T extends { x: number; y: number; id: string }>(xs: T[]) =>
    [...xs].sort((a, b) => Math.abs(a.y - homeY) - Math.abs(b.y - homeY) || (a.id < b.id ? -1 : 1));
  const units = [...state.troops, ...state.commanders].filter((u) => u.owner !== p && u.hp > 0);
  const pick = (xs: Array<{ x: number; y: number; id: string }>) => (xs[0] ? { x: xs[0].x, y: xs[0].y } : null);
  if (card === "chaos_bolt") return pick(byHome(state.troops.filter((u) => u.owner !== p && u.hp > 0)));
  if (card === "rift_snare") return pick(byHome(units.filter((u) => (p === 0 ? u.y < 80 : u.y > 80))));
  const spec = SPELL_CARDS_V1.chaos_comet!;
  const building = pick(byHome(state.buildings.filter((b) => b.owner !== p && b.alive)));
  if (building) return building;
  const r2 = spec.radius * spec.radius;
  const cluster = byHome(units.filter((u) => units.filter((v) => (v.x - u.x) ** 2 + (v.y - u.y) ** 2 <= r2).length >= 2));
  if (cluster[0]) return pick(cluster);
  return pick(byHome(state.structures.filter((s) => s.owner !== p && s.alive && s.structure === "tower" && s.hp <= spec.impact!.structureDamage)));
}

/**
 * B2.7a building policy: only when an enemy unit is on the bot's half of the
 * arena. Defends the lane holding the most such enemies (ties: left), in
 * front of its own lane tower; first legal spot from a fixed candidate list.
 */
export function botBuildingSpot(state: CombatState, p: PlayerIndex, def: BuildingCardDef): { x: number; y: number } | null {
  const invaders = [...state.troops, ...state.commanders].filter((u) => u.owner !== p && u.hp > 0 && (p === 0 ? u.y < 80 : u.y > 80));
  if (invaders.length === 0) return null;
  const left = invaders.filter((u) => u.x <= 50).length;
  const laneX = left >= invaders.length - left ? 30 : 70;
  const ys = p === 0 ? [56, 52, 60, 48] : [104, 108, 100, 112];
  for (const y of ys) {
    for (const dx of [0, 6, -6, 10, -10]) {
      if (buildingDeployCheck(state, p, laneX + dx, y, def).ok) return { x: laneX + dx, y };
    }
  }
  return null;
}

/**
 * B2.7c1 anti-air policy: Gale Netter is held until the enemy has a living
 * flying unit anywhere, then placed behind the own lane tower on the side
 * holding the most flyers (ties: left). Candidates are y-mirrored per side.
 */
export function botAntiAirSpot(state: CombatState, p: PlayerIndex): { x: number; y: number } | null {
  const air = [...state.troops, ...state.commanders].filter((u) => u.owner !== p && u.hp > 0 && u.moveType === "air");
  if (air.length === 0) return null;
  const left = air.filter((u) => u.x <= 50).length;
  const laneX = left >= air.length - left ? 30 : 70;
  for (const depth of [50, 46, 54]) {
    const y = p === 0 ? depth : ARENA_V2.maxY - depth;
    for (const dx of [0, 4, -4, 8, -8]) {
      if (troopDeployCheck(state.structures, p, laneX + dx, y, buildingSolids(state.buildings)).ok) return { x: laneX + dx, y };
    }
  }
  return null;
}

/**
 * B2.7c2 anti-swarm policy: with 2+ enemy ground troops on the bot's half,
 * Ember Mauler goes in front of the own lane tower on the side holding most
 * of them (ties: left), y-mirrored per side. Otherwise null and the Mauler
 * uses the ordinary lane placement.
 */
export function botAntiSwarmSpot(state: CombatState, p: PlayerIndex): { x: number; y: number } | null {
  const ground = state.troops.filter((u) => u.owner !== p && u.hp > 0 && u.moveType === "ground" && (p === 0 ? u.y < 80 : u.y > 80));
  if (ground.length < 2) return null;
  const left = ground.filter((u) => u.x <= 50).length;
  const laneX = left >= ground.length - left ? 30 : 70;
  for (const depth of [52, 48, 56]) {
    const y = p === 0 ? depth : ARENA_V2.maxY - depth;
    for (const dx of [0, 4, -4, 8, -8]) {
      if (troopDeployCheck(state.structures, p, laneX + dx, y, buildingSolids(state.buildings)).ok) return { x: laneX + dx, y };
    }
  }
  return null;
}

/**
 * B2.6b deterministic ability policy (testing bot, not AI). Reads only the
 * real state at tick T and returns an ability for tick T+1 when the
 * commander lives, the ability is off cooldown, energy covers the cost, the
 * engine's targeting condition holds, and a tactical trigger applies:
 * - Aegis Wall: HP <= 70% with an enemy unit or structure close.
 * - Frenzy Rush: an enemy unit within range+4 or an enemy structure within range+2 of reach.
 * - Piercing Volley: 2+ enemies (or the enemy commander) within its radius.
 * - Shadow Step: slowed, or HP <= 60% with an enemy within 8.
 * - Null Field: 2+ enemies (or the enemy commander) within its radius, or
 *   HP <= 60% with any enemy inside it.
 */
export function botAbility(state: CombatState, p: PlayerIndex): string | null {
  const c = state.commanders.find((x) => x.owner === p && x.hp > 0);
  if (!c || state.tick + 1 < c.stunUntil) return null;
  const next = state.tick + 1;
  const d2 = (u: { x: number; y: number }) => (u.x - c.x) ** 2 + (u.y - c.y) ** 2;
  const foes = [...state.troops, ...state.commanders].filter((u) => u.owner !== p && u.hp > 0);
  const within = (r: number) => foes.filter((u) => d2(u) <= r * r);
  const structNear = (r: number) =>
    state.structures.some((s) => s.owner !== p && s.alive && reach2(c.x, c.y, { x: s.x, y: s.y, r: s.structure === "core" ? 4 : 3 }) <= r * r);
  const hurt = (pct: number) => c.hp * 100 <= c.maxHp * pct;
  for (const a of c.abilities) {
    if (a.trigger !== "active") continue;
    if (next < (c.abilityReadyAt[a.id] ?? 0)) continue;
    if (state.energy[p] < (ABILITY_ACTIVATION_COST_V1[a.id] ?? 0)) continue;
    const radius = Math.max(0, ...a.effects.map((e) => e.radiusOrRange ?? 0));
    const area = within(radius);
    const crowd = area.length >= 2 || area.some((u) => u.kind === "commander");
    let use = false;
    if (a.id === "bulwark-aegis-wall") use = c.hp < c.maxHp && hurt(70) && (within(c.sight).length > 0 || structNear(c.range + 6));
    else if (a.id === "reaver-frenzy-rush") use = within(c.range + 4).length > 0 || structNear(c.range + 2);
    else if (a.id === "deadeye-piercing-volley") use = crowd;
    else if (a.id === "scout-shadow-step") use = (next < c.slowUntil && c.activeSlowPct > 0) || (hurt(60) && within(8).length > 0);
    else if (a.id === "warden-null-field") use = crowd || (hurt(60) && area.length > 0);
    if (use) return a.id;
  }
  return null;
}

/** Step a fixed command list while the ability bot plays for `players`. */
export function runWithAbilities(config: CombatConfig, commands: DeployCommand[], upto: number, players: PlayerIndex[] = [0, 1]) {
  const state = initMatch(config);
  const sorted = [...commands].sort((a, b) => (a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick));
  const all: CombatCommand[] = [];
  let ci = 0;
  let aseq = 100000;
  while (state.phase !== "final" && state.tick < upto) {
    const due: CombatCommand[] = [];
    while (ci < sorted.length && sorted[ci]!.tick <= state.tick + 1) due.push(sorted[ci++]!);
    for (const p of players) {
      if (due.some((d) => d.player === p)) continue;
      const abilityId = botAbility(state, p);
      if (abilityId) due.push({ kind: "ability", seq: ++aseq, player: p, tick: state.tick + 1, abilityId });
    }
    all.push(...due);
    stepMatch(state, due);
  }
  return { state, commands: all };
}

function seedOffset(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h;
}

/**
 * Deterministic bot match: every `every` ticks each side submits a legal
 * botMove read from the real hand, energy and board. Commands are recorded
 * so they can be replayed through runMatch.
 */
export type MovePolicy = (state: CombatState, p: PlayerIndex, n: number) => { cardId: string; x: number; y: number } | null;

/**
 * Per-player economy observed by the bot loop (not hashed engine state).
 * cappedTicks: ticks that started at the energy cap, so regen accrual was
 * paused; wasted: energy those ticks would have produced (exact phase x
 * Chaos step / 2800); idleAtCap: decisions that played nothing at the cap.
 */
export interface BotEconomy { cappedTicks: [number, number]; wasted: [number, number]; idleAtCap: [number, number]; decisions: [number, number]; plays: [number, number] }

export function botMatch(config: CombatConfig, upto: number, every = 20, opts: { swapSides?: boolean; policies?: [MovePolicy, MovePolicy] } = {}) {
  const state = initMatch(config);
  const policies = opts.policies ?? [botMove, botMove];
  const econ: BotEconomy = { cappedTicks: [0, 0], wasted: [0, 0], idleAtCap: [0, 0], decisions: [0, 0], plays: [0, 0] };
  const wastedProgress: [number, number] = [0, 0];
  const samples: TraceSample[] = [];
  const commands: CombatCommand[] = [];
  const offset = seedOffset(config.seed);
  let seq = 0;
  // Ability seqs use a separate range so deploy choices stay seed-stable.
  let aseq = 100000;
  // Side-neutral bot: each player walks its own lane cycle from an offset
  // seeded by (match seed, player) with the same hash for both, so neither
  // side gets a structurally better sequence; the player whose same-tick
  // commands get the lower seq (processed first, so its entities get the
  // lower ids that win id tie-breaks) alternates by round.
  // opts.swapSides (positional diagnostics only): P1 gets exactly P0's lane
  // sequence and first-mover turns and vice versa, so a side-neutral engine
  // and bot must produce the side-swapped outcome.
  const lanes: [number, number] = [seedOffset(`${config.seed}:p0`), seedOffset(`${config.seed}:p1`)];
  const laneOffset: [number, number] = opts.swapSides ? [lanes[1], lanes[0]] : lanes;
  const firstShift = opts.swapSides ? 1 : 0;
  const moves: [number, number] = [0, 0];
  while (state.phase !== "final" && state.tick < upto) {
    const due: CombatCommand[] = [];
    const usedAbility = new Set<PlayerIndex>();
    const first = ((Math.floor((state.tick + 1) / every) + offset + firstShift) % 2) as PlayerIndex;
    const order: PlayerIndex[] = [first, (1 - first) as PlayerIndex];
    for (const p of order) {
      const abilityId = botAbility(state, p);
      if (!abilityId) continue;
      usedAbility.add(p);
      due.push({ kind: "ability", seq: ++aseq, player: p, tick: state.tick + 1, abilityId });
    }
    if ((state.tick + 1) % every === 0) {
      for (const p of order) {
        if (usedAbility.has(p)) continue;
        econ.decisions[p] += 1;
        const move = policies[p](state, p, laneOffset[p] + moves[p]);
        if (!move) {
          if (state.energy[p] >= ENERGY_V1.max) econ.idleAtCap[p] += 1;
          continue;
        }
        econ.plays[p] += 1;
        moves[p] += 1;
        seq += 1;
        due.push(cmd(seq, p, state.tick + 1, move.cardId, move.x, move.y));
      }
    }
    commands.push(...due);
    for (const p of [0, 1] as PlayerIndex[]) {
      if (state.energy[p] < ENERGY_V1.max) continue;
      econ.cappedTicks[p] += 1;
      const next = state.tick + 1;
      wastedProgress[p] += energyPhaseMult(next) * (next < state.energyModUntil ? state.energyModPct : 100);
    }
    stepMatch(state, due);
    const open = state.tick < state.riftOpenUntil;
    for (const u of [...state.troops, ...state.commanders]) {
      samples.push({ tick: state.tick, id: u.id, owner: u.owner, cardId: u.kind === "troop" ? u.cardId : `commander:${u.class}`, x: u.x, y: u.y, targetId: u.targetId, moveType: u.moveType, riftOpen: open });
    }
  }
  econ.wasted = wastedProgress.map((w) => Math.round((w / (ENERGY_V1.regenTicksPerPoint * 100)) * 10) / 10) as [number, number];
  return { state, samples, commands, econ };
}

export function samplesOf(samples: TraceSample[], pred: (s: TraceSample) => boolean): TraceSample[] {
  return samples.filter(pred);
}

/** Which crossing (or open water) each in-river sample stood on. */
export function crossingUse(s: TraceSample): CrossingUse | null {
  if (!inRiver(s.y)) return null;
  const c = openCrossings(s.riftOpen).find((k) => s.x >= k.minX && s.x <= k.maxX);
  return c ? c.id : "water";
}

export function crossingsUsed(trace: TraceSample[]): CrossingUse[] {
  const set = new Set<CrossingUse>();
  for (const s of trace) {
    const u = crossingUse(s);
    if (u) set.add(u);
  }
  return [...set].sort();
}

export function towerHp(state: CombatState, id: string): number {
  return state.structures.find((s) => s.id === id)?.hp ?? -1;
}

export function riftSchedule(seed = "rift-b25"): ChaosSchedule {
  const patron = derivePatronConfig({ tokenId: "1", attributes: [{ trait_type: "Background", value: "Purple Void" }], metadataContentHash: "b".repeat(64), name: "CHOG #1462" });
  return deriveChaosSchedule({ patron, serverSeed: seed, matchKey: `m-${seed}` });
}

const cmd = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });

// A/B: a lone ground troop on each lane crosses on that lane's bridge.
export function scenarioBridge(lane: "left" | "right", player: PlayerIndex = 0) {
  const x = lane === "left" ? 30 : 70;
  const y = player === 0 ? 60 : 100;
  const cfg = scenarioConfig(deckWith("chog_guardian"), deckWith("chog_guardian"));
  const { state, samples } = traceMatch(cfg, [cmd(1, player, 2, "chog_guardian", x, y)], 220);
  const trace = samplesOf(samples, (s) => s.cardId === "chog_guardian");
  const enemyTower = `s-p${player === 0 ? 1 : 0}-tower-${x}`;
  return { trace, crossings: crossingsUsed(trace), enemyTower, enemyTowerHp: towerHp(state, enemyTower), finalTarget: trace.at(-1)?.targetId ?? null };
}

// C: ground troops deployed at the river's center line never walk on water
// (no Rift Ford without RIFT_SHIFT); both straddling units take bridges.
export function scenarioBlockedRiver() {
  const cfg = scenarioConfig(deckWith("choglings"), deckWith("choglings"));
  const { samples } = traceMatch(cfg, [cmd(1, 0, 2, "choglings", 50, 70), cmd(2, 1, 2, "choglings", 50, 90)], 120);
  const ground = samplesOf(samples, (s) => s.moveType === "ground");
  return { samples: ground.length, waterSteps: ground.filter((s) => crossingUse(s) === "water").length, crossings: crossingsUsed(ground) };
}

// D: same deploy point, same objective (p0 left tower). Air flies over open
// water; ground walks to the left bridge.
export function scenarioAirVsGround() {
  const air = traceMatch(scenarioConfig(deckWith("choglings"), deckWith("hexwing")), [cmd(1, 1, 2, "hexwing", 50, 90)], 60).samples;
  const ground = traceMatch(scenarioConfig(deckWith("choglings"), deckWith("chog_guardian")), [cmd(1, 1, 2, "chog_guardian", 50, 90)], 60).samples;
  const airTrace = samplesOf(air, (s) => s.cardId === "hexwing");
  const groundTrace = samplesOf(ground, (s) => s.cardId === "chog_guardian");
  return {
    airCrossings: crossingsUsed(airTrace),
    groundCrossings: crossingsUsed(groundTrace),
    airObjective: airTrace.at(-1)?.targetId ?? null,
    groundObjective: groundTrace.at(-1)?.targetId ?? null,
    airFirstSouthTick: airTrace.find((s) => s.y < 74)?.tick ?? null,
    groundFirstSouthTick: groundTrace.find((s) => s.y < 74)?.tick ?? null,
  };
}

// E: structure-priority rush unit ignores defenders once a structure is in sight.
export function scenarioRush() {
  const cfg = scenarioConfig(deckWith("rift_runner"), deckWith("choglings"));
  const { state, samples } = traceMatch(cfg, [cmd(1, 0, 2, "rift_runner", 70, 70), cmd(2, 1, 20, "choglings", 76, 112)], 160);
  const runner = samplesOf(samples, (s) => s.cardId === "rift_runner");
  const towerTargetWhileDefended = runner.filter((s) => s.targetId === "s-p1-tower-70").some((s) =>
    samples.some((o) => o.tick === s.tick && o.owner === 1 && o.cardId === "choglings" && (o.x - s.x) ** 2 + (o.y - s.y) ** 2 <= 40 * 40)
  );
  return { crossings: crossingsUsed(runner), towerHp: towerHp(state, "s-p1-tower-70"), towerTargetWhileDefended };
}

// F: tank in front, ranged support placed behind; compared with tank alone.
export function scenarioPush() {
  const tankOnly = [cmd(1, 0, 84, "boulderback", 30, 60)];
  const withSupport = [...tankOnly, cmd(2, 0, 85, "chaos_archer", 30, 20)];
  const deck = deckWith("boulderback", "chaos_archer");
  const solo = traceMatch(scenarioConfig(deck, deckWith("choglings")), tankOnly, 420);
  const push = traceMatch(scenarioConfig(deck, deckWith("choglings")), withSupport, 420);
  const tank = samplesOf(push.samples, (s) => s.cardId === "boulderback");
  const archers = samplesOf(push.samples, (s) => s.cardId === "chaos_archer");
  const archersBehindTank = archers.every((a) => {
    const t = tank.find((k) => k.tick === a.tick);
    return !t || a.y <= t.y;
  });
  const destroyedAt = (st: CombatState) =>
    st.events.find((e) => e.type === "structure_destroyed" && e.entityId === "s-p1-tower-30")?.tick ?? null;
  return {
    tankCrossings: crossingsUsed(tank),
    archerCrossings: crossingsUsed(archers),
    archersBehindTank,
    soloTowerHp: towerHp(solo.state, "s-p1-tower-30"),
    soloDestroyedAt: destroyedAt(solo.state),
    pushTowerHp: towerHp(push.state, "s-p1-tower-30"),
    pushDestroyedAt: destroyedAt(push.state),
    pushCrowns: push.state.crowns,
  };
}

// G: a ranged defender placed off-lane, inside the attacker's sight as it
// leaves the bridge, pulls the melee attacker away from its tower toward
// the center (kiting via placement, no retreat AI).
export function scenarioDistraction() {
  const attacker = [cmd(1, 0, 2, "chog_guardian", 30, 60)];
  const kite = [...attacker, cmd(2, 1, 12, "chaos_archer", 50, 100)];
  const cfg = () => scenarioConfig(deckWith("chog_guardian"), deckWith("chaos_archer"));
  const base = traceMatch(cfg(), attacker, 160);
  const kited = traceMatch(cfg(), kite, 160);
  const g = (s: TraceSample[]) => samplesOf(s, (x) => x.cardId === "chog_guardian");
  const firstTowerDamage = (st: TraceSample[], state: CombatState) => {
    void state;
    // In melee reach of the tower footprint (guardian range 2, measured to the ring).
    return g(st).find((s) => s.targetId === "s-p1-tower-30" && reach2(s.x, s.y, { x: 30, y: 120, r: 3 }) <= 4)?.tick ?? null;
  };
  return {
    baseMaxX: Math.max(...g(base.samples).map((s) => s.x)),
    kitedMaxX: Math.max(...g(kited.samples).map((s) => s.x)),
    kitedTargets: [...new Set(g(kited.samples).map((s) => s.targetId))],
    baseTowerHp: towerHp(base.state, "s-p1-tower-30"),
    kitedTowerHp: towerHp(kited.state, "s-p1-tower-30"),
    baseReachTick: firstTowerDamage(base.samples, base.state),
    kitedReachTick: firstTowerDamage(kited.samples, kited.state),
  };
}

// H: simultaneous pressure on both lanes, each unit on its own bridge.
export function scenarioTwoLanes() {
  const cfg = scenarioConfig(deckWith("chog_guardian", "rift_runner"), deckWith("choglings"));
  const { state, samples } = traceMatch(cfg, [cmd(1, 0, 2, "chog_guardian", 30, 60), cmd(2, 0, 60, "rift_runner", 70, 60)], 260);
  return {
    leftCrossings: crossingsUsed(samplesOf(samples, (s) => s.cardId === "chog_guardian")),
    rightCrossings: crossingsUsed(samplesOf(samples, (s) => s.cardId === "rift_runner")),
    leftTowerHp: towerHp(state, "s-p1-tower-30"),
    rightTowerHp: towerHp(state, "s-p1-tower-70"),
  };
}

// I: RIFT_SHIFT opens the Rift Ford for real routing, then restores it.
export function scenarioRiftShift() {
  const schedule = riftSchedule();
  const ev = schedule.events[0]!;
  const T = Math.round(ev.activationMs / 100);
  const D = Math.max(1, Math.round(ev.effect.durationMs / 100));
  const deck = deckWith("chog_guardian");
  const g = (s: TraceSample[]) => samplesOf(s, (x) => x.cardId === "chog_guardian");
  const run = (chaos: ChaosSchedule | null, tick: number, y = 50) =>
    traceMatch(scenarioConfig(deck, deckWith("choglings"), chaos), [cmd(1, 0, tick, "chog_guardian", 50, y)], tick + 70);
  const duringWarning = run(schedule, T - 40);
  const active = run(schedule, T + 1);
  const control = run(null, T + 1);
  const stranded = run(schedule, T + D - 2, 72);
  const afterExpiry = run(schedule, T + D + 1);
  const strandedTrace = g(stranded.samples);
  const afterClose = strandedTrace.filter((s) => s.tick >= T + D);
  const inWaterAfterClose = afterClose.filter((s) => inRiver(s.y));
  let maxStep = 0;
  for (let i = 1; i < strandedTrace.length; i++) {
    const a = strandedTrace[i - 1]!;
    const b = strandedTrace[i]!;
    maxStep = Math.max(maxStep, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  const riftEvents = stranded.state.events.filter((e) => e.type === "rift_crossing").map((e) => (e.type === "rift_crossing" ? { tick: e.tick, open: e.open } : null));
  return {
    family: ev.family,
    crossingZone: ev.effect.kind === "zone" ? ev.effect.crossing : null,
    modifier: ev.effect.kind === "zone" ? ev.effect.modifier : null,
    activationTick: T,
    durationTicks: D,
    warningCrossings: crossingsUsed(g(duringWarning.samples)),
    activeCrossings: crossingsUsed(g(active.samples)),
    controlCrossings: crossingsUsed(g(control.samples)),
    afterExpiryCrossings: crossingsUsed(g(afterExpiry.samples)),
    strandedAtClose: inWaterAfterClose.length > 0,
    strandedExitTicks: inWaterAfterClose.length,
    strandedExitStraight: inWaterAfterClose.every((s) => s.x === 50),
    strandedReachedNorth: afterClose.some((s) => s.y > 86),
    strandedMaxStep: maxStep,
    riftEvents,
  };
}

// J: full headless battles still end by Core and by crowns.
export function scenarioVictories() {
  const rotation = ["choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "chog_guardian", "hexwing"];
  const siege: DeployCommand[] = [];
  for (let t = 10, seq = 0; t < 1750; t += 30) {
    seq += 1;
    siege.push(cmd(seq, 0, t, rotation[seq % 8] as string, seq % 2 === 0 ? 30 : 70, 60));
  }
  const core = runMatch(scenarioConfig(deckWith(...rotation.slice(0, 7)), deckWith(...rotation.slice(0, 7))), siege);
  const one: DeployCommand[] = [cmd(1, 0, 84, "boulderback", 30, 60), cmd(2, 0, 85, "chaos_archer", 30, 20)];
  const crowns = runMatch(scenarioConfig(deckWith("boulderback", "chaos_archer"), deckWith("choglings")), one);
  return {
    core: { winner: core.result.winner, reason: core.result.endReason, crowns: core.result.crowns, ticks: core.result.ticks },
    crowns: { winner: crowns.result.winner, reason: crowns.result.endReason, crowns: crowns.result.crowns, ticks: crowns.result.ticks },
  };
}

// Forward pocket: deploys on the enemy side unlock only on the lane whose
// side tower has fallen. Pocket probes are ordinary deploy commands.
export function scenarioPocket() {
  const deck = deckWith("boulderback", "chaos_archer", "choglings", "rift_runner");
  const base: DeployCommand[] = [cmd(1, 0, 84, "boulderback", 30, 60), cmd(2, 0, 85, "chaos_archer", 30, 20)];
  const probe = runMatch(scenarioConfig(deck, deckWith("choglings")), base, 420);
  const fell = probe.state.events.find((e) => e.type === "structure_destroyed" && e.entityId === "s-p1-tower-30")?.tick ?? null;
  if (fell === null) return { fell, before: null, left: null, right: null, tooDeep: null };
  const after = fell + 40;
  const probes = [
    cmd(10, 0, fell - 5, "choglings", 30, 95),
    cmd(11, 0, after, "choglings", 30, 95),
    cmd(12, 0, after + 1, "rift_runner", 70, 95),
    cmd(13, 0, after + 2, "rift_runner", 30, 107),
  ];
  const run = runMatch(scenarioConfig(deck, deckWith("choglings")), [...base, ...probes], after + 10);
  const outcome = (seq: number) =>
    run.state.events.some((e) => e.type === "command_rejected" && e.seq === seq)
      ? (run.state.events.find((e) => e.type === "command_rejected" && e.seq === seq) as { reason: string }).reason
      : "accepted";
  return { fell, before: outcome(10), left: outcome(11), right: outcome(12), tooDeep: outcome(13) };
}

// K: identical commands -> identical hashes (including a chaos match).
export function scenarioReplay() {
  const schedule = riftSchedule("replay");
  const p0 = ["chog_guardian", "boulderback", "chaos_archer", "rift_runner", "choglings", "frostshell", "sparkcaster", "cmdr:free-reaver"];
  const p1 = ["choglings", "sparkcaster", "chog_guardian", "hexwing", "frostshell", "rift_runner", "chaos_archer", "cmdr:free-warden"];
  const cfg = () => scenarioConfig([...p0], [...p1], schedule, "replay");
  const { commands } = botMatch(cfg(), 3100, 25);
  const a = runMatch(cfg(), commands);
  const b = runMatch(cfg(), [...commands].reverse());
  const ev = a.state.events;
  return {
    a: a.result,
    b: b.result,
    hashA: stateHash(a.state),
    hashB: stateHash(b.state),
    commands: commands.length,
    deploys: ev.filter((e) => e.type === "deploy").length,
    rejected: ev.filter((e) => e.type === "command_rejected").length,
    deaths: ev.filter((e) => e.type === "death").length,
    towersDestroyed: ev.filter((e) => e.type === "structure_destroyed").length,
    riftEvents: ev.filter((e) => e.type === "rift_crossing").length,
  };
}
