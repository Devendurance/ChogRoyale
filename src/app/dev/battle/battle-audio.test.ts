import { describe, expect, it } from "vitest";
import type { BattleFrame } from "@/lib/battle-protocol";
import {
  BattleAudio,
  DEFAULT_BATTLE_AUDIO_PREFERENCES,
  cueForAck,
  cueForResult,
  cuesForBattleFrame,
  readBattleAudioPreferences,
  takeUnseenBattleAudioCues,
} from "./battle-audio";

const frame = (overrides: Partial<BattleFrame> = {}): BattleFrame => ({
  tick: 20,
  phase: "active",
  clockTicks: 20,
  crowns: [0, 0],
  energy: 4,
  energyProgress: 0,
  regenMult: 1,
  hand: [],
  next: null,
  abilities: [],
  troops: [],
  commanders: [],
  structures: [
    { id: "s0", owner: 0, kind: "core", x: 50, y: 20, hp: 900, maxHp: 1000, alive: true },
  ],
  buildings: [],
  projectiles: [],
  impacts: [],
  chaos: [],
  riftOpen: false,
  events: [],
  ...overrides,
});

describe("battle audio event projection", () => {
  it("maps authoritative combat and Chaos events without inventing outcomes", () => {
    const previous = frame({
      tick: 19,
      structures: [{ id: "s0", owner: 0, kind: "core", x: 50, y: 20, hp: 1000, maxHp: 1000, alive: true }],
    });
    const current = frame({
      events: [
        { type: "deploy", tick: 20, player: 0, cardId: "choglings", entityIds: ["u0"] },
        { type: "tower_fired", tick: 20, structureId: "s0", owner: 0, targetId: "u1", x: 50, y: 20 },
        { type: "spell_impact", tick: 20, player: 0, cardId: "chaos_comet", impactId: "i0", x: 50, y: 40, units: 1, buildings: 0, structures: 0 },
        { type: "pulse_warning", tick: 20, eventId: "p0", family: "ember_rift", activationTick: 50 },
        { type: "pulse_active", tick: 20, eventId: "p1", family: "frost_crossing" },
        { type: "pulse_expired", tick: 20, eventId: "p2", family: "energy_surge" },
        { type: "structure_destroyed", tick: 20, entityId: "s1", owner: 1 },
      ],
    });
    const cues = cuesForBattleFrame(current, previous);
    expect(cues.map((cue) => cue.cue)).toEqual([
      "deploy",
      "fire",
      "impact",
      "chaos-warning",
      "chaos-active",
      "chaos-expired",
      "destroy",
      "structure-hit",
    ]);
  });

  it("only reports rejected commands as rejection feedback", () => {
    expect(cueForAck({ cid: "c1", ok: false, reason: "illegal placement", tick: 12 }, "Choglings @20,20")?.cue).toBe("reject");
    expect(cueForAck({ cid: "c2", ok: true, reason: null, tick: 12 }, "Choglings @20,20")).toBeNull();
    expect(cueForAck({ cid: "c3", ok: true, reason: null, tick: 12 }, "ability scout-shadow-step")?.cue).toBe("ability");
  });

  it("deduplicates event identities across refreshed snapshots", () => {
    const seen = new Set<string>();
    const cues = [{ cue: "impact" as const, key: "spell_impact:20|impactId=\"i0\"" }];
    expect(takeUnseenBattleAudioCues(cues, seen)).toHaveLength(1);
    expect(takeUnseenBattleAudioCues(cues, seen)).toHaveLength(0);
  });

  it("does not double-play a queued impact event and its snapshot impact", () => {
    const current = frame({
      events: [{ type: "spell_impact", tick: 20, cardId: "chaos_comet", impactId: "i0", x: 50, y: 40, units: 1, buildings: 0, structures: 0 }],
      impacts: [{ id: "i0", owner: 0, cardId: "chaos_comet", x: 50, y: 40, impactTick: 20 }],
    });
    expect(cuesForBattleFrame(current, frame({ tick: 19 })).filter((cue) => cue.cue === "impact")).toHaveLength(1);
  });

  it("keeps result cues tied to the server result", () => {
    expect(cueForResult("win").cue).toBe("victory");
    expect(cueForResult("loss").cue).toBe("defeat");
    expect(cueForResult("draw").cue).toBe("draw");
  });
});

describe("battle audio preferences and safe browser behavior", () => {
  it("uses restrained defaults and clamps persisted volume", () => {
    const storage = {
      getItem: () => JSON.stringify({ muted: true, volume: 4 }),
    } as unknown as Storage;
    expect(readBattleAudioPreferences(storage)).toEqual({ muted: true, volume: 1 });
    expect(DEFAULT_BATTLE_AUDIO_PREFERENCES.volume).toBeGreaterThan(0);
  });

  it("does not throw when browser audio is unavailable", () => {
    const audio = new BattleAudio({ muted: false, volume: 0.5 });
    expect(audio.play("impact")).toBe(false);
    audio.dispose();
  });
});
