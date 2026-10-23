// P2c stat scaling in the engine and session. Deterministic, no DB.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  initMatch,
  runMatch,
  stepMatch,
  impactSpecFor,
  CARDS_V1,
  type CombatCommand,
  type CombatConfig,
} from "@/lib/combat";
import { botMatch, scenarioConfig } from "@/lib/arena-scenarios";
import { stateHash } from "@/lib/combat";
import { BattleSession, type TrustedLoadout, type SessionRandom } from "@/server/battle/session";
import { makeLoadout, testLockedPatron } from "@/server/battle/test-helpers";
import type { CardLevels } from "@/lib/card-levels";

const rng: SessionRandom = { seed: () => "c0ffee00c0ffee00c0ffee00c0ffee00", int: () => 0 };
const ORD = ["choglings", "chaos_archer", "sparkcaster", "rift_sentry", "rift_snare", "chaos_bolt", "boulderback"];
const DECKS: [string[], string[]] = [[...ORD, "cmdr:free-scout"], [...ORD, "cmdr:free-scout"]];

function levels(p0: Record<string, number> = {}, p1: Record<string, number> = {}): CardLevels {
  return [{ ...p0 }, { ...p1 }];
}

function deploy(player: 0 | 1, cardId: string, tick: number, seq: number): CombatCommand {
  return { seq, player, tick, cardId, x: 50, y: player === 0 ? 60 : 100 };
}

function cfg(lv?: CardLevels): CombatConfig {
  const c = scenarioConfig(DECKS[0], DECKS[1]);
  if (lv) c.cardLevels = lv;
  return c;
}

describe("P2c engine scaling", () => {
  it("leaves Level 1 identical to the no-snapshot baseline", () => {
    const base = cfg();
    const cmds: CombatCommand[] = [deploy(0, "choglings", 1, 1), deploy(1, "choglings", 1, 2), deploy(0, "chaos_bolt", 30, 3)];
    const plain = runMatch(base, cmds).result.stateHash;
    expect(runMatch(cfg(levels({}, {})), cmds).result.stateHash).toBe(plain);
    // Empty and partial snapshots also resolve to baseline.
    expect(runMatch(cfg(levels({ choglings: 10 }, {})), [deploy(1, "choglings", 1, 1)]).result.stateHash).toBe(
      runMatch(base, [deploy(1, "choglings", 1, 1)]).result.stateHash
    );
  });

  it("scales spawned troop and building stats per seat, independently", () => {
    const run = (lv: CardLevels) => {
      const st = initMatch(cfg(lv));
      // Sentry away from the spawned troops (buildings reject occupied
      // footprints) and on its own late tick: P0 spends 2 energy on the
      // choglings and the sentry costs 4, so it needs regen ticks first.
      stepMatch(st, [deploy(0, "choglings", 1, 1), deploy(1, "choglings", 1, 2)]);
      for (let i = 0; i < 30; i += 1) stepMatch(st, []);
      stepMatch(st, [{ seq: 3, player: 0, tick: 32, cardId: "rift_sentry", x: 20, y: 60 }]);
      for (let i = 0; i < 3; i += 1) stepMatch(st, []);
      return st;
    };
    // maxHp is the frozen spawn snapshot; live hp moves with combat.
    const t0 = run(levels()).troops.find((t) => t.owner === 0)!;
    expect([t0.maxHp, t0.damage]).toEqual([60, 12]);
    // P0 choglings L10: damage 12 -> 15, HP pinned at 60. P1 stays base.
    const scaled = run(levels({ choglings: 10 }, {}));
    const s0 = scaled.troops.find((t) => t.owner === 0)!;
    const s1 = scaled.troops.find((t) => t.owner === 1)!;
    expect([s0.maxHp, s0.damage]).toEqual([60, 15]);
    expect([s1.maxHp, s1.damage]).toEqual([60, 12]);
    // Sentry turret role is damage: 16 -> L5 18 (16*1.12=17.92 rounds up).
    const sentry = run(levels({ rift_sentry: 5 }, {}));
    const b = sentry.buildings.find((x) => x.owner === 0)!;
    expect([b.hp, b.damage]).toEqual([320, 18]);
    // Energy costs never move.
    expect(CARDS_V1.choglings).toMatchObject({ cost: 2 });
  });

  it("scales spell impacts at resolve time and leaves radii pinned", () => {
    // Bolt resolves at cast time (no impact spec); comet lands here.
    const l10 = impactSpecFor("chaos_comet", 10);
    expect(l10.spec.unitDamage).toBe(178);
    expect(l10.spec.structureDamage).toBe(53);
    expect(l10.radius).toBe(6);
    const mortar = impactSpecFor("rift_mortar", 10);
    expect(mortar.spec.unitDamage).toBe(51);
    expect(mortar.spec.structureDamage).toBe(38);
    expect(mortar.radius).toBe(4);
  });

  it("keeps commanders at parity no matter what the snapshot claims", () => {
    // Commander card first in hand so it is deployable on tick 1.
    const d: [string[], string[]] = [
      ["cmdr:free-scout", "choglings", "chaos_archer", "sparkcaster", "rift_sentry", "rift_snare", "chaos_bolt", "boulderback"],
      ["cmdr:free-scout", "choglings", "chaos_archer", "sparkcaster", "rift_sentry", "rift_snare", "chaos_bolt", "boulderback"],
    ];
    const st = initMatch({ ...scenarioConfig(d[0], d[1]), cardLevels: levels({ "cmdr:free-scout": 10, choglings: 10 }, { "cmdr:free-scout": 10 }) });
    stepMatch(st, [
      { seq: 1, player: 0, tick: 1, cardId: "cmdr:free-scout", x: 50, y: 60 },
      { seq: 2, player: 1, tick: 1, cardId: "cmdr:free-scout", x: 50, y: 100 },
    ]);
    for (let i = 0; i < 3; i += 1) stepMatch(st, []);
    const [c0, c1] = [st.commanders.find((c) => c.owner === 0)!, st.commanders.find((c) => c.owner === 1)!];
    expect(c0.hp).toBe(c1.hp);
    expect(c0.damage).toBe(c1.damage);
  });

  it("replays old evidence without cardLevels exactly", () => {
    const file = path.join(process.cwd(), "src", "lib", "__fixtures__", "v15-golden.json");
    const { entries } = JSON.parse(readFileSync(file, "utf8")) as { entries: Array<{ config: CombatConfig; commands: CombatCommand[]; stateHash: string }> };
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries.slice(0, 4)) {
      expect(runMatch(e.config, e.commands).result.stateHash).toBe(e.stateHash);
    }
  });
});

describe("P2c level matchup comparison", () => {
  const ORD7 = ["choglings", "chaos_archer", "sparkcaster", "rift_sentry", "rift_snare", "chaos_bolt", "boulderback"];
  const full = (lv: number): Record<string, number> => Object.fromEntries(ORD7.map((c) => [c, lv]));
  const play = (l0: Record<string, number>, l1: Record<string, number>, swapSides = false) => {
    const config = { ...scenarioConfig([...ORD7, "cmdr:free-scout"], [...ORD7, "cmdr:free-scout"], null, "scalematch"), cardLevels: [l0, l1] as CardLevels };
    const m = botMatch(config, 2600, 20, swapSides ? { swapSides: true } : {});
    const replay = runMatch(config, m.commands);
    return { winner: m.state.winner, crowns: [...m.state.crowns] as [number, number], ticks: m.state.tick, replayOk: replay.result.stateHash === stateHash(m.state) };
  };

  it("resolves Levels 1, 5 and 10 deterministically with replay-identical hashes", () => {
    // Documented balance consequence on this fixed seed: same decks, same
    // bot, higher P0 levels win faster and more decisively.
    expect(play({}, {})).toMatchObject({ winner: 0, crowns: [2, 1], ticks: 2078, replayOk: true });
    expect(play(full(5), {})).toMatchObject({ winner: 0, crowns: [2, 1], ticks: 1800, replayOk: true });
    expect(play(full(10), {})).toMatchObject({ winner: 0, crowns: [3, 1], ticks: 1456, replayOk: true });
  });

  it("treats both seats symmetrically: swapped levels plus swapped lanes mirror the outcome", () => {
    const a = play(full(10), full(1));
    const b = play(full(1), full(10), true);
    expect([a.winner, b.winner]).toEqual([0, 1]);
    expect([a.crowns, b.crowns]).toEqual([[3, 1], [1, 3]]);
    expect(b.replayOk).toBe(true);
  });
});

describe("P2c session snapshot", () => {
  function mk(lv: Record<string, Record<string, number>>) {
    const s = new BattleSession(rng);
    s.join({ playerId: "pa", username: "a" });
    s.join({ playerId: "pb", username: "b" });
    s.setReady("pa", makeLoadout([...ORD], "scout"));
    s.setReady("pb", makeLoadout([...ORD], "scout"));
    s.cardLevelsByPlayer = JSON.parse(JSON.stringify(lv));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    return s;
  }

  function drive(s: BattleSession) {
    let n = 0;
    while (s.phase === "active" && n++ < 4000) {
      s.submit("pa", { type: "deploy", cid: `a${n}`, cardId: "choglings", x: 30, y: 60 });
      s.submit("pb", { type: "deploy", cid: `b${n}`, cardId: "choglings", x: 30, y: 100 });
      s.tick();
    }
  }

  it("freezes server levels at start and ignores later progression writes", () => {
    const sBase = mk({});
    drive(sBase);
    const sScaled = mk({ pa: { choglings: 10 } });
    drive(sScaled);
    expect(sScaled.replay!.replayHash).not.toBe(sBase.replay!.replayHash);
    expect(sScaled.replay!.config.cardLevels).toEqual([{ choglings: 10 }, {}]);
    // A mid-match progression write (mutating the source map and the room
    // field) cannot move the frozen snapshot: a late-arriving write produces
    // the identical replay to the pre-write run.
    const sFrozen = mk({ pa: { choglings: 10 } });
    sFrozen.cardLevelsByPlayer = { pa: { choglings: 1 }, pb: { choglings: 1 } };
    drive(sFrozen);
    expect(sFrozen.replay!.replayHash).toBe(sScaled.replay!.replayHash);
    expect(sFrozen.replay!.config.cardLevels).toEqual([{ choglings: 10 }, {}]);
  });
});
