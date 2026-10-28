// V2.1c Practice bots: three server-owned human-vs-AI difficulties.
// One human (Privy-verified, real saved deck/commander) plus one internal
// bot seat. The bot is never a DB player, never a Privy identity, never a
// players row, and never routed through PvP settlement.
//
// MEDIUM is the V2.1a compatibility baseline (smartMove adapter, unchanged).
// HARD adds tactical defense, counter selection and push coordination.
// ULTIMATE adds two-lane pressure scoring, support targeting, commander
// ability timing and Chaos hazard awareness. Difficulty is decision quality
// only: same cards, energy, placement, cooldowns and stats for every bot.

import { smartMove } from "@/lib/smart-bot";
import {
  botAbility,
  botAntiAirSpot,
  botAntiSwarmSpot,
  botBuildingSpot,
  botSiegeSpot,
  botSpellSpot,
} from "@/lib/arena-scenarios";
import { DECKS_V13 } from "@/lib/bot-economy";
import {
  ARENA_V2,
  BUILDING_CARDS_V1,
  CARDS_V1,
  COMMANDER_COMBAT_PROFILE_V1,
  ENERGY_V1,
  TROOP_CARDS_V1,
  chaosZoneOf,
  isCommanderCard,
  troopDeployCheck,
  type CombatState,
  type PlayerIndex,
} from "@/lib/combat";
import { buildingSolids } from "@/lib/combat";
import type { PracticeDifficulty, PracticeOpponent } from "@/lib/battle-protocol";

/** Stable per-difficulty bot identities. */
export const PRACTICE_BOT_IDS = {
  medium: "practice-medium-v1",
  hard: "practice-hard-v1",
  ultimate: "practice-ultimate-v1",
} as const;

export const PRACTICE_BOT_DIFFICULTY: PracticeDifficulty = "medium";
export const PRACTICE_BOT_ID = PRACTICE_BOT_IDS.medium;
export const PRACTICE_BOT_DISPLAY_NAME = "AI Opponent" as const;

/** Server-owned opponent descriptors. The UX shows displayName plus difficulty. */
export const PRACTICE_OPPONENTS: Record<PracticeDifficulty, PracticeOpponent> = {
  medium: { kind: "bot", botId: PRACTICE_BOT_IDS.medium, difficulty: "medium", displayName: PRACTICE_BOT_DISPLAY_NAME },
  hard: { kind: "bot", botId: PRACTICE_BOT_IDS.hard, difficulty: "hard", displayName: PRACTICE_BOT_DISPLAY_NAME },
  ultimate: { kind: "bot", botId: PRACTICE_BOT_IDS.ultimate, difficulty: "ultimate", displayName: PRACTICE_BOT_DISPLAY_NAME },
};

/** V2.1a compatibility alias. New code should use practiceOpponentFor(). */
export const PRACTICE_OPPONENT: PracticeOpponent = PRACTICE_OPPONENTS.medium;

export function practiceOpponentFor(difficulty: PracticeDifficulty): PracticeOpponent {
  return PRACTICE_OPPONENTS[difficulty];
}

/** Internal seat id for a difficulty. Never a DB player, never authenticated. */
export function practiceBotPlayerId(difficulty: PracticeDifficulty): string {
  return `bot:${PRACTICE_BOT_IDS[difficulty]}`;
}

/**
 * Validate a room creation difficulty. Undefined/null means "not provided"
 * and defaults to Medium so existing production clients keep working.
 * Anything else throws, so a forged value can never start a room.
 */
export function resolvePracticeDifficulty(raw: unknown): PracticeDifficulty {
  if (raw === undefined || raw === null) return "medium";
  if (raw === "medium" || raw === "hard" || raw === "ultimate") return raw;
  throw new Error(`Unsupported practice difficulty: ${String(raw)}`);
}

/**
 * Actual eligible legal bot deck from the existing catalog (turret archetype,
 * free Bulwark commander). 8 engine cards: 7 ordinary + commander last.
 * Identical for every difficulty: difficulty is decision quality, never
 * stats. Validated by validateDeck in tests and at room start.
 */
export function practiceBotDeck(): string[] {
  return [...DECKS_V13.turret!];
}

/** Ordinary (non-commander) cards of the bot deck, for evidence checks. */
export function practiceBotOrdinaryCards(): string[] {
  return practiceBotDeck().filter((c) => !isCommanderCard(c));
}

/** Free commander class fielded by the bot. */
export function practiceBotCommanderClass(): string {
  const cmd = practiceBotDeck().find((c) => isCommanderCard(c)) ?? "cmdr:free-bulwark";
  return cmd.replace(/^cmdr:free-/, "");
}

// --- Difficulty policy interfaces ---

export type PracticeMove = { cardId: string; x: number; y: number } | null;

export interface PracticePolicy {
  difficulty: PracticeDifficulty;
  /** Pure deploy/spell/commander choice from authoritative state. Null = hold. */
  choose(state: CombatState, seat: PlayerIndex, laneSeed: number): PracticeMove;
  /** Commander ability timing. Null = hold. Medium/Hard never fire. */
  ability?(state: CombatState, seat: PlayerIndex): string | null;
}

/** MEDIUM: deterministic smartMove adapter. Same legal inputs as a human. */
export const mediumPolicy: PracticePolicy = {
  difficulty: "medium",
  choose: (state, seat, laneSeed) => {
    const m = smartMove(state, seat, laneSeed);
    return m ? { cardId: m.cardId, x: Math.round(m.x), y: Math.round(m.y) } : null;
  },
  ability: () => null,
};

// --- Shared tactical scaffolding (mirror-equivariant by construction) ---

type TacticUnit = { id: string; x: number; y: number; hp: number; owner: PlayerIndex; moveType: string };

function tacticRole(state: CombatState, p: PlayerIndex, card: string) {
  if (isCommanderCard(card)) {
    const snap = state.commanderSnapshots[p];
    if (!snap) return null;
    const c = COMMANDER_COMBAT_PROFILE_V1[snap.class];
    return { cost: c.cost, hp: c.hp, range: c.range, hitsAir: c.hitsAir, hitsGround: true, splash: false };
  }
  const t = TROOP_CARDS_V1[card];
  if (!t) return null;
  return { cost: t.cost, hp: t.hp * t.count, range: t.range, hitsAir: t.hitsAir, hitsGround: t.hitsGround, splash: t.splashRadius > 0 || (t.shockwaveRadius ?? 0) > 0 };
}

function tacticCtx(state: CombatState, p: PlayerIndex) {
  const E = state.energy[p];
  const snap = state.commanderSnapshots[p];
  const cmdrAlive = state.commanders.some((c) => c.owner === p && c.hp > 0);
  const cost = (c: string) => (isCommanderCard(c) ? (snap ? COMMANDER_COMBAT_PROFILE_V1[snap.class].cost : 99) : (CARDS_V1[c]?.cost ?? 99));
  const usable = (c: string) => !(isCommanderCard(c) && (cmdrAlive || !snap));
  const hand = state.hands[p].filter(usable);
  const playable = hand.filter((c) => cost(c) <= E);
  const Y = (depth: number) => (p === 0 ? depth : ARENA_V2.maxY - depth);
  const depthOf = (y: number) => (p === 0 ? y : ARENA_V2.maxY - y);
  const solids = buildingSolids(state.buildings);
  const spot = (x: number, depths: number[]): { x: number; y: number } | null => {
    for (const d of depths) for (const dx of [0, 4, -4, 8, -8]) if (troopDeployCheck(state.structures, p, x + dx, Y(d), solids).ok) return { x: x + dx, y: Y(d) };
    return null;
  };
  const units = [...state.troops, ...state.commanders].filter((u) => u.hp > 0) as TacticUnit[];
  const foes = units.filter((u) => u.owner !== p);
  const invaders = foes.filter((u) => depthOf(u.y) < 80);
  const hpSum = (us: TacticUnit[]) => us.reduce((s, u) => s + u.hp, 0);
  const byId = (a: { cardId: string }, b: { cardId: string }) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);
  return { E, snap, cmdrAlive, cost, hand, playable, Y, depthOf, spot, units, foes, invaders, hpSum, byId };
}

/** Own-relative zone of a board point. Mirror-equivariant: P1 mirrors y first. */
function ownZone(p: PlayerIndex, y: number): string {
  return chaosZoneOf(p === 0 ? y : ARENA_V2.maxY - y);
}

/** Own-relative zones holding an ACTIVE area-damage hazard this tick. */
function activeHazardZones(state: CombatState, p: PlayerIndex): Set<string> {
  const out = new Set<string>();
  const chaos = state.chaos;
  if (!chaos) return out;
  chaos.schedule.events.forEach((ev, i) => {
    if (!chaos.active[i] || ev.effect.kind !== "hazard") return;
    for (const z of ev.zones) out.add(p === 0 ? z : z === "north" ? "south" : z === "south" ? "north" : z);
  });
  return out;
}

function hazardFree(spot: { x: number; y: number } | null, hazards: Set<string>, p: PlayerIndex): { x: number; y: number } | null {
  if (!spot || hazards.size === 0) return spot;
  return hazards.has(ownZone(p, spot.y)) ? null : spot;
}

type Scored = { cardId: string; x: number; y: number; score: number };

function pickBest(options: Scored[]): PracticeMove {
  if (options.length === 0) return null;
  options.sort((a, b) => b.score - a.score || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
  const best = options[0]!;
  return { cardId: best.cardId, x: best.x, y: best.y };
}

/**
 * HARD defense: per-lane uncovered threat, strict spell discipline.
 * Answers the most exposed lane first with the best counter available.
 */
function hardDefense(state: CombatState, p: PlayerIndex): PracticeMove {
  const c = tacticCtx(state, p);
  if (c.invaders.length === 0) return null;
  const lanes = [30, 70];
  const laneThreat = lanes.map((lx) => {
    const laneFoes = c.invaders.filter((u) => Math.abs(u.x - lx) <= 25);
    const laneDefs = c.units.filter((u) => u.owner === p && c.depthOf(u.y) < 80 && Math.abs(u.x - lx) <= 25);
    return { lx, foes: laneFoes, uncovered: c.hpSum(laneFoes) - c.hpSum(laneDefs) * 1.2 };
  });
  laneThreat.sort((a, b) => b.uncovered - a.uncovered || (a.lx - b.lx));
  const target = laneThreat[0]!;
  if (target.uncovered <= 0) return null;
  const air = target.foes.some((u) => u.moveType === "air");
  const groundFoes = target.foes.filter((u) => u.moveType === "ground");
  const options: Scored[] = [];
  for (const card of c.playable) {
    let at: { x: number; y: number } | null = null;
    let score = 0;
    if (card === "chaos_bolt") {
      // Strict: only for real clusters, never single low-HP picks.
      const spell = botSpellSpot(state, p, card);
      const hit = spell ? target.foes.filter((u) => (u.x - spell.x) ** 2 + (u.y - spell.y) ** 2 <= 64) : [];
      if (spell && (hit.length >= 2 || c.hpSum(hit) >= 120)) [at, score] = [spell, 6];
    } else if (card === "rift_snare") {
      at = botSpellSpot(state, p, card);
      score = groundFoes.length >= 2 ? 4 : 2;
    } else if (card === "chaos_comet") {
      continue; // Saved for towers, never wasted on defense.
    } else if (BUILDING_CARDS_V1[card]) {
      if (BUILDING_CARDS_V1[card]!.shell) continue;
      if (!air || BUILDING_CARDS_V1[card]!.damage === 0) [at, score] = [botBuildingSpot(state, p, BUILDING_CARDS_V1[card]!), 3];
    } else {
      const r = tacticRole(state, p, card);
      if (!r) continue;
      if ((air && !r.hitsAir && groundFoes.length === 0) || (!air && !r.hitsGround)) continue;
      if (isCommanderCard(card) && target.uncovered < 250) continue;
      score = 2 + (air && r.hitsAir ? 3 : 0) + (groundFoes.length >= 3 && r.splash ? 4 : 0) + (r.hp >= 240 && groundFoes.length > 0 ? 1 : 0);
      at = card === "gale_netter" ? botAntiAirSpot(state, p) : card === "ember_mauler" ? (botAntiSwarmSpot(state, p) ?? c.spot(target.lx, [52, 48, 56])) : c.spot(target.lx, [54, 50, 58]);
    }
    if (at && score > 0) options.push({ cardId: card, ...at, score: score * 10 - c.cost(card) });
  }
  return pickBest(options);
}

/** HARD push support: reinforce the most advanced tank, prefer ranged. */
function hardSupport(state: CombatState, p: PlayerIndex): PracticeMove {
  const c = tacticCtx(state, p);
  const tanks = c.units
    .filter((u) => u.owner === p && u.hp >= 240 * 0.5 && c.depthOf(u.y) >= 40 && c.depthOf(u.y) < 110)
    .filter((u) => {
      const t = state.troops.find((x) => x.id === u.id);
      return t ? (tacticRole(state, p, t.cardId)?.hp ?? 0) >= 240 : true;
    })
    .sort((a, b) => c.depthOf(b.y) - c.depthOf(a.y) || (a.id < b.id ? -1 : 1));
  const lead = tanks[0];
  if (!lead) return null;
  const supports = c.playable
    .filter((card) => isCommanderCard(card) || (tacticRole(state, p, card)?.range ?? 0) >= 8 || card === "rally_horn")
    .sort((a, b) => c.cost(b) - c.cost(a) || (a < b ? -1 : 1));
  for (const card of supports) {
    if (card === "rally_horn") {
      const near = c.units.filter((u) => u.owner === p && (u.x - lead.x) ** 2 + (u.y - lead.y) ** 2 <= 144).length;
      if (near >= 2) return { cardId: card, x: lead.x, y: lead.y };
      continue;
    }
    const at = c.spot(Math.round(lead.x), [Math.min(70, c.depthOf(lead.y) - 6), 66, 62]);
    if (at) return { cardId: card, ...at };
  }
  return null;
}

/** HARD: tactical two-lane defense, coordinated pushes, disciplined spending. */
function hardChoose(state: CombatState, p: PlayerIndex, n: number): PracticeMove {
  const c = tacticCtx(state, p);
  const defended = hardDefense(state, p);
  if (defended) return defended;
  const supported = hardSupport(state, p);
  if (supported) return supported;
  const towers = state.structures.filter((s) => s.owner !== p && s.alive && s.structure === "tower").sort((a, b) => a.hp - b.hp || (a.x - b.x));
  const pushX = towers.length === 2 && towers[0]!.hp === towers[1]!.hp ? (n % 2 === 0 ? 30 : 70) : towers[0] ? (towers[0].x <= 50 ? 30 : 70) : 50;
  const tankCards = c.hand.filter((card) => (tacticRole(state, p, card)?.hp ?? 0) >= 240).sort((a, b) => c.cost(a) - c.cost(b) || (a < b ? -1 : 1));
  const supportCost = Math.min(99, ...c.hand.filter((card) => (tacticRole(state, p, card)?.range ?? 0) >= 8).map(c.cost));
  if (tankCards[0] && !c.units.some((u) => u.owner === p && c.depthOf(u.y) >= 40 && c.depthOf(u.y) < 110 && u.hp >= 120)) {
    const t = tankCards[0];
    const need = Math.min(ENERGY_V1.max, c.cost(t) + (supportCost < 99 ? supportCost : 0));
    if (c.E >= need) {
      const at = c.spot(pushX, [66, 62, 70, 58]);
      if (at) return { cardId: t, ...at };
    }
    if (c.E < ENERGY_V1.max - 1) return null;
  }
  if (c.E >= ENERGY_V1.max - 1) {
    // Overflow only: comet must matter (soften a tower toward lethal),
    // otherwise develop the weaker lane instead of dumping troops.
    if (c.playable.includes("chaos_comet")) {
      const tower = towers[0];
      if (tower && tower.hp <= 600) return { cardId: "chaos_comet", x: tower.x, y: tower.y };
    }
    for (const card of c.playable) {
      const b = BUILDING_CARDS_V1[card];
      if (!b) continue;
      if (b.shell) {
        const at = botSiegeSpot(state, p, b);
        if (at) return { cardId: card, ...at };
        continue;
      }
      const at = botBuildingSpot(state, p, b);
      if (at) return { cardId: card, ...at };
    }
    const troops = c.playable.filter((card) => tacticRole(state, p, card)).sort((a, b) => c.cost(b) - c.cost(a) || (a < b ? -1 : 1));
    for (const card of troops) {
      const at = c.spot(pushX, [66, 62, 58]);
      if (at) return { cardId: card, ...at };
    }
  }
  return null;
}

/** HARD: smarter tactical strategy. Deploy discipline only, no abilities. */
export const hardPolicy: PracticePolicy = {
  difficulty: "hard",
  choose: (state, seat, laneSeed) => {
    const m = hardChoose(state, seat, laneSeed);
    return m ? { cardId: m.cardId, x: Math.round(m.x), y: Math.round(m.y) } : null;
  },
  ability: () => null,
};

/**
 * ULTIMATE defense: hard's lane discipline plus support targeting and
 * hazard-aware placement. Urgent defense (uncovered > 200) holds its
 * ground; everything else sidesteps active damage zones.
 */
function ultimateDefense(state: CombatState, p: PlayerIndex): PracticeMove {
  const c = tacticCtx(state, p);
  if (c.invaders.length === 0) return null;
  const hazards = activeHazardZones(state, p);
  const lanes = [30, 70];
  const laneThreat = lanes.map((lx) => {
    const laneFoes = c.invaders.filter((u) => Math.abs(u.x - lx) <= 25);
    const laneDefs = c.units.filter((u) => u.owner === p && c.depthOf(u.y) < 80 && Math.abs(u.x - lx) <= 25);
    return { lx, foes: laneFoes, uncovered: c.hpSum(laneFoes) - c.hpSum(laneDefs) * 1.2 };
  });
  laneThreat.sort((a, b) => b.uncovered - a.uncovered || (a.lx - b.lx));
  const target = laneThreat[0]!;
  if (target.uncovered <= 0) return null;
  const urgent = target.uncovered > 200;
  const air = target.foes.some((u) => u.moveType === "air");
  const groundFoes = target.foes.filter((u) => u.moveType === "ground");
  // Anticipate: enemy support (ranged behind their tank) dies first to bolt.
  const supportCluster = target.foes.filter((u) => (tacticRole(state, (1 - p) as PlayerIndex, (state.troops.find((t) => t.id === u.id)?.cardId ?? ""))?.range ?? 0) >= 8);
  const options: Scored[] = [];
  for (const card of c.playable) {
    let at: { x: number; y: number } | null = null;
    let score = 0;
    if (card === "chaos_bolt") {
      const spell = botSpellSpot(state, p, card);
      const hit = spell ? target.foes.filter((u) => (u.x - spell.x) ** 2 + (u.y - spell.y) ** 2 <= 64) : [];
      const supportHit = hit.filter((u) => supportCluster.includes(u)).length;
      if (spell && (hit.length >= 2 || c.hpSum(hit) >= 120 || supportHit >= 1)) [at, score] = [spell, 6 + supportHit * 2];
    } else if (card === "rift_snare") {
      at = botSpellSpot(state, p, card);
      score = groundFoes.length >= 2 ? 4 : 1;
    } else if (card === "chaos_comet") {
      continue;
    } else if (BUILDING_CARDS_V1[card]) {
      if (BUILDING_CARDS_V1[card]!.shell) continue;
      if (!air || BUILDING_CARDS_V1[card]!.damage === 0) [at, score] = [botBuildingSpot(state, p, BUILDING_CARDS_V1[card]!), 3];
    } else {
      const r = tacticRole(state, p, card);
      if (!r) continue;
      if ((air && !r.hitsAir && groundFoes.length === 0) || (!air && !r.hitsGround)) continue;
      if (isCommanderCard(card) && target.uncovered < 250) continue;
      score = 2 + (air && r.hitsAir ? 3 : 0) + (groundFoes.length >= 3 && r.splash ? 4 : 0) + (r.hp >= 240 ? 1 : 0);
      const raw = card === "gale_netter" ? botAntiAirSpot(state, p) : card === "ember_mauler" ? (botAntiSwarmSpot(state, p) ?? c.spot(target.lx, [52, 48, 56])) : c.spot(target.lx, [54, 50, 58]);
      at = urgent ? raw : hazardFree(raw, hazards, p);
    }
    if (at && score > 0) options.push({ cardId: card, ...at, score: score * 10 - c.cost(card) });
  }
  return pickBest(options);
}

/** ULTIMATE: strategic two-lane pressure, support sniping, hazard-aware, abilities timed. */
function ultimateChoose(state: CombatState, p: PlayerIndex, n: number): PracticeMove {
  const defended = ultimateDefense(state, p);
  if (defended) return defended;
  const c = tacticCtx(state, p);
  const hazards = activeHazardZones(state, p);
  const supported = hardSupport(state, p);
  if (supported) {
    if (hazards.size === 0) return supported;
    const safe = hazardFree({ x: supported.x, y: supported.y }, hazards, p);
    if (safe) return { cardId: supported.cardId, ...safe };
    // Hazard on the support spot is not urgent: hold rather than burn energy.
    if (c.E < ENERGY_V1.max - 1) return null;
  }
  // Two-lane pressure: hit the weaker tower, but never march fragile troops
  // through an active damage zone when the other lane is open.
  const towers = state.structures.filter((s) => s.owner !== p && s.alive && s.structure === "tower").sort((a, b) => a.hp - b.hp || (a.x - b.x));
  let pushX = towers.length === 2 && towers[0]!.hp === towers[1]!.hp ? (n % 2 === 0 ? 30 : 70) : towers[0] ? (towers[0].x <= 50 ? 30 : 70) : 50;
  // Two-lane pressure: if the preferred lane's deploy band sits inside an
  // active damage zone, prefer the other lane unless its tower is
  // healthier by more than a full comet.
  const spotHazard = (lx: number) => {
    const at = c.spot(lx, [66, 62, 70, 58]);
    return at ? hazards.has(ownZone(p, at.y)) : false;
  };
  if (spotHazard(pushX)) {
    const other = pushX <= 50 ? 70 : 30;
    if (!spotHazard(other)) {
      const otherTower = towers.find((t) => (t.x <= 50 ? 30 : 70) === other);
      if (otherTower && towers[0] && otherTower.hp <= towers[0].hp + 140) pushX = other;
    }
  }
  const tankCards = c.hand.filter((card) => (tacticRole(state, p, card)?.hp ?? 0) >= 240).sort((a, b) => c.cost(a) - c.cost(b) || (a < b ? -1 : 1));
  const supportCost = Math.min(99, ...c.hand.filter((card) => (tacticRole(state, p, card)?.range ?? 0) >= 8).map(c.cost));
  const pushing = c.units.some((u) => u.owner === p && c.depthOf(u.y) >= 40 && c.depthOf(u.y) < 110 && u.hp >= 120);
  if (tankCards[0] && !pushing) {
    const t = tankCards[0];
    const need = Math.min(ENERGY_V1.max, c.cost(t) + (supportCost < 99 ? supportCost : 0));
    if (c.E >= need) {
      const raw = c.spot(pushX, [66, 62, 70, 58]);
      const at = hazardFree(raw, hazards, p) ?? raw;
      if (at) return { cardId: t, ...at };
    }
    if (c.E < ENERGY_V1.max - 1) return null;
  }
  if (c.E >= ENERGY_V1.max - 1) {
    if (c.playable.includes("chaos_comet")) {
      const tower = towers[0];
      if (tower && tower.hp <= 600) return { cardId: "chaos_comet", x: tower.x, y: tower.y };
    }
    for (const card of c.playable) {
      const b = BUILDING_CARDS_V1[card];
      if (!b) continue;
      if (b.shell) {
        const at = botSiegeSpot(state, p, b);
        if (at) return { cardId: card, ...at };
        continue;
      }
      const at = botBuildingSpot(state, p, b);
      if (at) return { cardId: card, ...at };
    }
    const troops = c.playable.filter((card) => tacticRole(state, p, card)).sort((a, b) => c.cost(b) - c.cost(a) || (a < b ? -1 : 1));
    for (const card of troops) {
      const raw = c.spot(pushX, [66, 62, 58]);
      const at = hazardFree(raw, hazards, p) ?? (c.E >= ENERGY_V1.max ? raw : null);
      if (at) return { cardId: card, ...at };
    }
  }
  return null;
}

/** ULTIMATE: strongest strategic opponent. Timed abilities, no energy waste. */
export const ultimatePolicy: PracticePolicy = {
  difficulty: "ultimate",
  choose: (state, seat, laneSeed) => {
    const m = ultimateChoose(state, seat, laneSeed);
    return m ? { cardId: m.cardId, x: Math.round(m.x), y: Math.round(m.y) } : null;
  },
  ability: (state, seat) => botAbility(state, seat),
};

export function policyFor(difficulty: PracticeDifficulty): PracticePolicy {
  switch (difficulty) {
    case "medium":
      return mediumPolicy;
    case "hard":
      return hardPolicy;
    case "ultimate":
      return ultimatePolicy;
    default:
      throw new Error(`Unknown practice difficulty: ${String(difficulty)}`);
  }
}

/** Resolve the bot seat from the shuffled seats. The human seat is known. */
export function botSeatFor(humanSeat: PlayerIndex): PlayerIndex {
  return humanSeat === 0 ? 1 : 0;
}
