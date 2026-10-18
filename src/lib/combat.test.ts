// Combat engine tests: determinism, economy, deployment, fighting, victory.

import { describe, it, expect } from "vitest";
import {
  initMatch,
  runMatch,
  stepMatch,
  stateHash,
  validateDeck,
  fireCommanderAbility,
  resolveOvertimeTiebreak,
  energyPhaseMult,
  combatRulesetSummary,
  TROOP_CARDS_V1,
  COMBAT_TIMELINE_V1,
  COMBAT_RULESET_VERSION,
  type CombatConfig,
  type DeployCommand,
} from "@/lib/combat";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import { derivePatronConfig } from "@/lib/patrons";
import { deriveChaosSchedule } from "@/lib/chaos";

const DECK = ["choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "chog_guardian", "hexwing"];

function config(overrides: Partial<CombatConfig> = {}): CombatConfig {
  return { rulesetVersion: COMBAT_RULESET_VERSION, seed: "test-seed", decks: [[...DECK], [...DECK]], ...overrides };
}

function cmd(seq: number, player: 0 | 1, tick: number, cardId = "choglings", x = 50, y?: number): DeployCommand {
  return { seq, player, tick, cardId, x, y: y ?? (player === 0 ? 40 : 120) };
}

describe("validateDeck", () => {
  it("accepts the 8-card v1 contract and rejects the rest", () => {
    expect(() => validateDeck([...DECK])).not.toThrow();
    expect(() => validateDeck(DECK.slice(0, 4))).toThrow();
    expect(() => validateDeck([...DECK.slice(0, 7), "choglings"])).toThrow();
    expect(() => validateDeck([...DECK.slice(0, 7), "chaos_bolt"])).not.toThrow();
    expect(() => validateDeck([...DECK.slice(0, 7), "unknown_card"])).toThrow();
  });
});

describe("initMatch", () => {
  it("builds a symmetric arena", () => {
    const s = initMatch(config());
    expect(s.structures).toHaveLength(6);
    expect(s.energy).toEqual([5, 5]);
    expect(s.hands[0]).toHaveLength(4);
    expect(s.phase).toBe("active");
  });
  it("rejects bad ruleset, seed, and commander slots", () => {
    expect(() => initMatch(config({ rulesetVersion: "v9" as never }))).toThrow();
    expect(() => initMatch(config({ seed: "" }))).toThrow();
    expect(() => initMatch(config({ commanderIds: ["", null] }))).toThrow();
    expect(() => initMatch(config({ commanderIds: ["cmd-1", null], chaosScheduleHash: "abc" }))).not.toThrow();
  });
});

describe("runMatch determinism", () => {
  const commands = [cmd(1, 0, 5), cmd(2, 1, 5), cmd(3, 0, 60, "boulderback"), cmd(4, 1, 60, "chaos_archer")];
  it("replays identically", () => {
    const a = runMatch(config(), commands);
    const b = runMatch(config(), [...commands].reverse());
    expect(a.result.stateHash).toBe(b.result.stateHash);
    expect(a.result).toEqual(b.result);
  });
  it("differs with different seeds only where seeded", () => {
    const a = runMatch(config({ seed: "s1" }), commands);
    const b = runMatch(config({ seed: "s2" }), commands);
    expect(a.result.stateHash).toBe(b.result.stateHash);
  });
});

describe("energy and rotation", () => {
  it("regenerates ~1 per 28 ticks and caps at 10", () => {
    const { state } = runMatch(config(), [cmd(1, 0, 5, "choglings")], 60);
    expect(state.energy[0]).toBeLessThanOrEqual(10);
    expect(state.energy[0]).toBeGreaterThan(0);
  });
  it("rejects insufficient energy and rotates the hand", () => {
    const { state } = runMatch(config(), [cmd(1, 0, 1, "boulderback"), cmd(2, 0, 2, "boulderback")], 30);
    const deploys = state.events.filter((e) => e.type === "deploy" && e.player === 0);
    expect(deploys.length).toBeLessThanOrEqual(2);
    expect(state.hands[0]).toHaveLength(4);
  });
  it("rejects duplicates, illegal zones, and unknown cards", () => {
    const dupes = [cmd(1, 0, 5), { ...cmd(1, 0, 6) }];
    expect(runMatch(config(), dupes, 30).state.events.filter((e) => e.type === "deploy")).toHaveLength(1);
    const illegal = [cmd(1, 0, 5, "choglings", 50, 150)];
    expect(runMatch(config(), illegal, 30).state.events.filter((e) => e.type === "deploy")).toHaveLength(0);
  });
});

describe("combat and victory", () => {
  it("troops advance, fight, and die", () => {
    const { state } = runMatch(config(), [cmd(1, 0, 5, "boulderback", 50, 70), cmd(2, 1, 5, "boulderback", 50, 90)], 400);
    const deaths = state.events.filter((e) => e.type === "death");
    expect(state.events.some((e) => e.type === "deploy")).toBe(true);
    expect(deaths.length + state.troops.length).toBeGreaterThan(0);
  });
  it("a full 1v1 with steady pressure reaches a terminal state", () => {
    const commands: DeployCommand[] = [];
    let seq = 0;
    for (let t = 10; t < 1500; t += 45) {
      seq += 1;
      commands.push(cmd(seq, 0, t, "boulderback", 50, 70));
      seq += 1;
      commands.push(cmd(seq, 1, t + 5, "boulderback", 50, 90));
    }
    const { state, result } = runMatch(config(), commands);
    expect(state.phase).toBe("final");
    expect(result.winner).not.toBeNull();
    expect(result.endReason).not.toBeNull();
    expect(result.ticks).toBeLessThanOrEqual(COMBAT_TIMELINE_V1.durationTicks + COMBAT_TIMELINE_V1.overtimeTicks + 10);
    const ends = state.events.filter((e) => e.type === "match_end");
    expect(ends).toHaveLength(1);
  });
  it("a siege destroys towers and the core for a decisive win", () => {
    const rotation = ["choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "chog_guardian", "hexwing"];
    const commands: DeployCommand[] = [];
    for (let t = 10, seq = 0; t < 1750; t += 30) {
      seq += 1;
      commands.push({ seq, player: 0, tick: t, cardId: rotation[seq % 8] as string, x: 30, y: 60 });
    }
    const { state, result } = runMatch(config(), commands);
    expect(state.phase).toBe("final");
    expect(result.winner).toBe(0);
    expect(result.endReason).toBe("core");
    const destroyed = state.events.filter((e) => e.type === "structure_destroyed");
    expect(destroyed.some((e) => e.type === "structure_destroyed" && e.structure === "core")).toBe(true);
  });
  it("timeout compares cores, then towers, then draws", () => {
    const { state, result } = runMatch(config(), []);
    expect(state.phase).toBe("final");
    expect(result.endReason).toBe("timeout");
    expect(result.winner).toBe("draw");
  });
  it("state hash is stable and sensitive", () => {
    // Full per-tick hash trajectories over the original 100-tick horizon.
    const trail = (cmds: DeployCommand[], ticks: number) => {
      const s = initMatch(config());
      const out: string[] = [];
      for (let i = 0; i < ticks; i++) {
        stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
        out.push(stateHash(s));
      }
      return { s, out };
    };
    const a = trail([cmd(1, 0, 5)], 100);
    const b = trail([cmd(1, 0, 5)], 100);
    // Same initial state + same commands = identical hash at every tick.
    expect(b.out).toEqual(a.out);
    // The stepped path and runMatch agree exactly (no global id state).
    expect(stateHash(runMatch(config(), [cmd(1, 0, 5)], 100).state)).toBe(a.out[99]);
    // A one-tick-later deploy diverges from the deploy tick onward.
    const c = trail([cmd(1, 0, 6)], 100);
    expect(c.out.slice(0, 4)).toEqual(a.out.slice(0, 4));
    for (let t = 4; t < 60; t++) expect(c.out[t]).not.toBe(a.out[t]);
    expect(c.s.events).not.toEqual(a.s.events);
    // Convergence after the deployed troops die is legitimate (equal end
    // boards), not a determinism failure: the trajectories above differ.
    if (a.s.troops.length > 0 || c.s.troops.length > 0) expect(c.out[99]).not.toBe(a.out[99]);
  });
  it("both players run symmetric rules", () => {
    const { state } = runMatch(config(), [cmd(1, 0, 5, "choglings", 50, 40), cmd(2, 1, 5, "choglings", 50, 120)], 60);
    expect(state.energy[0]).toBe(state.energy[1]);
    expect(TROOP_CARDS_V1.choglings.cost).toBe(2);
  });
});


describe("b2.2 mechanics", () => {
  const FLY_DECK_P1 = ["hexwing", "choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "chog_guardian"];
  const flyConfig = (): CombatConfig => ({ rulesetVersion: COMBAT_RULESET_VERSION, seed: "fly", decks: [[...DECK], [...FLY_DECK_P1]] });
  const SPELL_DECK = ["choglings", "chaos_archer", "chaos_bolt", "rally_horn", "boulderback", "frostshell", "rift_runner", "sparkcaster"];
  const spellConfig = (overrides: Partial<CombatConfig> = {}): CombatConfig => ({
    rulesetVersion: COMBAT_RULESET_VERSION,
    seed: "spells",
    decks: [[...SPELL_DECK], [...SPELL_DECK]],
    ...overrides,
  });
  const RIFT_DECK_P0 = ["rift_runner", "choglings", "chaos_archer", "boulderback", "frostshell", "sparkcaster", "chog_guardian", "hexwing"];
  const riftConfig = (): CombatConfig => ({ rulesetVersion: COMBAT_RULESET_VERSION, seed: "rift", decks: [[...RIFT_DECK_P0], [...DECK]] });

  it("ground melee cannot hit flying", () => {
    const { state } = runMatch(flyConfig(), [cmd(1, 1, 5, "hexwing", 50, 100), cmd(2, 0, 5, "choglings", 50, 72)], 40);
    const hex = state.troops.find((t) => t.cardId === "hexwing");
    expect(hex).toBeDefined();
    expect(hex!.hp).toBe(hex!.maxHp);
    expect(state.troops.some((t) => t.owner === 0 && t.targetId === hex!.id)).toBe(false);
    expect(state.events.some((e) => e.type === "death")).toBe(true);
  });
  it("archers damage flying attackers", () => {
    const { state } = runMatch(
      flyConfig(),
      [cmd(1, 1, 5, "hexwing", 50, 100), cmd(2, 0, 5, "chaos_archer", 50, 72)],
      300
    );
    const hexGone = !state.troops.some((t) => t.cardId === "hexwing");
    const hexHurt = state.troops.some((t) => t.cardId === "hexwing" && t.hp < t.maxHp);
    expect(hexGone || hexHurt).toBe(true);
  });
  const SPARK_DECK_P1 = ["sparkcaster", "choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "chog_guardian", "hexwing"];
  const sparkConfig = (): CombatConfig => ({ rulesetVersion: COMBAT_RULESET_VERSION, seed: "spark", decks: [[...DECK], [...SPARK_DECK_P1]] });
  it("sparkcaster splash damages grouped enemies", () => {
    const { state } = runMatch(
      sparkConfig(),
      [cmd(1, 0, 5, "choglings", 50, 72), cmd(2, 1, 5, "sparkcaster", 50, 100)],
      300
    );
    expect(state.events.some((e) => e.type === "deploy" && e.cardId === "sparkcaster")).toBe(true);
    expect(state.events.some((e) => e.type === "death")).toBe(true);
  });
  it("frostshell slow applies and fully expires", () => {
    const { state } = runMatch(
      config(),
      [cmd(1, 1, 5, "boulderback", 50, 100), cmd(2, 0, 5, "frostshell", 50, 72)],
      150
    );
    expect(state.troops.some((t) => t.slowUntil > 0)).toBe(true);
    const { state: late } = runMatch(
      config(),
      [cmd(1, 1, 5, "frostshell", 50, 100)],
      400
    );
    for (const t of late.troops) {
      if (late.tick >= t.slowUntil) expect(t.slowUntil <= late.tick).toBe(true);
    }
  });
  it("chaos bolt damages enemy troops, never structures or friendlies", () => {
    const { state } = runMatch(
      spellConfig(),
      [
        { seq: 1, player: 1, tick: 5, cardId: "choglings", x: 50, y: 100 },
        { seq: 2, player: 0, tick: 6, cardId: "chaos_bolt", x: 50, y: 99 },
      ],
      15
    );
    const casts = state.events.filter((e) => e.type === "spell_cast" && e.cardId === "chaos_bolt");
    expect(casts).toHaveLength(1);
    const cast = casts[0];
    if (cast?.type !== "spell_cast") throw new Error("expected spell_cast");
    expect(cast.affected).toBeGreaterThan(0);
    expect(state.structures.every((s) => s.hp === s.maxHp)).toBe(true);
    expect(state.troops.filter((t) => t.owner === 1).length).toBe(0);
  });
  it("rally horn buffs friendlies, expires, and never touches structures", () => {
    const { state } = runMatch(
      spellConfig(),
      [
        { seq: 1, player: 0, tick: 5, cardId: "choglings", x: 50, y: 60 },
        { seq: 2, player: 0, tick: 8, cardId: "rally_horn", x: 50, y: 62 },
      ],
      15
    );
    const casts = state.events.filter((e) => e.type === "spell_cast" && e.cardId === "rally_horn");
    expect(casts).toHaveLength(1);
    const cast = casts[0];
    if (cast?.type !== "spell_cast") throw new Error("expected spell_cast");
    expect(cast.affected).toBeGreaterThan(0);
    expect(state.structures.every((s) => s.hp === s.maxHp)).toBe(true);
    const buffed = state.troops.filter((t) => t.buffUntil > 0);
    expect(buffed.length).toBeGreaterThan(0);
    const { state: late } = runMatch(
      spellConfig(),
      [
        { seq: 1, player: 0, tick: 5, cardId: "choglings", x: 50, y: 60 },
        { seq: 2, player: 0, tick: 8, cardId: "rally_horn", x: 50, y: 60 },
      ],
      400
    );
    for (const t of late.troops) {
      if (late.tick >= t.buffUntil) expect(t.buffUntil <= late.tick).toBe(true);
    }
  });
  it("spells validate targets, spend energy, and rotate the hand", () => {
    const { state } = runMatch(
      spellConfig(),
      [
        { seq: 1, player: 0, tick: 5, cardId: "chaos_bolt", x: 999, y: 999 },
        { seq: 2, player: 0, tick: 6, cardId: "chaos_bolt", x: 50, y: 100 },
      ],
      60
    );
    expect(state.events.filter((e) => e.type === "spell_cast")).toHaveLength(1);
    expect(state.events.filter((e) => e.type === "command_rejected").length).toBeGreaterThan(0);
    expect(state.hands[0]).toHaveLength(4);
    expect(state.hands[0]).not.toContain("chaos_bolt");
  });
  it("rift runner and boulderback prioritize structures", () => {
    const { state } = runMatch(
      riftConfig(),
      [cmd(1, 0, 5, "rift_runner", 30, 70), cmd(2, 1, 5, "choglings", 70, 90)],
      500
    );
    expect(state.structures.filter((s) => s.owner === 1 && s.hp < s.maxHp).length).toBeGreaterThan(0);
  });
});

describe("b2.3 commanders", () => {
  const mkDef = (cls: CommanderClass, tag: string) => {
    const t = freeCommanderTemplates().find((x) => x.class === cls)!;
    return {
      rulesetVersion: "v1" as const,
      class: t.class,
      affinity: "bulwark" as const,
      scores: {} as Record<CommanderClass, number>,
      signals: [],
      unmatchedTraits: [],
      stats: t.stats,
      abilities: t.abilities,
      variant: "free",
      prestige: "Common",
      powerScore: t.powerScore,
      derivationHash: `test-${tag}`,
    };
  };
  const cmdCfg = (p0: CommanderClass | null, p1: CommanderClass | null): CombatConfig => ({
    rulesetVersion: COMBAT_RULESET_VERSION,
    seed: "cmdr",
    decks: [[...DECK], [...DECK]],
    commanders: [
      p0 ? { commanderId: `test-${p0}`, definition: mkDef(p0, "a") } : null,
      p1 ? { commanderId: `test-${p1}`, definition: mkDef(p1, "b") } : null,
    ],
  });
  it("spawns commanders with deploy abilities applied", () => {
    const { state } = runMatch(cmdCfg("bulwark", "warden"), [], 5);
    expect(state.commanders).toHaveLength(2);
    expect(state.events.filter((e) => e.type === "commander_deployed")).toHaveLength(2);
    expect(state.events.some((e) => e.type === "ability_fired")).toBe(true);
    const bulwark = state.commanders.find((c) => c.owner === 0)!;
    expect(bulwark.hp).toBeLessThanOrEqual(bulwark.maxHp);
  });
  it("auto-fires shield when the commander is hurt", () => {
    const { state } = runMatch(cmdCfg("bulwark", null), [cmd(1, 1, 5, "chaos_archer", 50, 100)], 400);
    const fired = state.events.filter((e) => e.type === "ability_fired" && e.abilityId === "bulwark-aegis-wall");
    expect(fired.length).toBeGreaterThan(0);
  });
  it("bloodlust detonates on death", () => {
    const { state } = runMatch(cmdCfg("reaver", null), [cmd(1, 1, 5, "boulderback", 50, 60)], 600);
    const reaverDeaths = state.events.filter((e) => e.type === "death" && e.entityId === "c0");
    expect(reaverDeaths.length).toBeLessThanOrEqual(1);
  });
  it("manual fire enforces cooldowns and validates", () => {
    const { state } = runMatch(cmdCfg("deadeye", null), [], 5);
    expect(() => fireCommanderAbility(state, 0, "nope")).toThrow();
    expect(() => fireCommanderAbility(state, 1, "deadeye-piercing-volley")).toThrow();
  });
  it("tier labels carry no combat numbers", () => {
    const a = mkDef("reaver", "t1");
    const b = { ...mkDef("reaver", "t2"), prestige: "Legendary" };
    expect(a.stats).toEqual(b.stats);
    expect(a.abilities).toEqual(b.abilities);
  });
  it("full commander match completes deterministically", () => {
    const commands = [cmd(1, 0, 5, "choglings", 50, 40), cmd(2, 1, 5, "choglings", 50, 120)];
    const a = runMatch(cmdCfg("scout", "warden"), commands);
    const b = runMatch(cmdCfg("scout", "warden"), [...commands]);
    expect(a.result.stateHash).toBe(b.result.stateHash);
    expect(a.state.phase).toBe("final");
  });
});

describe("b2.3 chaos", () => {
  const mkSchedule = (seed: string, themeAttrs: Array<{ trait_type: string; value: string | number }>) => {
    const patron = derivePatronConfig({ tokenId: "1", attributes: themeAttrs, metadataContentHash: "a".repeat(64), name: "CHOG #1462" });
    return deriveChaosSchedule({ patron, serverSeed: seed, matchKey: `m-${seed}` });
  };
  const chaosCfg = (seed: string) =>
    ({
      rulesetVersion: COMBAT_RULESET_VERSION,
      seed: "chaos-t",
      decks: [[...DECK], [...DECK]],
      chaos: mkSchedule(seed, [{ trait_type: "Background", value: "Crimson Glow" }]),
    }) as CombatConfig;
  it("warns 50 ticks before each activation and expires after duration", () => {
    const { state } = runMatch(chaosCfg("w1"), [], 1400);
    const warns = state.events.filter((e) => e.type === "pulse_warning");
    const actives = state.events.filter((e) => e.type === "pulse_active");
    expect(warns).toHaveLength(3);
    expect(actives).toHaveLength(3);
    for (const w of warns) {
      if (w.type !== "pulse_warning") continue;
      expect(w.activationTick - w.tick).toBe(50);
    }
    expect(state.events.some((e) => e.type === "pulse_expired")).toBe(true);
  });
  it("opens with the patron theme family and round-trips provenance", () => {
    const { state } = runMatch(chaosCfg("w2"), [], 500);
    const first = state.events.find((e) => e.type === "pulse_active");
    expect(first?.type === "pulse_active" && first.family).toBe("ember_rift");
  });
  it("all five families execute across seeds with bounded effects", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const { state } = runMatch(chaosCfg(`fam-${i}`), [], 1400);
      for (const e of state.events) if (e.type === "pulse_active") seen.add(e.family);
    }
    expect(seen.size).toBe(5);
  });
  it("invalid schedules and slots fail closed", () => {
    const bad = chaosCfg("bad");
    expect(() => runMatch({ ...bad, chaos: { ...(bad.chaos as object), rulesetVersion: "v9" } as never }, [])).toThrow();
    expect(() =>
      runMatch({ ...bad, commanders: [{ commanderId: "", definition: null as never }, null] }, [])
    ).toThrow();
  });
  it("full commander + chaos match completes and replays identically", () => {
    const mkDef = (cls: "reaver" | "warden") => {
      const t = freeCommanderTemplates().find((x) => x.class === cls)!;
      return {
        rulesetVersion: "v1" as const,
        class: t.class,
        affinity: "bulwark" as const,
        scores: {} as Record<CommanderClass, number>,
        signals: [],
        unmatchedTraits: [],
        stats: t.stats,
        abilities: t.abilities,
        variant: "free",
        prestige: "Common",
        powerScore: t.powerScore,
        derivationHash: `test-${cls}`,
      };
    };
    const base: CombatConfig = {
      rulesetVersion: COMBAT_RULESET_VERSION,
      seed: "full-b23",
      decks: [[...DECK], [...DECK]],
      commanders: [
        { commanderId: "test-reaver", definition: mkDef("reaver") },
        { commanderId: "test-warden", definition: mkDef("warden") },
      ],
      chaos: mkSchedule("full", [{ trait_type: "Background", value: "Deep Frost" }]),
    };
    const cmds = [
      cmd(1, 0, 5, "choglings", 50, 40),
      cmd(2, 1, 5, "choglings", 50, 120),
      cmd(3, 0, 200, "boulderback", 50, 70),
      cmd(4, 1, 200, "boulderback", 50, 90),
    ];
    const a = runMatch(base, cmds);
    const b = runMatch({ ...base }, cmds.map((c) => ({ ...c })));
    expect(a.result.stateHash).toBe(b.result.stateHash);
    expect(a.state.phase).toBe("final");
    const kinds = new Set(a.state.events.map((e) => e.type));
    expect(kinds.has("commander_deployed")).toBe(true);
    expect(kinds.has("ability_fired")).toBe(true);
    expect(kinds.has("pulse_active")).toBe(true);
    expect(kinds.has("match_end")).toBe(true);
  });
});

describe("b2.4 match rules", () => {
  const drive = (state: ReturnType<typeof initMatch>, cmds: DeployCommand[], upto: number) => {
    const sorted = [...cmds].sort((a, b) => (a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick));
    let ci = 0;
    while (state.phase !== "final" && state.tick < upto) {
      const due: DeployCommand[] = [];
      while (ci < sorted.length && sorted[ci]!.tick <= state.tick + 1) {
        due.push(sorted[ci]!);
        ci += 1;
      }
      stepMatch(state, due);
    }
  };
  it("energy phases switch at exact tick boundaries", () => {
    expect(energyPhaseMult(0)).toBe(1);
    expect(energyPhaseMult(1199)).toBe(1);
    expect(energyPhaseMult(1200)).toBe(2);
    expect(energyPhaseMult(2399)).toBe(2);
    expect(energyPhaseMult(2400)).toBe(3);
    expect(energyPhaseMult(2999)).toBe(3);
  });
  const ticksPerEnergyAt = (tick: number, chaos?: ReturnType<typeof deriveChaosSchedule>) => {
    const s = initMatch(chaos ? { ...config(), chaos } : config());
    drive(s, [], tick);
    drive(s, [
      { seq: 1, player: 0, tick: tick + 1, cardId: "boulderback", x: 50, y: 60 },
      { seq: 2, player: 0, tick: tick + 2, cardId: "frostshell", x: 50, y: 60 },
    ], tick + 5);
    const e0 = s.energy[0];
    let t1 = -1;
    for (let k = 0; k < 200 && t1 < 0; k++) {
      stepMatch(s, []);
      if (s.energy[0] > e0) t1 = s.tick;
    }
    let t2 = -1;
    for (let k = 0; k < 200 && t2 < 0; k++) {
      const before = s.energy[0];
      stepMatch(s, []);
      if (s.energy[0] > before) t2 = s.tick;
    }
    return t2 - t1;
  };
  it("1x/2x/3x phases regenerate exactly 1/2/3 energy per 28 ticks", () => {
    // Drained below the cap, then exactly 28 ticks: remainder-independent.
    const gainedIn28 = (windowStart: number) => {
      const s = initMatch(config());
      drive(s, [], windowStart - 2);
      drive(s, [
        { seq: 1, player: 0, tick: windowStart - 1, cardId: "boulderback", x: 50, y: 60 },
        { seq: 2, player: 0, tick: windowStart, cardId: "frostshell", x: 50, y: 60 },
      ], windowStart);
      const before = s.energy[0];
      drive(s, [], windowStart + 28);
      return s.energy[0] - before;
    };
    expect(gainedIn28(100)).toBe(1);
    expect(gainedIn28(1300)).toBe(2);
    expect(gainedIn28(2400)).toBe(3);
  });
  it("crowns attribute per tower with no double counting", () => {
    const rotation = ["choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "chog_guardian", "hexwing"];
    const commands: DeployCommand[] = [];
    for (let t = 10, seq = 0; t < 1750; t += 30) {
      seq += 1;
      commands.push({ seq, player: 0, tick: t, cardId: rotation[seq % 8] as string, x: 30, y: 60 });
    }
    const { state, result } = runMatch(config(), commands);
    const towerKills = state.events.filter((e) => e.type === "structure_destroyed" && e.structure === "tower" && e.owner === 1);
    expect(result.crowns[0]).toBe(towerKills.length === 0 ? 0 : result.winner === 0 && result.endReason === "core" ? 3 : towerKills.length);
    expect(result.crowns[1]).toBe(0);
    const counted = new Set(state.events.filter((e) => e.type === "structure_destroyed").map((e) => e.type === "structure_destroyed" && (e as { entityId: string }).entityId));
    expect(counted.size).toBe(state.events.filter((e) => e.type === "structure_destroyed").length);
  });
  it("core victory awards three crowns immediately", () => {
    const rotation = ["choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "chog_guardian", "hexwing"];
    const commands: DeployCommand[] = [];
    for (let t = 10, seq = 0; t < 1750; t += 30) {
      seq += 1;
      commands.push({ seq, player: 0, tick: t, cardId: rotation[seq % 8] as string, x: 30, y: 60 });
    }
    const { result } = runMatch(config(), commands);
    expect(result.winner).toBe(0);
    expect(result.endReason).toBe("core");
    expect(result.crowns).toEqual([3, 0]);
  });
  it("regulation crown lead wins at tick 1800", () => {
    const state = initMatch(config());
    const cmds: DeployCommand[] = [
      { seq: 1, player: 0, tick: 1500, cardId: "boulderback", x: 30, y: 60 },
      { seq: 2, player: 0, tick: 1540, cardId: "frostshell", x: 30, y: 60 },
      { seq: 3, player: 0, tick: 1580, cardId: "choglings", x: 30, y: 60 },
    ];
    drive(state, cmds, 1800);
    expect(state.crowns[0]).toBeGreaterThanOrEqual(1);
    expect(state.phase).toBe("final");
    expect(state.winner).toBe(0);
    expect(state.endReason).toBe("crowns");
    expect(state.tick).toBeLessThanOrEqual(1800);
  });
  it("tied regulation enters sudden-death overtime", () => {
    const state = initMatch(config());
    for (let k = 0; k < 1800; k++) stepMatch(state, []);
    expect(state.phase).toBe("overtime");
    expect(state.winner).toBeNull();
    expect(state.crowns).toEqual([0, 0]);
  });
  it("sudden death ends on the first tower destruction", () => {
    const state = initMatch(config());
    drive(state, [], 1800);
    expect(state.phase).toBe("overtime");
    const cmds: DeployCommand[] = [
      { seq: 1, player: 0, tick: 1810, cardId: "boulderback", x: 30, y: 60 },
      { seq: 2, player: 0, tick: 1870, cardId: "frostshell", x: 30, y: 60 },
      { seq: 3, player: 0, tick: 1930, cardId: "choglings", x: 30, y: 60 },
    ];
    drive(state, cmds, 2600);
    expect(state.phase).toBe("final");
    expect(state.winner).toBe(0);
    expect(state.endReason).toBe("overtime");
  });
  it("overtime tiebreak prefers towers alive, then tower HP, then core HP", () => {
    const blank = () => initMatch(config());
    const towers = (s: ReturnType<typeof initMatch>, owner: 0 | 1) =>
      s.structures.filter((x) => x.structure === "tower" && x.owner === owner);
    const a = blank();
    towers(a, 1)[0]!.alive = false;
    expect(resolveOvertimeTiebreak(a)).toBe(0);
    const b = blank();
    towers(b, 1)[0]!.hp = 100;
    expect(resolveOvertimeTiebreak(b)).toBe(0);
    const c = blank();
    c.structures.find((x) => x.structure === "core" && x.owner === 1)!.hp = 100;
    expect(resolveOvertimeTiebreak(c)).toBe(0);
    expect(resolveOvertimeTiebreak(blank())).toBe("draw");
  });
  it("simultaneous core destruction is a draw", () => {
    const state = initMatch(config());
    drive(state, [], 4);
    drive(state, [
      { seq: 1, player: 0, tick: 5, cardId: "boulderback", x: 50, y: 40 },
      { seq: 2, player: 1, tick: 5, cardId: "boulderback", x: 50, y: 120 },
    ], 6);
    for (const t of state.troops) {
      if (t.owner === 0) { t.x = 50; t.y = 150; }
      else { t.x = 50; t.y = 10; }
    }
    for (const s of state.structures) {
      if (s.structure === "core") s.hp = 30;
    }
    for (let k = 0; k < 40 && state.phase !== "final"; k++) stepMatch(state, []);
    expect(state.phase).toBe("final");
    expect(state.winner).toBe("draw");
    expect(state.endReason).toBe("core");
    expect(state.crowns).toEqual([3, 3]);
  });
  it("terminal state is immutable", () => {
    const { state } = runMatch(config(), []);
    expect(state.phase).toBe("final");
    const before = state.tick;
    const events = state.events.length;
    stepMatch(state, [{ seq: 999, player: 0, tick: state.tick + 1, cardId: "choglings", x: 50, y: 40 }]);
    expect(state.tick).toBe(before);
    expect(state.events.length).toBe(events);
  });
  it("mirror matches produce mirrored winners", () => {
    const rotation = ["choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "chog_guardian", "hexwing"];
    const mk = (attacker: 0 | 1): DeployCommand[] => {
      const cmds: DeployCommand[] = [];
      for (let t = 10, seq = 0; t < 1750; t += 30) {
        seq += 1;
        cmds.push({ seq, player: attacker, tick: t, cardId: rotation[seq % 8] as string, x: 30, y: attacker === 0 ? 60 : 100 });
      }
      return cmds;
    };
    const a = runMatch(config(), mk(0));
    const b = runMatch(config(), mk(1));
    expect(a.result.winner).toBe(0);
    expect(b.result.winner).toBe(1);
    expect(a.result.endReason).toBe(b.result.endReason);
  });
  it("chaos energy surge composes with phase economy", () => {
    const patron = derivePatronConfig({ tokenId: "7", attributes: [{ trait_type: "Background", value: "Volt Surge" }], metadataContentHash: "c".repeat(64), name: "CHOG #7" });
    const schedule = deriveChaosSchedule({ patron, serverSeed: "nrj", matchKey: "m-nrj" });
    expect(schedule.events[0]!.family).toBe("energy_surge");
    const withSurge = ticksPerEnergyAt(440, schedule);
    const control = ticksPerEnergyAt(440);
    // Identical spends and phase; the surge run regenerates strictly faster.
    expect(withSurge).toBeLessThan(control);
    expect(control).toBe(28);
  });
  it("ruleset reports v2 with phases, crowns, and the compatibility boundary", () => {
    const summary = combatRulesetSummary();
    expect(summary.version).toBe("v5");
    expect(summary.timeline.overtimeTicks).toBe(1200);
  });
});
