import { afterEach, describe, expect, it, vi } from "vitest";
import type { BattleFrame } from "@/lib/battle-protocol";
import {
  BattleAudio,
  BATTLE_AUDIO_VOICE_LIMIT,
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

const mockGain = () => ({ gain: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn().mockReturnThis(), disconnect: vi.fn() });
const mockOscillator = () => ({ type: "sine", frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn().mockReturnThis(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null });

class MockContext {
  state = "suspended";
  currentTime = 1;
  sampleRate = 44100;
  destination = {};
  onstatechange: (() => void) | null = null;
  sources: ReturnType<typeof mockOscillator>[] = [];
  gains: ReturnType<typeof mockGain>[] = [];
  resume = vi.fn(async () => { this.state = "running"; this.onstatechange?.(); });
  close = vi.fn(async () => { this.state = "closed"; });
  createGain() {
    const node = mockGain();
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = mockOscillator();
    this.sources.push(node);
    return node;
  }
  createBufferSource() {
    const node = { buffer: null as unknown, connect: vi.fn().mockReturnThis(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
    this.sources.push(node as unknown as ReturnType<typeof mockOscillator>);
    return node;
  }
  createBuffer(_channels: number, size: number) { return { getChannelData: () => new Float32Array(size) }; }
  createBiquadFilter() { return { type: "lowpass", frequency: { value: 0 }, connect: vi.fn().mockReturnThis(), disconnect: vi.fn() }; }
  createDynamicsCompressor() { return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect: vi.fn().mockReturnThis() }; }
}

describe("battle audio browser lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());
  const setup = () => {
    const context = new MockContext();
    vi.stubGlobal("window", { AudioContext: function () { return context; } });
    return { context, audio: new BattleAudio({ muted: false, volume: 0.55 }) };
  };

  it("reports readiness from the running context, resumes inside gesture and warms WebKit", async () => {
    const { context, audio } = setup();
    const changed = vi.fn();
    const unsubscribe = audio.subscribe(changed);
    expect(audio.getReady()).toBe(false);
    expect(await audio.unlock()).toBe(true);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.sources[0].start).toHaveBeenCalledOnce();
    expect(audio.getReady()).toBe(true);
    context.state = "interrupted";
    context.onstatechange?.();
    expect(audio.getReady()).toBe(false);
    expect(await audio.unlock()).toBe(true);
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalled();
    unsubscribe();
    audio.dispose();
  });

  it("enables persisted mute before unlocking, and never creates a context while muted", async () => {
    const { context, audio } = setup();
    audio.setPreferences({ muted: true, volume: 0.6 });
    expect(await audio.unlock()).toBe(false);
    expect(context.sources).toHaveLength(0);
    audio.setPreferences({ muted: false, volume: 0.6 });
    expect(await audio.unlock()).toBe(true);
    expect(audio.play("impact")).toBe(true);
    audio.setPreferences({ muted: true, volume: 0.6 });
    expect(audio.getReady()).toBe(false);
    expect(audio.play("impact")).toBe(false);
    expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, 0.015);
    expect(context.sources.slice(1).every((source) => source.stop.mock.calls.length >= 1)).toBe(true);
    audio.dispose();
  });

  it("drops locked cues rather than replaying a stale burst after resume", async () => {
    const { context, audio } = setup();
    let resolve!: () => void;
    context.resume.mockImplementation(() => new Promise<void>((done) => { resolve = () => { context.state = "running"; done(); }; }));
    const pending = audio.unlock();
    expect(audio.play("destroy")).toBe(false);
    resolve();
    await pending;
    expect(context.sources).toHaveLength(1);
    audio.dispose();
  });

  it("plays a crown chime through the existing unlocked context and respects mute", async () => {
    const { context, audio } = setup();
    expect(audio.play("crown-earned")).toBe(false);
    await audio.unlock();
    const before = context.sources.length;
    expect(audio.play("crown-earned")).toBe(true);
    expect(context.sources.length - before).toBe(3);
    expect(audio.play("crown-earned")).toBe(false);
    audio.setPreferences({ muted: true, volume: .55 });
    expect(audio.play("crown-earned")).toBe(false);
    audio.dispose();
  });

  it("keeps failed or disposed unlock attempts unavailable", async () => {
    const { context, audio } = setup();
    context.resume.mockRejectedValueOnce(new Error("gesture rejected"));
    expect(await audio.unlock()).toBe(false);
    expect(audio.getReady()).toBe(false);
    let resolve!: () => void;
    context.resume.mockImplementation(() => new Promise<void>((done) => { resolve = () => { context.state = "running"; done(); }; }));
    const pending = audio.unlock();
    audio.dispose();
    resolve();
    expect(await pending).toBe(false);
    expect(audio.play("victory")).toBe(false);
  });

  it("bounds complete layered cues and clears voices on hide, mute and disposal", async () => {
    const { context, audio } = setup();
    await audio.unlock();
    expect(audio.play("impact")).toBe(true);
    expect(audio.play("impact")).toBe(false);
    for (let i = 0; i < 30; i++) { context.currentTime += 1; audio.play("destroy"); }
    expect(context.sources.length - 1).toBeLessThanOrEqual(BATTLE_AUDIO_VOICE_LIMIT);
    audio.setPageHidden(true);
    expect(audio.getReady()).toBe(false);
    expect(audio.play("select")).toBe(false);
    audio.setPageHidden(false);
    expect(audio.play("select")).toBe(true);
    audio.setPreferences({ muted: false, volume: 0 });
    expect(audio.play("select")).toBe(false);
    audio.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    expect(audio.getReady()).toBe(false);
  });

  it("bounds the snapshot identity memory", () => {
    const seen = new Set<string>();
    takeUnseenBattleAudioCues(Array.from({ length: 3000 }, (_, i) => ({ cue: "impact", key: String(i) })), seen);
    expect(seen.size).toBe(2048);
    expect(seen.has("2999")).toBe(true);
  });

  it("does not close the app context when a shared battle output is disposed", async () => {
    const { context } = setup();
    const bus = context.createGain();
    const listeners = new Set<() => void>();
    const shared = {
      kind: "shared" as const,
      getContext: () => context as unknown as AudioContext,
      getGain: () => bus as unknown as GainNode,
      getReady: () => true,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      unlock: vi.fn(async () => { context.state = "running"; return true; }),
      duck: vi.fn(),
    };
    const audio = new BattleAudio({ muted: false, volume: 1 }, shared);
    expect(await audio.unlock()).toBe(true);
    audio.dispose();
    expect(context.close).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it("plays immediately from a ready shared output and follows context replacement", () => {
    const first = new MockContext();
    first.state = "running";
    first.currentTime = 100;
    const second = new MockContext();
    second.state = "running";
    second.currentTime = 0;
    let current = first;
    let currentBus = first.createGain();
    const listeners = new Set<() => void>();
    const duck = vi.fn();
    const shared = {
      kind: "shared" as const,
      getContext: () => current as unknown as AudioContext,
      getGain: () => currentBus as unknown as GainNode,
      getReady: () => true,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      unlock: vi.fn(async () => true),
      duck,
    };
    const audio = new BattleAudio({ muted: false, volume: 1 }, shared);
    const changed = vi.fn();
    const unsubscribe = audio.subscribe(changed);
    expect(audio.play("ability")).toBe(true);
    expect(first.sources.length).toBeGreaterThan(0);
    expect(duck).toHaveBeenCalled();
    current = second;
    currentBus = second.createGain();
    expect(audio.play("ability")).toBe(true);
    expect(second.sources.length).toBeGreaterThan(0);
    audio.dispose();
    expect(listeners.size).toBe(1);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
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
