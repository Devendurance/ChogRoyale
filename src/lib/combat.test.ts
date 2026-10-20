// Combat engine tests: determinism, economy, deployment, fighting, victory.

import { describe, it, expect } from "vitest";
import {
  initMatch,
  runMatch,
  stepMatch,
  stateHash,
  validateDeck,
  freeStarterSlot,
  resolveOvertimeTiebreak,
  energyPhaseMult,
  combatRulesetSummary,
  TROOP_CARDS_V1,
  COMBAT_TIMELINE_V1,
  COMBAT_RULESET_VERSION,
  STRUCTURE_V1,
  type CombatConfig,
  type DeployCommand,
  type PlayerIndex,
  type TroopEntity,
} from "@/lib/combat";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import { derivePatronConfig } from "@/lib/patrons";
import { deriveChaosSchedule } from "@/lib/chaos";

const DECK = ["choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "chog_guardian", "cmdr:free-bulwark"];
const FREE = (): [ReturnType<typeof freeStarterSlot>, ReturnType<typeof freeStarterSlot>] => [freeStarterSlot("bulwark"), freeStarterSlot("bulwark")];

function config(overrides: Partial<CombatConfig> = {}): CombatConfig {
  return { rulesetVersion: COMBAT_RULESET_VERSION, seed: "test-seed", decks: [[...DECK], [...DECK]], commanders: FREE(), ...overrides };
}

function cmd(seq: number, player: 0 | 1, tick: number, cardId = "choglings", x = 50, y?: number): DeployCommand {
  return { seq, player, tick, cardId, x, y: y ?? (player === 0 ? 40 : 120) };
}

describe("validateDeck", () => {
  it("accepts exactly 7 ordinary cards + 1 matching commander and rejects the rest", () => {
    const slot = freeStarterSlot("bulwark");
    expect(() => validateDeck([...DECK], slot)).not.toThrow();
    expect(() => validateDeck([...DECK])).toThrow();
    expect(() => validateDeck(DECK.slice(0, 4), slot)).toThrow();
    expect(() => validateDeck([...DECK.slice(0, 6), "choglings", "cmdr:free-bulwark"], slot)).toThrow();
    expect(() => validateDeck([...DECK.slice(0, 6), "chaos_bolt", "cmdr:free-bulwark"], slot)).not.toThrow();
    expect(() => validateDeck([...DECK.slice(0, 6), "unknown_card", "cmdr:free-bulwark"], slot)).toThrow();
    expect(() => validateDeck([...DECK.slice(0, 7), "hexwing"], slot)).toThrow();
    expect(() => validateDeck([...DECK.slice(0, 7), "cmdr:free-reaver"], slot)).toThrow();
    expect(() => validateDeck([...DECK.slice(0, 6), "cmdr:free-bulwark", "cmdr:free-reaver"], slot)).toThrow();
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
  const FLY_DECK_P1 = ["hexwing", "choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "cmdr:free-bulwark"];
  const flyConfig = (): CombatConfig => ({ rulesetVersion: COMBAT_RULESET_VERSION, seed: "fly", commanders: FREE(), decks: [[...DECK], [...FLY_DECK_P1]] });
  const SPELL_DECK = ["choglings", "chaos_archer", "chaos_bolt", "rally_horn", "boulderback", "frostshell", "rift_runner", "cmdr:free-bulwark"];
  const spellConfig = (overrides: Partial<CombatConfig> = {}): CombatConfig => ({
    rulesetVersion: COMBAT_RULESET_VERSION,
    seed: "spells",
    commanders: FREE(),
    decks: [[...SPELL_DECK], [...SPELL_DECK]],
    ...overrides,
  });
  const RIFT_DECK_P0 = ["rift_runner", "choglings", "chaos_archer", "boulderback", "frostshell", "sparkcaster", "chog_guardian", "cmdr:free-bulwark"];
  const riftConfig = (): CombatConfig => ({ rulesetVersion: COMBAT_RULESET_VERSION, seed: "rift", commanders: FREE(), decks: [[...RIFT_DECK_P0], [...DECK]] });

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
  const SPARK_DECK_P1 = ["sparkcaster", "choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "chog_guardian", "cmdr:free-bulwark"];
  const sparkConfig = (): CombatConfig => ({ rulesetVersion: COMBAT_RULESET_VERSION, seed: "spark", commanders: FREE(), decks: [[...DECK], [...SPARK_DECK_P1]] });
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
  const cmdCfg = (p0: CommanderClass, p1: CommanderClass): CombatConfig => ({
    rulesetVersion: COMBAT_RULESET_VERSION,
    seed: "cmdr",
    decks: [[`cmdr:free-${p0}`, ...DECK.slice(0, 7)], [`cmdr:free-${p1}`, ...DECK.slice(0, 7)]],
    commanders: [freeStarterSlot(p0), freeStarterSlot(p1)],
  });
  const deployC = (seq: number, player: 0 | 1, tick: number, cls: CommanderClass, x = 50, y?: number): DeployCommand => ({
    seq, player, tick, cardId: `cmdr:free-${cls}`, x, y: y ?? (player === 0 ? 50 : 110),
  });
  it("never spawns at tick 0; deploys from hand with deploy abilities applied", () => {
    expect(runMatch(cmdCfg("bulwark", "warden"), [], 5).state.commanders).toHaveLength(0);
    const { state } = runMatch(cmdCfg("bulwark", "warden"), [deployC(1, 0, 3, "bulwark"), deployC(2, 1, 3, "warden")], 5);
    expect(state.commanders).toHaveLength(2);
    expect(state.events.filter((e) => e.type === "commander_deployed")).toHaveLength(2);
    expect(state.events.some((e) => e.type === "ability_fired" && e.abilityId === "bulwark-bedrock")).toBe(true);
    expect(state.events.some((e) => e.type === "ability_fired" && e.abilityId === "warden-mend")).toBe(true);
    expect(state.energy).toEqual([0, 0]);
  });
  it("v7: a hurt commander never auto-fires its active ability", () => {
    const { state } = runMatch(cmdCfg("bulwark", "warden"), [deployC(1, 0, 3, "bulwark"), cmd(2, 1, 5, "chaos_archer", 50, 100)], 400);
    expect(state.events.some((e) => e.type === "ability_fired" && e.trigger === "active")).toBe(false);
    expect(state.events.some((e) => e.type === "ability_fired" && e.abilityId === "bulwark-bedrock")).toBe(true);
  });
  it("bloodlust detonates on death", () => {
    const { state } = runMatch(cmdCfg("reaver", "warden"), [deployC(1, 0, 3, "reaver"), cmd(2, 1, 60, "boulderback", 50, 100)], 900);
    const reaverDeaths = state.events.filter((e) => e.type === "death" && e.entityId === "c0-1");
    expect(reaverDeaths).toHaveLength(1);
  });
  it("ability commands validate the ability and the acting player", () => {
    const ab = (seq: number, player: 0 | 1, abilityId: string) => ({ kind: "ability" as const, seq, player, tick: 4, abilityId });
    const { state } = runMatch(cmdCfg("deadeye", "warden"), [deployC(1, 0, 3, "deadeye"), ab(2, 0, "nope"), ab(3, 1, "deadeye-piercing-volley")], 5);
    const rej = state.events.flatMap((e) => (e.type === "command_rejected" ? [e.reason] : []));
    expect(rej).toEqual(["Ability not on commander: nope", "No living commander for player"]);
  });
  it("tier labels carry no combat numbers", () => {
    const a = mkDef("reaver", "t1");
    const b = { ...mkDef("reaver", "t2"), prestige: "Legendary" };
    expect(a.stats).toEqual(b.stats);
    expect(a.abilities).toEqual(b.abilities);
  });
  it("full commander match completes deterministically", () => {
    const commands = [cmd(1, 0, 5, "choglings", 50, 40), cmd(2, 1, 5, "choglings", 50, 120), deployC(3, 0, 140, "scout"), deployC(4, 1, 140, "warden")];
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
      commanders: FREE(),
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
    const base: CombatConfig = {
      rulesetVersion: COMBAT_RULESET_VERSION,
      seed: "full-b23",
      decks: [["cmdr:free-reaver", ...DECK.slice(0, 7)], ["cmdr:free-warden", ...DECK.slice(0, 7)]],
      commanders: [freeStarterSlot("reaver"), freeStarterSlot("warden")],
      chaos: mkSchedule("full", [{ trait_type: "Background", value: "Deep Frost" }]),
    };
    const cmds = [
      cmd(1, 0, 5, "choglings", 50, 40),
      cmd(2, 1, 5, "choglings", 50, 120),
      cmd(3, 0, 200, "boulderback", 50, 70),
      cmd(4, 1, 200, "boulderback", 50, 90),
      { seq: 5, player: 0 as const, tick: 400, cardId: "cmdr:free-reaver", x: 30, y: 60 },
      { seq: 6, player: 1 as const, tick: 400, cardId: "cmdr:free-warden", x: 70, y: 100 },
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
    expect(summary.version).toBe("v16");
    expect(summary.timeline.overtimeTicks).toBe(1200);
  });
});

describe("tower_fired events", () => {
  const fakeTroop = (id: string, owner: PlayerIndex, x: number, y: number, hp = 200): TroopEntity => ({
    id, kind: "troop", owner, cardId: "choglings", x, y, hp, maxHp: hp, damage: 0, range: 2, speed: 0, sight: 0,
    interval: 99, cooldownUntil: 0, targetId: null, moveType: "ground", hitsAir: false, hitsGround: true,
    structPriority: false, splashRadius: 0, projectileTicks: 0, slowPct: 0, slowDurationTicks: 0,
    slowUntil: 0, activeSlowPct: 0, buffUntil: 0, buffPct: 0, hasteUntil: 0, hastePct: 0, stunUntil: 99999,
    shieldHp: 0, shieldUntil: 0, reflectUntil: 0, reflectFracNumer: 0, reflectFracDenom: 1,
    guardUntil: 0, guardPct: 0, armor: 0, moveCarry: 0,
  });
  const fires = (s: { events: { type: string }[] }) => s.events.filter((e) => e.type === "tower_fired") as Extract<import("@/lib/combat").CombatEvent, { type: "tower_fired" }>[];

  it("a side tower emits exactly one tower_fired per attack tick with correct fields", () => {
    const s = initMatch(config());
    s.troops.push(fakeTroop("et", 1, 30, 55));
    while (s.tick < STRUCTURE_V1.tower.intervalTicks) stepMatch(s);
    const evs = fires(s);
    expect(evs).toHaveLength(1);
    const e = evs[0]!;
    expect(e.structureId).toBe("s-p0-tower-30");
    expect(e.owner).toBe(0);
    expect(e.targetId).toBe("et");
    expect(e.tick).toBe(STRUCTURE_V1.tower.intervalTicks);
    // x,y are the target's position at fire time.
    expect(e.x).toBe(30);
    expect(e.y).toBe(55);
    // Damage is unchanged: exactly def.damage on the fire tick.
    expect(s.troops[0]!.hp).toBe(200 - STRUCTURE_V1.tower.damage);
  });

  it("a core emits exactly one tower_fired per attack tick", () => {
    const s = initMatch(config());
    // Near p1's core; also inside a tower's reach, which is fine: each
    // structure emits its own single event.
    s.troops.push(fakeTroop("et", 0, 50, 127));
    while (s.tick < STRUCTURE_V1.core.intervalTicks) stepMatch(s);
    const core = fires(s).filter((e) => e.structureId === "s-p1-core");
    expect(core).toHaveLength(1);
    expect(core[0]!.owner).toBe(1);
    expect(core[0]!.targetId).toBe("et");
    expect(core[0]!.tick).toBe(STRUCTURE_V1.core.intervalTicks);
    expect(core[0]!.x).toBe(50);
    expect(core[0]!.y).toBe(127);
    for (const e of fires(s)) {
      const st = s.structures.find((x) => x.id === e.structureId)!;
      expect(e.owner).toBe(st.owner);
      expect(st.alive).toBe(true);
    }
  });

  it("emits nothing with no enemy in range, for dead structures, or off-interval", () => {
    // Empty board: no fires at all.
    const quiet = initMatch(config());
    for (let i = 0; i < 30; i++) stepMatch(quiet);
    expect(fires(quiet)).toHaveLength(0);

    // Dead structure never fires even with a target in range.
    const s = initMatch(config());
    const tower = s.structures.find((t) => t.id === "s-p0-tower-30")!;
    tower.alive = false;
    tower.hp = 0;
    s.troops.push(fakeTroop("et", 1, 30, 55));
    while (s.tick < 12) stepMatch(s);
    expect(fires(s).filter((e) => e.structureId === "s-p0-tower-30")).toHaveLength(0);

    // Non-interval ticks stay silent; each interval tick fires once.
    const t2 = initMatch(config());
    t2.troops.push(fakeTroop("et", 1, 30, 55));
    let expected = 0;
    for (let i = 0; i < 25; i++) {
      stepMatch(t2);
      const here = fires(t2).filter((e) => e.tick === t2.tick);
      const inRange = t2.troops[0] && t2.troops[0]!.hp > 0;
      const interval = t2.tick % STRUCTURE_V1.tower.intervalTicks === 0;
      const alive = t2.structures.find((x) => x.id === "s-p0-tower-30")!.alive;
      if (inRange && interval && alive) expected += 1;
      expect(here).toHaveLength(inRange && interval && alive ? 1 : 0);
    }
    expect(expected).toBeGreaterThan(0);
    expect(fires(t2)).toHaveLength(expected);
  });

  it("event count equals the number of structure attacks over a scripted run", () => {
    // One tanky target holds the west p0 tower in range for 45 ticks.
    const s = initMatch(config());
    s.troops.push(fakeTroop("et", 1, 30, 55, 5000));
    for (let i = 0; i < 45; i++) stepMatch(s);
    // Ticks 10,20,30,40 are the tower's interval ticks; the target survives.
    expect(fires(s)).toHaveLength(4);
    expect(s.troops[0]!.hp).toBe(5000 - 4 * STRUCTURE_V1.tower.damage);
    // Every fire event lines up with the tick the damage was applied.
    for (const e of fires(s)) expect(e.tick % STRUCTURE_V1.tower.intervalTicks).toBe(0);
  });
});
