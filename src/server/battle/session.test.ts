import { describe, expect, it } from "vitest";
import { BattleSession, MAX_COMMANDS_PER_TICK, PRESETS, deckFor, type SessionRandom, type TrustedLoadout } from "@/server/battle/session";
import { commanderCardId, type PlayerIndex } from "@/lib/combat";
import { botAbility } from "@/lib/arena-scenarios";
import { smartMove } from "@/lib/smart-bot";
import type { CommanderClass } from "@/lib/commanders";
import { freeGrant, makeLoadout, testLockedPatron } from "@/server/battle/test-helpers";

const SEED = "feedfacefeedfacefeedfacefeedface";
const rng = (seatFlip = 0): SessionRandom => ({ seed: () => SEED, int: (n) => (n === 2 ? seatFlip : 0) });
const A = { playerId: "pa", username: "alice" };
const B = { playerId: "pb", username: "bob" };

const presetLoadout = (name: string) => makeLoadout([...PRESETS[name]!.cards], PRESETS[name]!.commanderClass as CommanderClass);

function started(seatFlip = 0, decks: [string, string] = ["swarm", "siege"]) {
  const s = new BattleSession(rng(seatFlip));
  s.join(A);
  s.join(B);
  expect(s.setReady("pa", presetLoadout(decks[0]))).toBe(false);
  expect(s.setReady("pb", presetLoadout(decks[1]))).toBe(true);
  const epoch = s.lock();
  s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
  return s;
}
const idOf = (s: BattleSession, seat: PlayerIndex) => (s.seatOf("pa") === seat ? "pa" : "pb");

describe("B3.2a loadouts and locking", () => {
  it("presets derive 7 ordinary cards plus a free commander class from the field decks", () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.cards.length).toBe(7);
      expect(new Set(p.cards).size).toBe(7);
      expect(p.cards.every((c) => !c.startsWith("cmdr:"))).toBe(true);
      expect(["bulwark", "reaver", "deadeye", "scout", "warden"]).toContain(p.commanderClass);
    }
  });

  it("rejects duplicate, unknown, extra-commander and short decks at ready", () => {
    const s = new BattleSession(rng());
    s.join(A);
    s.join(B);
    const base = [...PRESETS.swarm!.cards];
    expect(() => s.setReady("pa", makeLoadout([...base.slice(0, 6), base[0]!]))).toThrow(/exactly 8|Duplicate/);
    expect(() => s.setReady("pa", makeLoadout([...base.slice(0, 6), "not_a_card"]))).toThrow(/not playable/i);
    expect(() => s.setReady("pa", { cards: [...base.slice(0, 6), commanderCardId("free-scout")], grant: freeGrant("scout") })).toThrow();
    expect(() => s.setReady("pa", makeLoadout(base.slice(0, 6)))).toThrow(/exactly 8/);
    // A commander card inside `cards` is never trusted as an ordinary card.
    expect(() => s.setReady("pa", makeLoadout([...base.slice(0, 6), "cmdr:free-warden"], "scout"))).toThrow();
  });

  it("rejects setReady/unready after lock and start with a stale epoch", () => {
    const s = new BattleSession(rng());
    s.join(A);
    s.join(B);
    s.setReady("pa", presetLoadout("swarm"));
    s.setReady("pb", presetLoadout("siege"));
    const epoch = s.lock();
    expect(() => s.setReady("pa", presetLoadout("swarm"))).toThrow(/locked/);
    expect(() => s.unready("pa")).toThrow(/locked/);
    expect(() => s.start(epoch + 1, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron())).toThrow(/stale/);
    s.clearReady(0);
    s.setReady("pa", presetLoadout("control"));
    const epoch2 = s.lock();
    s.start(epoch2, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    expect(s.phase).toBe("active");
  });

  it("clears lock and ready state when a player leaves while waiting", () => {
    const s = new BattleSession(rng());
    s.join(A);
    s.join(B);
    s.setReady("pa", presetLoadout("swarm"));
    const epoch = s.lock();
    s.leave("pa");
    expect(s.locked).toBe(false);
    expect(s.lockEpoch).toBe(epoch + 1);
    expect(() => s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron())).toThrow(/stale/);
  });

  it("seats two different player-built decks on the right seats", () => {
    const s = new BattleSession(rng(0));
    s.join(A);
    s.join(B);
    const a = makeLoadout(["choglings", "rift_runner", "chaos_archer", "sparkcaster", "boulderback", "hexwing", "frostshell"], "reaver");
    const b = makeLoadout(["chog_guardian", "rift_snare", "gale_netter", "chaos_comet", "decoy_totem", "rift_sentry", "frostshell"], "warden");
    s.setReady("pa", a);
    s.setReady("pb", b);
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    const seatA = s.seatOf("pa")!;
    expect(s.config!.decks[seatA]).toEqual([...a.cards, commanderCardId("free-reaver")]);
    expect(s.config!.decks[1 - seatA]).toEqual([...b.cards, commanderCardId("free-warden")]);
    expect(s.config!.commanders![seatA]!.commanderId).toBe("free-reaver");
    expect(s.config!.commanders![1 - seatA]!.commanderId).toBe("free-warden");
  });
});

describe("B3.1 battle session", () => {
  it("seats two distinct players, rejects extras and frees slots while waiting", () => {
    const s = new BattleSession(rng());
    expect(s.join(A)).toBe(0);
    expect(() => s.join(A)).toThrow(/already seated/);
    expect(s.join(B)).toBe(1);
    expect(() => s.join({ playerId: "pc", username: "c" })).toThrow(/full/);
    expect(s.seatOf("pa")).toBeNull();
    s.leave("pa");
    expect(s.slots[0]).toBeNull();
    expect(s.join({ playerId: "pc", username: "c" })).toBe(0);
    expect(() => s.setReady("pc", makeLoadout([...PRESETS.swarm!.cards.slice(0, 6), "bogus"]))).toThrow();
  });

  it("starts only when both are ready, with server-assigned seats and free commanders", () => {
    const s = started(1);
    expect(s.phase).toBe("active");
    expect(s.seatOf("pa")).toBe(1);
    expect(s.seatOf("pb")).toBe(0);
    expect(s.config!.decks[1]).toEqual(deckFor(presetLoadout("swarm")));
    expect(s.config!.commanders!.every((c) => c!.commanderId.startsWith("free-"))).toBe(true);
    expect(s.config!.chaos!.events.length).toBe(3);
    expect(() => s.join({ playerId: "pc", username: "c" })).toThrow(/already started/);
  });

  it("rejects malformed, inactive, duplicate and flooding intents before the engine", () => {
    const pre = new BattleSession(rng());
    pre.join(A);
    expect(pre.submit("pa", { type: "deploy", cid: "a", cardId: "choglings", x: 30, y: 40 })?.reason).toBe("Battle is not active");
    const s = started();
    expect(s.submit("pa", { type: "deploy", cid: "a", cardId: "choglings", x: 30, y: 40, player: 1 })?.reason).toBe("Malformed command");
    expect(s.submit("pa", { type: "deploy", cid: "b", cardId: "choglings", x: 30.5, y: 40 })?.reason).toBe("Malformed command");
    expect(s.submit("pa", { type: "ability", cid: "c", abilityId: "x", x: 3 })?.reason).toBe("Malformed command");
    expect(s.submit("pz", { type: "deploy", cid: "d", cardId: "choglings", x: 30, y: 40 })?.reason).toBe("Battle is not active");
    for (let i = 0; i < MAX_COMMANDS_PER_TICK; i++) expect(s.submit("pa", { type: "ability", cid: `ok${i}`, abilityId: "none" })).toBeNull();
    expect(s.submit("pa", { type: "ability", cid: "ok0", abilityId: "none" })?.reason).toBe("Duplicate command");
    expect(s.submit("pa", { type: "ability", cid: "flood", abilityId: "none" })?.reason).toBe("Too many commands this tick");
    const out = s.tick()!;
    const seat = s.seatOf("pa")!;
    expect(out.acks[seat].map((a) => a.ok)).toEqual([false, false]);
    expect(out.acks[seat][0]!.reason).toMatch(/commander|ability/i);
  });

  it("orders same-tick intents by alternating seat priority, never by network arrival seat", () => {
    const s = started();
    const firstSeats: number[] = [];
    for (let k = 0; k < 2; k++) {
      // Seat 1 always arrives first on the network.
      s.submit(idOf(s, 1), { type: "ability", cid: `p1-${k}`, abilityId: "none" });
      s.submit(idOf(s, 0), { type: "ability", cid: `p0-${k}`, abilityId: "none" });
      const before = s.commands.length;
      const tick = s.state!.tick + 1;
      s.tick();
      const issued = s.commands.slice(before);
      expect(issued.every((c) => c.tick === tick)).toBe(true);
      expect(issued[0]!.seq).toBeLessThan(issued[1]!.seq);
      firstSeats.push(issued[0]!.player);
      expect(issued[0]!.player).toBe(tick % 2 === 0 ? 0 : 1);
    }
    expect(new Set(firstSeats).size).toBe(2);
  });

  it("frames never carry the opponent hand, queue, energy or the server seed", () => {
    const s = started(0, ["swarm", "control"]);
    const out = s.tick()!;
    const start = s.startMessage(0);
    for (const seat of [0, 1] as const) {
      const f = out.frames[seat];
      expect(f.hand).toEqual(s.state!.hands[seat]);
      expect(Object.keys(f)).not.toContain("hands");
      expect(Object.keys(f)).not.toContain("queues");
      expect(JSON.stringify(f)).not.toContain(SEED);
      expect(f.energy).toBe(s.state!.energy[seat]);
    }
    expect(out.frames[0].hand).not.toEqual(out.frames[1].hand);
    expect(JSON.stringify(start)).not.toContain(SEED);
    expect(JSON.stringify(start)).not.toContain('"seed"');
    expect(start.deck).toEqual(s.config!.decks[0]);
    // Lobby hides the opponent's loadout entirely (players carry no deck info).
    const lobby = s.lobby(0);
    expect(JSON.stringify(lobby.players)).not.toMatch(/card|commander|deck/);
    expect(lobby.mine).not.toBeNull();
    expect(start.commander.kind).toBe("free");
    expect(start.catalog[start.commander.cardId]?.kind).toBe("commander");
  });

  it("plays a full match from network intents to a real result with an identical server replay", () => {
    const s = started(0, ["swarm", "antiSwarm"]);
    let end = null;
    let n = 0;
    let accepted = 0;
    let towerDamaged = false;
    const fired: string[] = [];
    while (!end && s.state!.tick < 3200) {
      for (const seat of [0, 1] as const) {
        const ab = botAbility(s.state!, seat);
        if (ab) s.submit(idOf(s, seat), { type: "ability", cid: `a${n++}`, abilityId: ab });
        else if (s.state!.tick % 20 === 0) {
          const mv = smartMove(s.state!, seat, n);
          if (mv) s.submit(idOf(s, seat), { type: "deploy", cid: `d${n++}`, ...mv });
        }
      }
      const out = s.tick()!;
      accepted += out.acks.flat().filter((a) => a.ok).length;
      for (const e of out.frames[0].events) if (e.type === "ability_fired" && e.trigger === "active") fired.push(String(e.abilityId));
      towerDamaged ||= out.frames[0].structures.some((x) => x.hp < x.maxHp);
      end = out.end;
    }
    expect(end).not.toBeNull();
    expect(s.phase).toBe("finished");
    expect(accepted).toBeGreaterThan(20);
    expect(fired.length).toBeGreaterThan(0);
    expect(towerDamaged).toBe(true);
    expect(s.replay!.replayIdentical).toBe(true);
    expect(s.replay!.commanders.length).toBe(2);
    expect(end![0].stateHash).toBe(end![1].stateHash);
    const results = [end![0].result, end![1].result].sort();
    expect(results).toEqual(end![0].result === "draw" ? ["draw", "draw"] : ["loss", "win"]);
    expect(s.tick()).toBeNull();
  }, 120_000);

  it("aborts on an active disconnect without inventing a winner", () => {
    const s = started();
    s.tick();
    s.leave("pb");
    expect(s.phase).toBe("aborted");
    expect(s.abortReason).toMatch(/No result recorded/);
    expect(s.replay).toBeNull();
    expect(s.tick()).toBeNull();
  });
});

describe("B2.8c authentic Arena Patrons", () => {
  const ready = (s: BattleSession) => {
    s.join(A);
    s.join(B);
    s.setReady("pa", presetLoadout("swarm"));
    s.setReady("pb", presetLoadout("siege"));
    return s.lock();
  };

  it("start rejects a tampered or synthetic LockedPatron", () => {
    const s = new BattleSession(rng());
    const epoch = ready(s);
    const loadouts = s.readyLoadouts() as [TrustedLoadout, TrustedLoadout];
    const tampered = testLockedPatron();
    tampered.config = { ...tampered.config, tier: "Mythic" };
    expect(() => s.start(epoch, loadouts, tampered)).toThrow();
    const synthetic = { ...testLockedPatron(), source: "synthetic" } as never;
    expect(() => s.start(epoch, loadouts, synthetic)).toThrow();
    const epoch2 = s.lock();
    s.start(epoch2, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    expect(s.phase).toBe("active");
    expect(s.config!.chaos!.patronTokenId).toBe("42");
    expect(s.startMessage(0).patron.tokenId).toBe("42");
  });

  it("mutating the caller's patron object after start does not change the live schedule", () => {
    const s = new BattleSession(rng());
    const epoch = ready(s);
    const patron = testLockedPatron();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], patron);
    const scheduleHash = s.config!.chaos!.scheduleHash;
    patron.tokenId = "999";
    patron.config.tier = "Mythic";
    expect(s.config!.chaos!.scheduleHash).toBe(scheduleHash);
    expect(s.patron!.tokenId).toBe("42");
  });
});

describe("tower_fired delivery", () => {
  it("reaches both seats identically once and never appears in a resume snapshot", () => {
    const s = new BattleSession(rng());
    s.join(A);
    s.join(B);
    const deck = ["rift_runner", "choglings", "hexwing", "chaos_archer", "frostshell", "sparkcaster", "boulderback"];
    s.setReady("pa", makeLoadout([...deck], "scout"));
    s.setReady("pb", makeLoadout([...deck], "scout"));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    // Rush both lanes so each side's towers acquire a target quickly.
    s.submit(idOf(s, 0), { type: "deploy", cid: "r0", cardId: "rift_runner", x: 30, y: 70 });
    s.submit(idOf(s, 1), { type: "deploy", cid: "r1", cardId: "rift_runner", x: 30, y: 90 });
    let total = 0;
    const seen = new Set<string>();
    const owners = new Set<number>();
    for (let i = 0; i < 90 && s.phase === "active"; i++) {
      const out = s.tick();
      if (!out) break;
      const e0 = out.frames[0].events.filter((e) => e.type === "tower_fired");
      const e1 = out.frames[1].events.filter((e) => e.type === "tower_fired");
      // Public event: both seats get the identical list.
      expect(e0).toEqual(e1);
      for (const e of e0) {
        total += 1;
        seen.add(`${e.structureId}:${e.tick}`);
        owners.add(Number(e.owner));
      }
    }
    expect(total).toBeGreaterThan(0);
    // Exactly once: no event repeats for a structure on a tick.
    expect(total).toBe(seen.size);
    // Resume sends a fresh snapshot with no replayed events.
    expect(s.frame(0).events.filter((e) => e.type === "tower_fired")).toHaveLength(0);
    expect(s.frame(1).events.filter((e) => e.type === "tower_fired")).toHaveLength(0);
  });
});
