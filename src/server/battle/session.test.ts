import { describe, expect, it } from "vitest";
import { APPROVED_DECKS, BattleSession, MAX_COMMANDS_PER_TICK, type SessionRandom } from "@/server/battle/session";
import { botAbility } from "@/lib/arena-scenarios";
import { smartMove } from "@/lib/smart-bot";
import type { PlayerIndex } from "@/lib/combat";

const SEED = "feedfacefeedfacefeedfacefeedface";
const rng = (seatFlip = 0): SessionRandom => ({ seed: () => SEED, int: (n) => (n === 2 ? seatFlip : 0) });
const A = { playerId: "pa", username: "alice" };
const B = { playerId: "pb", username: "bob" };

function started(seatFlip = 0, decks: [string, string] = ["swarm", "siege"]) {
  const s = new BattleSession(rng(seatFlip));
  s.join(A);
  s.join(B);
  expect(s.setReady("pa", decks[0])).toBe(false);
  expect(s.setReady("pb", decks[1])).toBe(true);
  return s;
}
const idOf = (s: BattleSession, seat: PlayerIndex) => (s.seatOf("pa") === seat ? "pa" : "pb");

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
    expect(() => s.setReady("pc", "not-a-deck")).toThrow(/Unknown deck/);
  });

  it("starts only when both are ready, with server-assigned seats and approved free-commander decks", () => {
    const s = started(1);
    expect(s.phase).toBe("active");
    expect(s.seatOf("pa")).toBe(1);
    expect(s.seatOf("pb")).toBe(0);
    expect(s.config!.decks[1]).toEqual(APPROVED_DECKS.swarm);
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
