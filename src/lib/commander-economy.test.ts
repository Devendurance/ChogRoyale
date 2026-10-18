// B2.6a commander card economy + balance (combat ruleset v6).

import { describe, it, expect } from "vitest";
import {
  initMatch,
  stepMatch,
  runMatch,
  stateHash,
  freeStarterSlot,
  commanderCardId,
  runtimeAbilities,
  COMMANDER_COMBAT_PROFILE_V1,
  CARDS_V1,
  type CombatConfig,
  type CombatState,
  type DeployCommand,
  type PlayerIndex,
} from "@/lib/combat";
import { deriveCommander, CLASS_ROSTER, type CommanderClass } from "@/lib/commanders";
import { deckWith, scenarioConfig, riftSchedule, traceMatch } from "@/lib/arena-scenarios";
import { CLASSES, soloSiege, defended, supportedPush, cyclingMatch, deployGate, roundRobin } from "@/lib/commander-balance";

const cmd = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const rejections = (s: CombatState) => s.events.flatMap((e) => (e.type === "command_rejected" ? [{ seq: e.seq, reason: e.reason }] : []));

describe("deck contract", () => {
  it("requires exactly 7 ordinary cards + 1 commander matching the snapshot", () => {
    const ok = scenarioConfig(deckWith(), deckWith());
    expect(() => initMatch(ok)).not.toThrow();
    const seven = deckWith().filter((c) => !c.startsWith("cmdr:"));
    expect(seven).toHaveLength(7);
    expect(() => initMatch({ ...ok, decks: [[...seven, "hexwing"], deckWith()] })).toThrow(/7 ordinary cards and 1 commander/);
    expect(() => initMatch({ ...ok, decks: [[...seven, "cmdr:free-reaver"], deckWith()] })).toThrow(/does not match snapshot/);
    expect(() => initMatch({ ...ok, commanders: [null, ok.commanders![1]] })).toThrow(/trusted commander snapshot/);
    expect(() => initMatch({ ...ok, decks: [[...seven.slice(0, 6), "cmdr:free-bulwark", "cmdr:x"], deckWith()] })).toThrow();
  });
  it("rejects unauthorized snapshots and ignores client stats", () => {
    const base = scenarioConfig(deckWith(), deckWith());
    const slot = freeStarterSlot("bulwark");
    const injected = { ...slot, definition: { ...slot.definition, abilities: [...slot.definition.abilities, { ...slot.definition.abilities[0]!, id: "god-mode" }] } };
    expect(() => initMatch({ ...base, commanders: [injected, base.commanders![1]] })).toThrow(/class roster/);
    const wrongFree = { ...freeStarterSlot("reaver"), commanderId: "free-bulwark" };
    expect(() => initMatch({ ...base, commanders: [wrongFree, base.commanders![1]] })).toThrow(/Free starter id/);
    const inflated = { ...slot, definition: { ...slot.definition, stats: { ...slot.definition.stats, health: 999999, damage: 99999 } } };
    const s = initMatch({ ...base, decks: [deckWith("cmdr:free-bulwark"), deckWith()], commanders: [inflated, base.commanders![1]] });
    stepMatch(s, [cmd(1, 0, 1, "cmdr:free-bulwark", 30, 60)]);
    expect(s.commanders[0]!.maxHp).toBe(COMMANDER_COMBAT_PROFILE_V1.bulwark.hp);
    expect(s.commanders[0]!.damage).toBe(COMMANDER_COMBAT_PROFILE_V1.bulwark.damage);
  });
  it("deals the commander into the opening hand or queue by deck position", () => {
    const first = initMatch(scenarioConfig(deckWith("cmdr:free-scout"), deckWith()));
    expect(first.hands[0]).toContain("cmdr:free-scout");
    expect(first.hands[0]).toHaveLength(4);
    const last = initMatch(scenarioConfig(deckWith(), deckWith()));
    expect(last.hands[0]).not.toContain("cmdr:free-bulwark");
    expect(last.queues[0].at(-1)).toBe("cmdr:free-bulwark");
  });
});

describe("commander deployment", () => {
  it("never spawns a commander at tick 0 or without a command", () => {
    const { state } = runMatch(scenarioConfig(deckWith("cmdr:free-reaver"), deckWith("cmdr:free-warden")), [], 300);
    expect(state.commanders).toHaveLength(0);
    expect(state.events.some((e) => e.type === "commander_deployed")).toBe(false);
  });
  it("validates hand, energy, reference, territory, duplicates and terminal state", () => {
    const gate = deployGate("reaver");
    expect(gate.notInHand).toBe(true);
    expect(gate.afterSpendRejected).toEqual(["Insufficient energy"]);
    const s = initMatch(scenarioConfig(deckWith("cmdr:free-bulwark"), deckWith()));
    stepMatch(s, [
      cmd(1, 0, 1, "cmdr:free-reaver", 30, 60),
      cmd(2, 0, 1, "cmdr:free-bulwark", 30, 80),
      cmd(3, 0, 1, "cmdr:free-bulwark", 30, 100),
      cmd(4, 0, 1, "cmdr:free-bulwark", 30, 40),
      cmd(5, 0, 1, "cmdr:free-bulwark", 30, 60),
      cmd(5, 0, 1, "choglings", 30, 60),
    ]);
    expect(rejections(s)).toEqual([
      { seq: 1, reason: "Wrong commander reference" },
      { seq: 2, reason: "Deployment on river or bridge" },
      { seq: 3, reason: "Deployment outside own territory" },
      { seq: 4, reason: "Deployment on structure" },
      { seq: 5, reason: "Duplicate command seq: 5" },
    ]);
    expect(s.commanders).toHaveLength(1);
    expect(s.energy[0]).toBe(5 - COMMANDER_COMBAT_PROFILE_V1.bulwark.cost);
    const deployEv = s.events.filter((e) => e.type === "deploy" || e.type === "commander_deployed" || e.type === "ability_fired");
    expect(deployEv.map((e) => e.type)).toEqual(["deploy", "commander_deployed", "ability_fired"]);
    const done = runMatch(scenarioConfig(deckWith("cmdr:free-bulwark"), deckWith()), []).state;
    const hash = stateHash(done);
    stepMatch(done, [cmd(9, 0, done.tick + 1, "cmdr:free-bulwark", 30, 60)]);
    expect(stateHash(done)).toBe(hash);
  });
  it("keeps one living commander, holds its card while alive, and redeploys after death", () => {
    const s = initMatch(scenarioConfig(deckWith("cmdr:free-scout", "choglings", "chaos_archer", "rift_runner"), deckWith()));
    let seq = 0;
    const deployTicks: number[] = [];
    for (let i = 0; i < 1500 && s.phase !== "final"; i++) {
      const due: DeployCommand[] = [];
      const alive = s.commanders.some((c) => c.owner === 0);
      if (alive) expect(s.hands[0].some((c) => c.startsWith("cmdr:"))).toBe(false);
      if ((s.tick + 1) % 15 === 0) {
        const card = s.hands[0].find((c) => (c.startsWith("cmdr:") ? COMMANDER_COMBAT_PROFILE_V1.scout.cost : CARDS_V1[c]!.cost) <= s.energy[0]);
        if (card) due.push(cmd(++seq, 0, s.tick + 1, card, 30, 60));
      }
      const before = s.events.length;
      stepMatch(s, due);
      for (const e of s.events.slice(before)) if (e.type === "commander_deployed") deployTicks.push(e.tick);
      expect(s.commanders.filter((c) => c.owner === 0).length).toBeLessThanOrEqual(1);
    }
    expect(rejections(s)).toEqual([]);
    expect(deployTicks.length).toBeGreaterThanOrEqual(2);
    const deaths = s.events.filter((e) => e.type === "death" && e.entityId.startsWith("c0-")).map((e) => e.tick);
    expect(deaths[0]!).toBeLessThan(deployTicks[1]!);
    expect(s.events.some((e) => e.type === "deploy" && e.entityIds.includes("c0-2"))).toBe(true);
  });
});

describe("free vs NFT fairness and tier neutrality", () => {
  const deployOne = (slotDef: CombatConfig["commanders"]) => {
    const card = commanderCardId(slotDef![0]!.commanderId);
    const s = initMatch(scenarioConfig(deckWith(card), deckWith(), null, "fair", slotDef));
    stepMatch(s, [cmd(1, 0, 1, card, 30, 60)]);
    const c = s.commanders[0]!;
    return { hp: c.maxHp, damage: c.damage, range: c.range, speed: c.speed, armor: c.armor, interval: c.interval, sight: c.sight, hitsAir: c.hitsAir, abilities: c.abilities };
  };
  it("NFT-derived commanders equal free starters of the same class at every tier", () => {
    const tiers = ["Common", "Rare", "Legendary"];
    const nftClasses = new Set<CommanderClass>();
    for (const tier of tiers) {
      const def = deriveCommander({ attributes: [{ trait_type: "Eyes", value: "Visor" }, { trait_type: "Tier", value: tier }] });
      nftClasses.add(def.class);
      const nft = deployOne([{ commanderId: "nft-1462", definition: def }, freeStarterSlot("bulwark")]);
      const free = deployOne([freeStarterSlot(def.class), freeStarterSlot("bulwark")]);
      expect(nft).toEqual(free);
      expect(def.prestige).toBe(tier);
    }
    expect(nftClasses.size).toBe(1);
  });
  it("every class keeps its B1 identity and all ten abilities with runtime magnitudes", () => {
    const ids = new Set<string>();
    for (const cls of CLASSES) {
      const rt = runtimeAbilities(cls);
      expect(rt.map((a) => [a.id, a.trigger, a.cooldownMs])).toEqual(CLASS_ROSTER[cls].abilities.map((a) => [a.id, a.trigger, a.cooldownMs]));
      for (const a of rt) ids.add(a.id);
    }
    expect(ids.size).toBe(10);
    const p = COMMANDER_COMBAT_PROFILE_V1;
    expect(p.bulwark.hp).toBe(Math.max(...CLASSES.map((c) => p[c].hp)));
    expect(p.scout.speed).toBe(Math.max(...CLASSES.map((c) => p[c].speed)));
    expect(p.deadeye.range).toBe(Math.max(...CLASSES.map((c) => p[c].range)));
    expect(CLASSES.filter((c) => p[c].hitsAir)).toEqual(["deadeye"]);
    // B1 roles: reaver = highest melee DPS, scout = fastest cadence, warden = lowest raw DPS.
    const melee = CLASSES.filter((c) => p[c].range <= 3);
    expect(p.reaver.damage / p.reaver.intervalTicks).toBe(Math.max(...melee.map((c) => p[c].damage / p[c].intervalTicks)));
    expect(p.scout.intervalTicks).toBe(Math.min(...CLASSES.map((c) => p[c].intervalTicks)));
    expect(p.warden.damage / p.warden.intervalTicks).toBeLessThan(p.reaver.damage / p.reaver.intervalTicks);
  });
});

describe("balance evidence", () => {
  it("A: no unanswered commander destroys an intact tower, let alone the Core", () => {
    for (const cls of CLASSES) {
      const r = soloSiege(cls);
      expect(r.destroyed).toEqual([]);
      expect(r.towerL).toBeGreaterThan(100);
      expect(r.towerL).toBeLessThan(600);
      expect(r.core).toBe(1000);
      expect(r.died).not.toBeNull();
    }
  });
  it("C: ordinary troop counters (2-5 energy) kill every class", () => {
    for (const cls of CLASSES) {
      const answers = [["chog_guardian"], ["chaos_archer"], ["choglings"], ["hexwing"], ["boulderback"]].map((d) => defended(cls, d));
      for (const r of answers) expect(r.rejected).toBe(0);
      expect(answers.every((r) => r.commanderKilled)).toBe(true);
      expect(answers.some((r) => r.defenseCost <= 4 && r.defenderLosses === 0)).toBe(true);
    }
  });
  it("D: tank-supported commander pushes outperform unsupported ones", () => {
    for (const cls of CLASSES) {
      const r = supportedPush(cls);
      expect(r.alone.destroyed).toEqual([]);
      expect(r.supported.destroyed).toContain("s-p1-tower-30");
    }
  });
  it("E: classes have distinct strengths in real encounters", () => {
    const siege = Object.fromEntries(CLASSES.map((c) => [c, soloSiege(c)]));
    const lifetime = (c: CommanderClass) => siege[c]!.lifetime!;
    expect(lifetime("bulwark")).toBe(Math.max(...CLASSES.map(lifetime)));
    expect(lifetime("deadeye")).toBeLessThan(lifetime("warden"));
    const vsAir = Object.fromEntries(CLASSES.map((c) => [c, defended(c, ["hexwing"])]));
    expect(vsAir.deadeye!.defenderLosses).toBe(1);
    for (const c of CLASSES.filter((x) => x !== "deadeye")) expect(vsAir[c]!.defenderLosses).toBe(0);
  });
  it("E: no universally dominant or dominated class in a bot round robin", () => {
    // Synthetic bots, 32 games per class: a sanity bound, not a balance claim.
    const rr = roundRobin(["rr-1", "rr-2", "rr-3", "rr-4"]);
    for (const c of CLASSES) {
      expect(rr.games[c]).toBe(32);
      expect(rr.wins[c] / rr.games[c]).toBeGreaterThanOrEqual(0.25);
      expect(rr.wins[c] / rr.games[c]).toBeLessThanOrEqual(0.75);
    }
  }, 240_000);
  it("G/H: both players cycle real decks with commanders and Chaos, replaying identically", () => {
    const r = cyclingMatch("warden", "reaver", "cycle-test");
    expect(r.rejected).toBe(0);
    expect(r.commanderDeploys.some((d) => d.startsWith("p0@"))).toBe(true);
    expect(r.commanderDeploys.some((d) => d.startsWith("p1@"))).toBe(true);
    expect(r.pulses).toBeGreaterThan(0);
    expect(r.result.winner).not.toBeNull();
    expect(r.replayIdentical).toBe(true);
    expect(r.steppedHash).toBe(r.result.stateHash);
  });
  it("mirrored commander deployments produce mirrored traces", () => {
    const p0 = traceMatch(scenarioConfig(deckWith("cmdr:free-warden"), deckWith()), [cmd(1, 0, 2, "cmdr:free-warden", 30, 60)], 200);
    const p1 = traceMatch(scenarioConfig(deckWith(), deckWith("cmdr:free-warden")), [cmd(1, 1, 2, "cmdr:free-warden", 30, 100)], 200);
    const a = p0.samples.filter((s) => s.cardId === "commander:warden");
    const b = p1.samples.filter((s) => s.cardId === "commander:warden");
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect([b[i]!.x, b[i]!.y]).toEqual([a[i]!.x, 160 - a[i]!.y]);
  });
});

describe("class ability regressions", () => {
  it("deploy, active and on-death abilities execute with runtime magnitudes", () => {
    const fired = (cls: CommanderClass, defense: string[]) => {
      const cfg = scenarioConfig(deckWith(`cmdr:free-${cls}`), deckWith(...defense), riftSchedule(`ab-${cls}`), `ab-${cls}`);
      const cmds = [cmd(1, 0, 2, `cmdr:free-${cls}`, 30, 60), ...defense.map((c, i) => cmd(10 + i, 1, 20 + i * 20, c, 30, 100))];
      const { state } = runMatch(cfg, cmds, 600);
      return { ids: new Set(state.events.flatMap((e) => (e.type === "ability_fired" ? [e.abilityId] : []))), state };
    };
    const bul = fired("bulwark", ["chaos_archer"]);
    expect([...bul.ids].sort()).toEqual(["bulwark-aegis-wall", "bulwark-bedrock"]);
    expect(fired("reaver", ["chog_guardian"]).ids).toEqual(new Set(["reaver-frenzy-rush", "reaver-bloodlust"]));
    expect(fired("deadeye", ["choglings"]).ids).toEqual(new Set(["deadeye-overwatch", "deadeye-piercing-volley"]));
    expect(fired("scout", ["choglings"]).ids).toEqual(new Set(["scout-pathfinder", "scout-shadow-step"]));
    expect(fired("warden", ["choglings"]).ids).toEqual(new Set(["warden-mend", "warden-null-field"]));
  });
  it("aegis shield uses the runtime magnitude, never the B1 value", () => {
    const s = initMatch(scenarioConfig(deckWith("cmdr:free-bulwark"), deckWith("chaos_archer")));
    let maxShield = 0;
    const cmds = [cmd(1, 0, 1, "cmdr:free-bulwark", 30, 60), cmd(2, 1, 10, "chaos_archer", 30, 100)];
    for (let i = 0; i < 400 && s.phase !== "final"; i++) {
      stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
      for (const c of s.commanders) maxShield = Math.max(maxShield, c.shieldHp);
    }
    expect(maxShield).toBe(100);
  });
});
