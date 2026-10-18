// B2.7c4 resource-aware testing bot (deterministic, not AI, not production).
//
// Same legal inputs as botMove: reads the real hand, energy and board and
// returns one deploy/spell/commander card for the next tick (abilities stay
// with botAbility). Side-neutral by construction: every position is an
// own-side depth mapped through y -> 160 - y for P1, lane ties go left
// (x is unchanged by the mirror), the only per-player input is `n`.
//
// Priorities: 1. defend invaders on its half with the best affordable
// counter, unless its own defenders already outweigh them; 2. support its
// own pushing tank; 3. save for tank + support, then start a push in the
// weaker enemy lane; 4. never sit at the energy cap (overflow play).

import {
  ARENA_V2,
  BUILDING_CARDS_V1,
  CARDS_V1,
  COMMANDER_COMBAT_PROFILE_V1,
  ENERGY_V1,
  TROOP_CARDS_V1,
  buildingDeployCheck,
  buildingSolids,
  isCommanderCard,
  troopDeployCheck,
  type CombatState,
  type PlayerIndex,
} from "@/lib/combat";
import { botAntiAirSpot, botAntiSwarmSpot, botBuildingSpot, botMove, botSpellSpot, type MovePolicy } from "@/lib/arena-scenarios";

type Move = { cardId: string; x: number; y: number };
type Unit = { id: string; x: number; y: number; hp: number; owner: PlayerIndex; moveType: string };

/** Unit roles from authored stats. Tank: >= 240 total HP. Ranged: range >= 8. */
export const TANK_HP = 240;
export const RANGED = 8;

function role(state: CombatState, p: PlayerIndex, card: string): { cost: number; hp: number; range: number; hitsAir: boolean; hitsGround: boolean; splash: boolean } | null {
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

export const smartMove: MovePolicy = (state, p, n) => {
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
  const units = [...state.troops, ...state.commanders].filter((u) => u.hp > 0) as Unit[];
  const foes = units.filter((u) => u.owner !== p);
  const invaders = foes.filter((u) => depthOf(u.y) < 80);
  const hpSum = (us: Unit[]) => us.reduce((s, u) => s + u.hp, 0);
  const laneOf = (us: Unit[]) => (hpSum(us.filter((u) => u.x <= 50)) >= hpSum(us.filter((u) => u.x > 50)) ? 30 : 70);
  const byId = (a: Move, b: Move) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);

  // 1. Defense.
  if (invaders.length > 0) {
    const threat = hpSum(invaders);
    const lx = laneOf(invaders);
    const defenders = units.filter((u) => u.owner === p && depthOf(u.y) < 80 && Math.abs(u.x - lx) <= 25);
    const air = invaders.some((u) => u.moveType === "air");
    const ground = invaders.filter((u) => u.moveType === "ground").length;
    if (hpSum(defenders) < threat * 1.2) {
      const options: Array<{ move: Move; score: number }> = [];
      for (const c of playable) {
        let at: { x: number; y: number } | null = null;
        let score = 0;
        const r = role(state, p, c);
        if (c === "chaos_bolt") {
          const spell = botSpellSpot(state, p, c);
          const hit = spell ? invaders.filter((u) => (u.x - spell.x) ** 2 + (u.y - spell.y) ** 2 <= 64) : [];
          if (spell && (hit.length >= 2 || hpSum(hit) >= 100)) [at, score] = [spell, 5];
        } else if (c === "rift_snare" || c === "chaos_comet") {
          at = botSpellSpot(state, p, c);
          score = c === "chaos_comet" ? 4 : 3;
        } else if (BUILDING_CARDS_V1[c]) {
          if (!air || BUILDING_CARDS_V1[c]!.damage === 0) [at, score] = [botBuildingSpot(state, p, BUILDING_CARDS_V1[c]!), 3];
        } else if (r) {
          if ((air && !r.hitsAir && ground === 0) || (!air && !r.hitsGround)) continue;
          if (isCommanderCard(c) && threat < 200) continue;
          score = 2 + (air && r.hitsAir ? 3 : 0) + (ground >= 3 && r.splash ? 3 : 0) + (r.hp >= TANK_HP ? 1 : 0);
          at = c === "gale_netter" ? botAntiAirSpot(state, p) : c === "ember_mauler" ? (botAntiSwarmSpot(state, p) ?? spot(lx, [52, 48, 56])) : spot(lx, r.range >= RANGED ? [46, 50, 42] : [54, 50, 58]);
        }
        if (at && score > 0) options.push({ move: { cardId: c, ...at }, score: score * 10 - cost(c) });
      }
      options.sort((a, b) => b.score - a.score || byId(a.move, b.move));
      if (options[0]) return options[0].move;
    }
  }

  // 2. Support a live pushing tank (own unit with tank HP, not yet past the river by much).
  const tanks = units
    .filter((u) => u.owner === p && u.hp >= TANK_HP * 0.5 && depthOf(u.y) >= 40 && depthOf(u.y) < 110)
    .filter((u) => {
      const t = state.troops.find((x) => x.id === u.id);
      return t ? (role(state, p, t.cardId)?.hp ?? 0) >= TANK_HP : true;
    })
    .sort((a, b) => depthOf(b.y) - depthOf(a.y) || (a.id < b.id ? -1 : 1));
  const lead = tanks[0];
  if (lead) {
    const near = units.filter((u) => u.owner === p && (u.x - lead.x) ** 2 + (u.y - lead.y) ** 2 <= 144).length;
    const engaged = foes.some((u) => (u.x - lead.x) ** 2 + (u.y - lead.y) ** 2 <= 400);
    // The commander joins any push as support (it is the deck's signature unit).
    const supports = playable
      .filter((c) => isCommanderCard(c) || (role(state, p, c)?.range ?? 0) >= RANGED || (c === "rally_horn" && near >= 2 && engaged))
      .sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : 1));
    for (const c of supports) {
      if (c === "rally_horn") return { cardId: c, x: lead.x, y: lead.y };
      const at = spot(Math.round(lead.x), [Math.min(70, depthOf(lead.y) - 6), 66, 62]);
      if (at) return { cardId: c, ...at };
    }
  }

  // 3. Save for tank + support, then start a push in the weaker enemy lane.
  const towers = state.structures.filter((s) => s.owner !== p && s.alive && s.structure === "tower").sort((a, b) => a.hp - b.hp || (a.x - b.x));
  const pushX = towers.length === 2 && towers[0]!.hp === towers[1]!.hp ? (n % 2 === 0 ? 30 : 70) : towers[0] ? (towers[0].x <= 50 ? 30 : 70) : 50;
  const tankCards = hand.filter((c) => (role(state, p, c)?.hp ?? 0) >= TANK_HP).sort((a, b) => cost(a) - cost(b) || (a < b ? -1 : 1));
  const supportCost = Math.min(99, ...hand.filter((c) => (role(state, p, c)?.range ?? 0) >= RANGED).map(cost));
  if (tankCards[0] && !lead) {
    const t = tankCards[0];
    const need = Math.min(ENERGY_V1.max, cost(t) + (supportCost < 99 ? supportCost : 0));
    if (E >= need) {
      const at = spot(pushX, [66, 62, 70, 58]);
      if (at) return { cardId: t, ...at };
    }
    if (E < ENERGY_V1.max - 1) return null;
  }

  // 4. Overflow: never idle at the cap. Prefer comet on a tower, a building
  // guarding the other lane, then the strongest troop in the push lane.
  if (E >= ENERGY_V1.max - 1) {
    if (playable.includes("chaos_comet")) {
      const tower = towers[0];
      if (tower) return { cardId: "chaos_comet", x: tower.x, y: tower.y };
    }
    for (const c of playable) {
      const b = BUILDING_CARDS_V1[c];
      if (!b) continue;
      const gx = pushX === 30 ? 70 : 30;
      for (const d of [56, 52, 60]) for (const dx of [0, 6, -6]) if (buildingDeployCheck(state, p, gx + dx, Y(d), b).ok) return { cardId: c, x: gx + dx, y: Y(d) };
    }
    const troops = playable.filter((c) => role(state, p, c)).sort((a, b) => (role(state, p, b)!.hp - role(state, p, a)!.hp) || (a < b ? -1 : 1));
    for (const c of troops) {
      const at = spot(pushX, [66, 62, 70]);
      if (at) return { cardId: c, ...at };
    }
    return botMove(state, p, n);
  }
  return null;
};
