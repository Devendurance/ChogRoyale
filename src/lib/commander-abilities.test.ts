// B2.6b player-controlled commander abilities (combat ruleset v7).

import { describe, it, expect } from "vitest";
import {
  initMatch,
  stepMatch,
  runMatch,
  stateHash,
  commanderAbilityStatus,
  isAbilityCommand,
  ABILITY_ACTIVATION_COST_V1,
  COMBAT_RULESET_VERSION,
  type AbilityCommand,
  type CombatCommand,
  type CombatState,
  type DeployCommand,
  type PlayerIndex,
} from "@/lib/combat";
import type { CommanderClass } from "@/lib/commanders";
import { deckWith, scenarioConfig, riftSchedule, botMatch } from "@/lib/arena-scenarios";

const dep = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const ab = (seq: number, player: PlayerIndex, tick: number, abilityId: string, extra: Partial<AbilityCommand> = {}): AbilityCommand => ({ kind: "ability", seq, player, tick, abilityId, ...extra });
const ACTIVE: Record<CommanderClass, string> = {
  bulwark: "bulwark-aegis-wall",
  reaver: "reaver-frenzy-rush",
  deadeye: "deadeye-piercing-volley",
  scout: "scout-shadow-step",
  warden: "warden-null-field",
};
const CLASSES = Object.keys(ACTIVE) as CommanderClass[];
const fired = (s: CombatState, trigger: "active" | "deploy" | "onDeath" = "active") =>
  s.events.flatMap((e) => (e.type === "ability_fired" && e.trigger === trigger ? [e] : []));
const rejections = (s: CombatState) => s.events.flatMap((e) => (e.type === "command_rejected" ? [e.reason] : []));

/** p0 commander deployed at (30,60) on tick 1; p1 sends choglings down the same lane. */
function setup(cls: CommanderClass, p1 = ["choglings"]) {
  const s = initMatch(scenarioConfig(deckWith(`cmdr:free-${cls}`), deckWith(...p1)));
  const cmds: CombatCommand[] = [dep(1, 0, 1, `cmdr:free-${cls}`, 30, 60), ...p1.map((c, i) => dep(10 + i, 1, 2 + i * 30, c, 30, 100))];
  return { s, cmds };
}
function stepUntil(s: CombatState, cmds: CombatCommand[], pred: (s: CombatState) => boolean, max = 900): boolean {
  for (let i = 0; i < max && s.phase !== "final"; i++) {
    if (pred(s)) return true;
    stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
  }
  return pred(s);
}
const status = (s: CombatState, id: string, p: PlayerIndex = 0) => commanderAbilityStatus(s, p).find((a) => a.abilityId === id);
const canFire = (id: string) => (s: CombatState) => status(s, id)?.blockedBy === null;

describe("B2.6b ability command contract", () => {
  it("bumps the ruleset and exposes ready state on deploy without firing", () => {
    expect(COMBAT_RULESET_VERSION).toBe("v13");
    const { s, cmds } = setup("reaver");
    stepUntil(s, cmds, (x) => x.tick >= 2);
    const ready = s.events.filter((e) => e.type === "ability_ready");
    expect(ready).toEqual([{ type: "ability_ready", tick: 1, player: 0, commanderId: "free-reaver", abilityId: "reaver-frenzy-rush", cost: 1 }]);
    expect(status(s, "reaver-frenzy-rush")).toMatchObject({ ready: true, affordable: false, cost: 1, readyAt: 0, cooldownTicks: 200, blockedBy: "Insufficient energy" });
    expect(commanderAbilityStatus(s, 1)).toEqual([]);
  });

  it("B: ready abilities stay unused for a whole match until commanded", () => {
    for (const cls of CLASSES) {
      const { s, cmds } = setup(cls, ["choglings", "chaos_archer"]);
      stepUntil(s, cmds, () => false, 700);
      expect(fired(s)).toEqual([]);
      if (cls !== "reaver") expect(fired(s, "deploy").length).toBeGreaterThan(0);
    }
  });

  it("A: each class activates its own active ability on command with server-derived effects", () => {
    const results: Record<string, unknown> = {};
    for (const cls of CLASSES) {
      const id = ACTIVE[cls];
      const { s, cmds } = setup(cls, ["choglings", "chaos_archer"]);
      expect(stepUntil(s, cmds, canFire(id))).toBe(true);
      const c0 = s.commanders.find((c) => c.owner === 0)!;
      const enemiesIn = (r: number) => [...s.troops, ...s.commanders].filter((u) => u.owner === 1 && (u.x - c0.x) ** 2 + (u.y - c0.y) ** 2 <= r * r).length;
      const expectAffected = cls === "deadeye" ? enemiesIn(14) : cls === "warden" ? enemiesIn(8) + 1 : cls === "reaver" || cls === "scout" ? 2 : 1;
      const energy = s.energy[0];
      const t = s.tick + 1;
      stepMatch(s, [ab(77, 0, t, id)]);
      const ev = fired(s);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ abilityId: id, seq: 77, tick: t, player: 0, energySpent: ABILITY_ACTIVATION_COST_V1[id] });
      expect(ev[0]!.affected).toBe(expectAffected);
      const c = s.commanders.find((x) => x.owner === 0)!;
      if (cls === "bulwark") expect(c.shieldUntil).toBe(t + 40);
      if (cls === "reaver") expect([c.hastePct, c.buffPct, c.hasteUntil, c.buffUntil]).toEqual([30, 25, t + 50, t + 50]);
      if (cls === "scout") expect([c.hastePct, c.hasteUntil, c.activeSlowPct]).toEqual([50, t + 30, 0]);
      if (cls === "warden") {
        expect(c.shieldUntil).toBe(t + 40);
        expect([...s.troops].filter((u) => u.owner === 1 && u.slowUntil === t + 40 && u.activeSlowPct === 40).length).toBe(expectAffected - 1);
      }
      expect(s.energy[0]).toBeLessThanOrEqual(energy + 1 - ABILITY_ACTIVATION_COST_V1[id]!);
      expect(ev[0]!.readyAt).toBe(t + status(s, id)!.cooldownTicks);
      results[cls] = ev[0]!.affected;
    }
    expect(Object.keys(results)).toHaveLength(5);
  });
});

describe("validation, energy, cooldown", () => {
  it("C: invalid activations are rejected and change nothing", () => {
    const base = setup("reaver");
    const bad: AbilityCommand[] = [
      ab(50, 0, 1, "reaver-frenzy-rush"), // before the commander exists (deploy seq 1 runs first, energy 0)
      ab(51, 1, 3, "reaver-frenzy-rush"), // p1 has no commander
      ab(52, 0, 4, "reaver-bloodlust"), // onDeath trigger is not player-activated
      ab(53, 0, 5, "warden-null-field"), // not this commander's ability
      ab(54, 0, 6, "reaver-frenzy-rush", { x: 30, y: 70 }), // irrelevant target
      ab(1, 0, 7, "reaver-frenzy-rush"), // duplicate seq
      ab(55, 0, 8, "reaver-frenzy-rush"), // insufficient energy (0 after deploy)
    ];
    const a = initMatch(scenarioConfig(deckWith("cmdr:free-reaver"), deckWith("choglings")));
    for (let i = 0; i < 120; i++) {
      stepMatch(a, [...base.cmds, ...bad].filter((c) => c.tick === a.tick + 1));
      stepMatch(base.s, base.cmds.filter((c) => c.tick === base.s.tick + 1));
      expect(stateHash(a)).toBe(stateHash(base.s));
    }
    expect(rejections(a)).toEqual([
      "Insufficient energy",
      "No living commander for player",
      "Ability not player-activated: reaver-bloodlust",
      "Ability not on commander: warden-null-field",
      "Ability takes no target",
      "Duplicate command seq: 1",
      "Insufficient energy",
    ]);
    expect(a.events.filter((e) => e.type === "command_rejected" && e.abilityId !== undefined)).toHaveLength(7);
    expect(fired(a)).toEqual([]);
  });

  it("C: a stunned commander cannot activate, and terminal matches ignore commands", () => {
    const { s, cmds } = setup("scout");
    stepUntil(s, cmds, canFire("scout-shadow-step"));
    s.commanders[0]!.stunUntil = s.tick + 10;
    expect(status(s, "scout-shadow-step")!.blockedBy).toBe("Commander stunned");
    stepMatch(s, [ab(60, 0, s.tick + 1, "scout-shadow-step")]);
    expect(rejections(s)).toEqual(["Commander stunned"]);
    const done = runMatch(scenarioConfig(deckWith("cmdr:free-scout"), deckWith()), [dep(1, 0, 1, "cmdr:free-scout", 30, 60)]).state;
    const h = stateHash(done);
    const n = done.events.length;
    stepMatch(done, [ab(61, 0, done.tick + 1, "scout-shadow-step")]);
    expect([stateHash(done), done.events.length]).toEqual([h, n]);
  });

  it("D/E: cooldown blocks repeats, energy is deducted once, readiness and expiry are evented", () => {
    const { s, cmds } = setup("reaver");
    stepUntil(s, cmds, canFire("reaver-frenzy-rush"));
    const t = s.tick + 1;
    const e0 = s.energy[0];
    stepMatch(s, [ab(70, 0, t, "reaver-frenzy-rush"), ab(71, 0, t, "reaver-frenzy-rush")]);
    stepMatch(s, [ab(72, 0, t + 1, "reaver-frenzy-rush")]);
    expect(rejections(s)).toEqual(["Ability on cooldown: reaver-frenzy-rush", "Ability on cooldown: reaver-frenzy-rush"]);
    expect(fired(s)).toHaveLength(1);
    expect(s.energy[0]).toBeLessThanOrEqual(e0 + 1 - ABILITY_ACTIVATION_COST_V1["reaver-frenzy-rush"]!);
    expect(status(s, "reaver-frenzy-rush")).toMatchObject({ ready: false, readyAt: t + 200, activeUntil: t + 50 });
    stepUntil(s, [], (x) => x.tick >= t + 50);
    expect(s.events.find((e) => e.type === "ability_expired")).toMatchObject({ tick: t + 50, abilityId: "reaver-frenzy-rush", reason: "duration" });
  });

  it("D: the ability fires again only at readyAt, after its ready event", () => {
    // Lone reaver; a stun fixture pins it on its own side so it outlives the
    // 200-tick cooldown (bot commanders rarely survive a full cooldown).
    const s = initMatch(scenarioConfig(deckWith("cmdr:free-reaver"), deckWith()));
    const cmds = [dep(1, 0, 1, "cmdr:free-reaver", 30, 30)];
    stepUntil(s, cmds, canFire("reaver-frenzy-rush"));
    const t = s.tick + 1;
    stepMatch(s, [ab(70, 0, t, "reaver-frenzy-rush")]);
    s.commanders[0]!.stunUntil = t + 195;
    stepUntil(s, [], (x) => x.tick >= t + 198);
    stepMatch(s, [ab(71, 0, t + 199, "reaver-frenzy-rush")]);
    expect(rejections(s)).toEqual(["Ability on cooldown: reaver-frenzy-rush"]);
    expect(s.events.some((e) => e.type === "ability_ready" && e.tick > t)).toBe(false);
    stepMatch(s, [ab(72, 0, t + 200, "reaver-frenzy-rush")]);
    const tail = s.events.filter((e) => e.tick === t + 200 && (e.type === "ability_ready" || e.type === "ability_fired")).map((e) => e.type);
    expect(tail).toEqual(["ability_ready", "ability_fired"]);
    expect(fired(s).map((e) => e.tick)).toEqual([t, t + 200]);
  });

  it("F: targeted area abilities need an enemy inside their radius and hit only enemies", () => {
    for (const [cls, id] of [["deadeye", "deadeye-piercing-volley"], ["warden", "warden-null-field"]] as const) {
      const lone = initMatch(scenarioConfig(deckWith(`cmdr:free-${cls}`), deckWith()));
      stepUntil(lone, [dep(1, 0, 1, `cmdr:free-${cls}`, 30, 30)], (x) => x.commanders.length > 0 && x.energy[0] >= 3);
      expect(status(lone, id)!.blockedBy).toBe(`No enemies in range for ${id}`);
      stepMatch(lone, [ab(80, 0, lone.tick + 1, id)]);
      expect(rejections(lone)).toEqual([`No enemies in range for ${id}`]);
      expect(lone.energy[0]).toBeGreaterThanOrEqual(3);
    }
    // Aegis on a full-HP commander has nothing to shield (B2.3 condition kept).
    const full = initMatch(scenarioConfig(deckWith("cmdr:free-bulwark"), deckWith()));
    stepUntil(full, [dep(1, 0, 1, "cmdr:free-bulwark", 30, 30)], (x) => x.commanders.length > 0 && x.energy[0] >= 2);
    stepMatch(full, [ab(81, 0, full.tick + 1, "bulwark-aegis-wall")]);
    expect(rejections(full)).toEqual(["No effect to apply for bulwark-aegis-wall"]);
  });
});

describe("lifecycle and automatic triggers", () => {
  it("H: deploy and onDeath triggers still fire with no player command", () => {
    const deploys = CLASSES.map((cls) => {
      const { s, cmds } = setup(cls);
      stepUntil(s, cmds, (x) => x.tick >= 2);
      return fired(s, "deploy").map((e) => e.abilityId);
    });
    expect(deploys).toEqual([["bulwark-bedrock"], [], ["deadeye-overwatch"], ["scout-pathfinder"], ["warden-mend"]]);
    const { s, cmds } = setup("reaver", ["boulderback", "chaos_archer"]);
    stepUntil(s, cmds, (x) => x.events.some((e) => e.type === "death" && e.entityId === "c0-1"), 1200);
    expect(fired(s, "onDeath").map((e) => e.abilityId)).toEqual(["reaver-bloodlust"]);
    expect(fired(s)).toEqual([]);
  });

  it("G: death cancels open windows and blocks activation until a redeploy resets cooldowns", () => {
    const { s, cmds } = setup("reaver", ["boulderback", "chaos_archer"]);
    stepUntil(s, cmds, canFire("reaver-frenzy-rush"));
    stepMatch(s, [ab(90, 0, s.tick + 1, "reaver-frenzy-rush")]);
    stepUntil(s, cmds, (x) => x.commanders.length === 0 && x.events.some((e) => e.type === "death" && e.entityId === "c0-1"), 1200);
    const death = s.events.find((e) => e.type === "death" && e.entityId === "c0-1")!;
    const expiry = s.events.filter((e) => e.type === "ability_expired");
    expect(expiry.length).toBe(1);
    expect(expiry[0]!.tick <= death.tick).toBe(true);
    stepMatch(s, [ab(91, 0, s.tick + 1, "reaver-frenzy-rush")]);
    expect(rejections(s).at(-1)).toBe("No living commander for player");
    // Redeploy + fresh cooldowns in real cycling bot matches.
    const bot = botMatch(scenarioConfig(deckWith("chaos_archer", "cmdr:free-reaver"), deckWith("hexwing", "cmdr:free-warden"), riftSchedule("g-life"), "g-life"), 3100, 20);
    const alive: Record<number, boolean> = { 0: false, 1: false };
    let firedAfterRedeploy = 0;
    const deploys: Record<number, number> = { 0: 0, 1: 0 };
    for (const e of bot.state.events) {
      if (e.type === "commander_deployed") {
        alive[e.player] = true;
        deploys[e.player]! += 1;
      }
      if (e.type === "death" && /^c[01]-\d+$/.test(e.entityId)) alive[e.owner] = false;
      if (e.type === "ability_fired" && e.trigger === "active") {
        expect(alive[e.player]).toBe(true);
        if (deploys[e.player]! > 1) firedAfterRedeploy += 1;
      }
    }
    expect(Math.max(deploys[0]!, deploys[1]!)).toBeGreaterThan(1);
    expect(firedAfterRedeploy).toBeGreaterThan(0);
  });
});

describe("full matches and replay", () => {
  const cfg = () => scenarioConfig(deckWith("chaos_archer", "cmdr:free-reaver"), deckWith("hexwing", "cmdr:free-bulwark"), riftSchedule("ab-replay"), "ab-replay");
  const bot = botMatch(cfg(), 3100, 20);
  const abilityCmds = bot.commands.filter(isAbilityCommand);

  it("I/K: both bots activate abilities and the match completes with zero rejections", () => {
    expect(bot.state.winner).not.toBeNull();
    expect(rejections(bot.state)).toEqual([]);
    expect(new Set(abilityCmds.map((c) => c.player))).toEqual(new Set([0, 1]));
    expect(fired(bot.state)).toHaveLength(abilityCmds.length);
    expect(bot.state.events.some((e) => e.type === "pulse_active")).toBe(true);
  });

  it("L: replay through runMatch matches the stepped run with no extra activations", () => {
    const a = runMatch(cfg(), bot.commands);
    const b = runMatch(cfg(), [...bot.commands].reverse());
    expect(a.result.stateHash).toBe(stateHash(bot.state));
    expect(b.result.stateHash).toBe(a.result.stateHash);
    expect(JSON.stringify(a.state.events)).toBe(JSON.stringify(bot.state.events));
    expect(JSON.stringify(b.state.events)).toBe(JSON.stringify(a.state.events));
    expect(fired(a.state)).toHaveLength(abilityCmds.length);
    // Ability commands are causal: dropping one changes the trajectory.
    const first = abilityCmds[0]!;
    const without = runMatch(cfg(), bot.commands.filter((c) => c !== first));
    expect(without.state.events.some((e) => e.type === "ability_fired" && e.seq === first.seq)).toBe(false);
    expect(without.result.stateHash).not.toBe(a.result.stateHash);
  });
});
