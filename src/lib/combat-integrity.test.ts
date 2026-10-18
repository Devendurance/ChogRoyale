// B2.5 combat integrity hardening (ruleset v5): commander targetability,
// structure footprints/collision, movement accounting, exact energy,
// replay and terminal immutability.

import { describe, it, expect } from "vitest";
import {
  initMatch,
  stepMatch,
  runMatch,
  stateHash,
  moveUnit,
  octile,
  solidsOf,
  reach2,
  approachPoint,
  isWalkable,
  troopDeployCheck,
  STRUCTURE_FOOTPRINT_V5,
  COMBAT_RULESET_VERSION,
  ENERGY_V1,
  type CombatConfig,
  type DeployCommand,
  type CombatState,
} from "@/lib/combat";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import { deckWith, traceMatch, botMatch, scenarioConfig, riftSchedule } from "@/lib/arena-scenarios";

const slot = (cls: CommanderClass, tag: string) => {
  const t = freeCommanderTemplates().find((x) => x.class === cls)!;
  return {
    commanderId: `it-${tag}`,
    definition: {
      rulesetVersion: "v1" as const,
      class: t.class,
      affinity: t.class,
      scores: {} as Record<CommanderClass, number>,
      signals: [],
      unmatchedTraits: [],
      stats: t.stats,
      abilities: t.abilities,
      variant: "free",
      prestige: "Common",
      powerScore: t.powerScore,
      derivationHash: `it-${tag}`,
    },
  };
};

const cmdCfg = (p1: CommanderClass): CombatConfig => ({
  rulesetVersion: COMBAT_RULESET_VERSION,
  seed: "cmd",
  decks: [deckWith("chog_guardian", "chaos_archer"), deckWith("choglings")],
  commanders: [null, slot(p1, "p1")],
});
const pressure: DeployCommand[] = [
  { seq: 1, player: 0, tick: 20, cardId: "chog_guardian", x: 36, y: 66 },
  { seq: 2, player: 0, tick: 80, cardId: "chaos_archer", x: 36, y: 56 },
  { seq: 3, player: 0, tick: 200, cardId: "boulderback", x: 40, y: 60 },
  { seq: 4, player: 0, tick: 250, cardId: "choglings", x: 44, y: 56 },
];


function play(cfg: CombatConfig, cmds: DeployCommand[], ticks: number, each: (s: CombatState) => void) {
  const s = initMatch(cfg);
  for (let i = 0; i < ticks && s.phase !== "final"; i++) {
    stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
    each(s);
  }
  return s;
}

describe("commander targetability", () => {
  it("ordinary troops target, damage and kill an enemy commander, then retarget", () => {
    // A hexwing (air, hits ground) versus a ground-only reaver commander:
    // the commander cannot answer it (air/ground rules), the hexwing chases
    // and damages it, the commander dies and the hexwing retargets.
    const cid = "c1";
    let firstTargeted = -1;
    let deathTick = -1;
    let retargeted = false;
    const cfg: CombatConfig = { ...cmdCfg("scout"), decks: [deckWith("hexwing"), deckWith("choglings")] };
    // Control run (no troops) isolates troop damage from structure damage.
    const controlHp: number[] = [];
    play(cfg, [], 150, (st) => controlHp.push(st.commanders.find((x) => x.id === cid)?.hp ?? 0));
    const withHp: number[] = [];
    const s = play(cfg, [{ seq: 1, player: 0, tick: 2, cardId: "hexwing", x: 40, y: 60 }], 900, (st) => {
      const mine = st.troops.filter((t) => t.owner === 0);
      if (firstTargeted < 0 && mine.some((t) => t.targetId === cid)) firstTargeted = st.tick;
      const c = st.commanders.find((x) => x.id === cid);
      if (st.tick <= 150) withHp.push(c?.hp ?? 0);
      if (c) expect(c.targetId === null || !mine.some((t) => t.id === c.targetId)).toBe(true);
      if (deathTick < 0 && !st.commanders.some((c) => c.id === cid)) deathTick = st.tick;
      if (deathTick > 0 && st.tick > deathTick && mine.length > 0) {
        expect(mine.every((t) => t.targetId !== cid)).toBe(true);
        if (mine.some((t) => t.targetId !== null)) retargeted = true;
      }
    });
    expect(firstTargeted).toBeGreaterThan(0);
    expect(controlHp[149]! - withHp[149]!).toBeGreaterThanOrEqual(100);
    expect(deathTick).toBeGreaterThan(firstTargeted);
    expect(s.events.some((e) => e.type === "death" && e.entityId === cid && e.tick === deathTick)).toBe(true);
    expect(s.commanders.some((c) => c.id === cid)).toBe(false);
    expect(retargeted).toBe(true);
  });
  it("respects commander shields while troops deal damage", () => {
    let absorbed = false;
    let prev = 0;
    let hurt = false;
    play(cmdCfg("bulwark"), pressure, 400, (st) => {
      const c = st.commanders.find((x) => x.id === "c1");
      if (!c) return;
      const targeted = st.troops.some((t) => t.owner === 0 && t.targetId === "c1");
      if (targeted && prev > 0 && c.shieldHp < prev && st.tick < c.shieldUntil) absorbed = true;
      if (c.hp < c.maxHp) hurt = true;
      prev = c.shieldHp;
    });
    expect(absorbed).toBe(true);
    expect(hurt).toBe(true);
  });
  it("never targets friendly commanders and replays identically", () => {
    const cfg = (): CombatConfig => ({ ...scenarioConfig(deckWith(), [...deckWith()].reverse(), riftSchedule("cmdr"), "cmdr"), commanders: [slot("warden", "a"), slot("scout", "b")] });
    const a = botMatch(cfg(), 3100, 20);
    const targetedCommander = a.samples.filter((s) => s.targetId === "c0" || s.targetId === "c1");
    expect(targetedCommander.some((s) => !s.cardId.startsWith("commander:"))).toBe(true);
    for (const s of targetedCommander) expect(s.owner).not.toBe(s.targetId === "c0" ? 0 : 1);
    const r1 = runMatch(cfg(), a.commands);
    const r2 = runMatch(cfg(), [...a.commands].reverse());
    expect(r1.result.stateHash).toBe(r2.result.stateHash);
    expect(r1.result.stateHash).toBe(stateHash(a.state));
    expect(r1.state.events.filter((e) => e.type === "command_rejected")).toHaveLength(0);
    expect(r1.state.phase).toBe("final");
  });
});

describe("structure footprints and movement", () => {
  const s0 = () => initMatch(scenarioConfig(deckWith(), deckWith())).structures;
  it("live footprints are solid for ground, destroyed ones are rubble", () => {
    const st = s0();
    const solids = solidsOf(st);
    expect(solids).toHaveLength(6);
    expect(isWalkable(30, 40, false, solids)).toBe(false);
    expect(isWalkable(33, 43, false, solids)).toBe(false);
    expect(isWalkable(34, 40, false, solids)).toBe(true);
    expect(isWalkable(50, 12, false, solids)).toBe(false);
    st.find((s) => s.id === "s-p0-tower-30")!.alive = false;
    expect(isWalkable(30, 40, false, solidsOf(st))).toBe(true);
  });
  it("range to structures is measured to the footprint ring", () => {
    const tower = { x: 30, y: 120, r: STRUCTURE_FOOTPRINT_V5.tower };
    expect(reach2(30, 116, tower)).toBe(0);
    expect(reach2(34, 116, tower)).toBe(0);
    expect(reach2(30, 114, tower)).toBe(4);
    expect(approachPoint({ x: 40, y: 100 }, tower)).toEqual({ x: 34, y: 116 });
  });
  it("rejects deploys on or hugging a live structure", () => {
    const st = s0();
    expect(troopDeployCheck(st, 0, 30, 40)).toEqual({ ok: false, reason: "Deployment on structure" });
    expect(troopDeployCheck(st, 0, 35, 45)).toEqual({ ok: false, reason: "Deployment on structure" });
    expect(troopDeployCheck(st, 0, 30, 34)).toEqual({ ok: true, zone: "own" });
  });
  it("ground units detour around their own tower; air flies over it", () => {
    const g = traceMatch(scenarioConfig(deckWith("chog_guardian"), deckWith()), [{ seq: 1, player: 0, tick: 2, cardId: "chog_guardian", x: 30, y: 30 }], 260);
    const trace = g.samples.filter((s) => s.cardId === "chog_guardian");
    for (const s of trace) expect(Math.abs(s.x - 30) <= 3 && Math.abs(s.y - 40) <= 3).toBe(false);
    expect(trace.some((s) => s.y > 86)).toBe(true);
    const last = trace.at(-1)!;
    expect(last.targetId).toBe("s-p1-tower-30");
    expect(reach2(last.x, last.y, { x: 30, y: 120, r: STRUCTURE_FOOTPRINT_V5.tower })).toBeLessThanOrEqual(2 * 2);
    expect(g.state.structures.find((s) => s.id === "s-p1-tower-30")!.hp).toBeLessThan(600);
    const a = traceMatch(scenarioConfig(deckWith("hexwing"), deckWith()), [{ seq: 1, player: 0, tick: 2, cardId: "hexwing", x: 30, y: 30 }], 40);
    expect(a.samples.some((s) => s.cardId === "hexwing" && Math.abs(s.x - 30) <= 3 && Math.abs(s.y - 40) <= 3)).toBe(true);
  });
  it("octile accounting: straight 10, diagonal 14, remainder carried exactly", () => {
    const straight = { x: 10, y: 10, moveType: "ground" as const };
    const diag = { x: 10, y: 10, moveType: "ground" as const };
    let cs = 0;
    let cd = 0;
    for (let i = 0; i < 7; i++) {
      cs = moveUnit(straight, { x: 10, y: 60 }, 2, false, [], cs);
      cd = moveUnit(diag, { x: 60, y: 60 }, 2, false, [], cd);
    }
    expect(straight).toMatchObject({ x: 10, y: 24 });
    expect(diag).toMatchObject({ x: 20, y: 20 });
    expect(cd).toBe(0);
    expect(octile({ x: 0, y: 0 }, { x: 3, y: 7 })).toBe(3 * 14 + 4 * 10);
  });
  it("no ground unit stands inside a live footprint across full bot matches", () => {
    for (const seed of ["fp-1", "fp-2"]) {
      const cfg = { ...scenarioConfig(deckWith(), [...deckWith()].reverse(), riftSchedule(seed), seed), commanders: [slot("reaver", "x"), slot("deadeye", "y")] } as CombatConfig;
      const { state, samples } = botMatch(cfg, 3100, 20);
      expect(state.phase).toBe("final");
      const destroyedAt = new Map<string, number>();
      for (const e of state.events) if (e.type === "structure_destroyed") destroyedAt.set(e.entityId, e.tick);
      const structs = initMatch(cfg).structures;
      let checked = 0;
      for (const s of samples) {
        if (s.moveType !== "ground") continue;
        for (const st of structs) {
          const gone = destroyedAt.get(st.id);
          if (gone !== undefined && gone < s.tick) continue;
          const r = STRUCTURE_FOOTPRINT_V5[st.structure];
          expect(Math.abs(s.x - st.x) <= r && Math.abs(s.y - st.y) <= r).toBe(false);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(1000);
    }
  });
});

describe("exact energy economy", () => {
  const drained = (tick: number) => {
    const s = initMatch(scenarioConfig(deckWith(), deckWith()));
    while (s.tick < tick) stepMatch(s, []);
    s.energy = [0, 0];
    s.energyProgress = [0, 0];
    return s;
  };
  const gains = (s: CombatState, ticks: number) => {
    const at: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const before = s.energy[0];
      stepMatch(s, []);
      for (let k = before; k < s.energy[0]; k++) at.push(s.tick);
    }
    return at;
  };
  it("1x/2x/3x yield exactly 1/2/3 energy per 28 ticks with remainder carry", () => {
    expect(gains(drained(100), 84)).toHaveLength(3);
    expect(gains(drained(1300), 84)).toHaveLength(6);
    const triple = gains(drained(2400), 84);
    expect(triple).toHaveLength(9);
    const gaps = triple.slice(1).map((t, i) => t - triple[i]!);
    expect(gaps.every((g) => g === 9 || g === 10)).toBe(true);
    expect(triple[2]! - triple[0]! + (triple[3]! - triple[2]!)).toBe(28);
  });
  it("chaos energy modifiers compose after the phase rate", () => {
    const s = drained(100);
    // Modifier active for accrual ticks tick+1 .. tick+56 (until is exclusive).
    s.energyModUntil = s.tick + 57;
    s.energyModPct = 150;
    expect(gains(s, 56)).toHaveLength(3);
  });
  it("never exceeds the 10-energy cap", () => {
    const s = initMatch(scenarioConfig(deckWith(), deckWith()));
    for (let i = 0; i < 3000 && s.phase !== "final"; i++) {
      stepMatch(s, []);
      expect(s.energy[0]).toBeLessThanOrEqual(ENERGY_V1.max);
    }
    expect(s.energy).toEqual([10, 10]);
  });
});

describe("terminal immutability", () => {
  it("a finished match never changes state, hash or events", () => {
    const { state } = runMatch(scenarioConfig(deckWith(), deckWith()), []);
    expect(state.phase).toBe("final");
    const hash = stateHash(state);
    const events = state.events.length;
    for (let i = 0; i < 5; i++) stepMatch(state, [{ seq: 900 + i, player: 0, tick: state.tick + 1, cardId: "chog_guardian", x: 30, y: 60 }]);
    expect(stateHash(state)).toBe(hash);
    expect(state.events.length).toBe(events);
  });
});
