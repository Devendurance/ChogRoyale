import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APP_AUDIO_PREFERENCES,
  getAppAudio,
  readAppAudioPreferences,
  resetAppAudioForTests,
} from "./audio-core";

const gain = () => ({
  gain: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  connect: vi.fn().mockReturnThis(),
  disconnect: vi.fn(),
});

const source = () => ({
  connect: vi.fn().mockReturnThis(),
  disconnect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  onended: null as (() => void) | null,
  frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  type: "sine",
});

class MockAudioContext {
  state = "suspended";
  currentTime = 1;
  sampleRate = 44100;
  destination = {};
  sources: ReturnType<typeof source>[] = [];
  gains: ReturnType<typeof gain>[] = [];
  onstatechange: (() => void) | null = null;
  close = vi.fn(async () => { this.state = "closed"; });
  resume = vi.fn(async () => { this.state = "running"; this.onstatechange?.(); });
  createGain() { const value = gain(); this.gains.push(value); return value; }
  createDynamicsCompressor() { return { ...gain(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }; }
  createBufferSource() { const value = source(); this.sources.push(value); return value; }
  createOscillator() { const value = source(); this.sources.push(value); return value; }
  createBuffer(_channels: number, size: number) { return { getChannelData: () => new Float32Array(size) }; }
}

describe("persistent app audio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetAppAudioForTests();
  });

  it("migrates explicit legacy mute and zero volume into global silence", () => {
    const muted = { getItem: () => JSON.stringify({ muted: true, volume: 0.45 }) } as unknown as Storage;
    expect(readAppAudioPreferences(muted)).toMatchObject({ masterMuted: true, battleMuted: true, battleVolume: 0.45 });
    const zero = { getItem: () => JSON.stringify({ muted: false, volume: 0 }) } as unknown as Storage;
    expect(readAppAudioPreferences(zero)).toMatchObject({ masterMuted: true, battleMuted: false, battleVolume: 0 });
  });

  it("keeps storage failures safe and preserves positive defaults", () => {
    const storage = { getItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(readAppAudioPreferences(storage)).toEqual(DEFAULT_APP_AUDIO_PREFERENCES);
    expect(readAppAudioPreferences(null)).toEqual(DEFAULT_APP_AUDIO_PREFERENCES);
  });

  it("uses one context, exposes a battle bus, and silences on hidden pages", async () => {
    const context = new MockAudioContext();
    vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
    const audio = getAppAudio();
    const release = audio.mount();
    expect(audio.getSnapshot().needsUnlock).toBe(true);
    expect(await audio.unlock()).toBe(true);
    expect(audio.getSnapshot().ready).toBe(true);
    expect(audio.playUi("primary")).toBe(true);
    expect(audio.getBattleOutput().getContext()).toBe(context);
    expect(audio.getBattleOutput().getGain()).not.toBeNull();
    audio.setPageHidden(true);
    expect(audio.getSnapshot().ready).toBe(false);
    expect(audio.getBattleOutput().getReady()).toBe(false);
    release();
    // Releasing the provider silences the reusable store without closing the
    // context, so a StrictMode remount can use the same unlocked object.
    expect(context.close).not.toHaveBeenCalled();
  });

  it("resumes a previously running context once when a visible tab returns", async () => {
    const context = new MockAudioContext();
    vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setPageHidden(false);
    await audio.unlock();
    expect(context.resume).toHaveBeenCalledOnce();
    audio.setPageHidden(true);
    context.state = "suspended";
    audio.setPageHidden(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(audio.getSnapshot().ready).toBe(true);
    audio.setPageHidden(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.resume).toHaveBeenCalledTimes(2);
    release();
  });

  it("does not keep retrying an autoplay block on visibility changes", async () => {
    const context = new MockAudioContext();
    context.resume = vi.fn(async () => { throw new Error("blocked"); });
    vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setPageHidden(false);
    expect(await audio.attemptAutoplay()).toBe(false);
    audio.setPageHidden(true);
    audio.setPageHidden(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.resume).toHaveBeenCalledOnce();
    release();
  });

  it("replaces an unresolved autoplay resume from a real gesture", async () => {
    const first = new MockAudioContext();
    first.resume = vi.fn(() => new Promise<void>(() => {}));
    const second = new MockAudioContext();
    const contexts = [first, second];
    vi.stubGlobal("window", {
      AudioContext: function () { return contexts.shift()!; },
      localStorage: { getItem: () => null, setItem: vi.fn() },
    });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setPageHidden(false);
    void audio.attemptAutoplay();
    await Promise.resolve();
    expect(first.resume).toHaveBeenCalledOnce();
    expect(audio.getSnapshot().needsUnlock).toBe(true);
    expect(await audio.unlock({ fromGesture: true })).toBe(true);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.resume).toHaveBeenCalledOnce();
    expect(audio.getSnapshot().ready).toBe(true);
    release();
  });

  it("does not replace the same gesture resume when multiple handlers share one event", async () => {
    const autoplayContext = new MockAudioContext();
    autoplayContext.resume = vi.fn(() => new Promise<void>(() => {}));
    const gestureContext = new MockAudioContext();
    gestureContext.resume = vi.fn(() => new Promise<void>(() => {}));
    const contexts = [autoplayContext, gestureContext];
    vi.stubGlobal("window", {
      AudioContext: function () { return contexts.shift()!; },
      localStorage: { getItem: () => null, setItem: vi.fn() },
    });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setPageHidden(false);
    void audio.attemptAutoplay();
    await Promise.resolve();
    void audio.unlock({ fromGesture: true });
    void audio.unlock({ fromGesture: true });
    expect(autoplayContext.close).toHaveBeenCalledOnce();
    expect(gestureContext.resume).toHaveBeenCalledOnce();
    release();
  });

  it("cancels StrictMode teardown when the provider remounts", async () => {
    const context = new MockAudioContext();
    vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
    const audio = getAppAudio();
    const firstRelease = audio.mount();
    firstRelease();
    const secondRelease = audio.mount();
    audio.setPageHidden(false);
    await audio.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.close).not.toHaveBeenCalled();
    secondRelease();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("allows one fresh autoplay attempt after a genuine provider lifetime", async () => {
    const contexts: MockAudioContext[] = [];
    vi.stubGlobal("window", {
      AudioContext: function () { const context = new MockAudioContext(); contexts.push(context); return context; },
      localStorage: { getItem: () => null, setItem: vi.fn() },
    });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setBattleRouteActive(true);
    audio.setPageHidden(false);
    expect(await audio.attemptAutoplay()).toBe(true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(contexts).toHaveLength(1);
    const reentryRelease = audio.mount();
    audio.setPageHidden(false);
    expect(await audio.attemptAutoplay()).toBe(true);
    expect(contexts).toHaveLength(2);
    reentryRelease();
  });

  it("crossfades lobby A to development battle B and keeps B through result", async () => {
    const context = new MockAudioContext();
    (context as unknown as { decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer> }).decodeAudioData = vi.fn(async () => ({ duration: 10 } as unknown as AudioBuffer));
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setBattleRouteActive(true);
    audio.setPageHidden(false);
    await audio.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledWith("/assets/audio/v001/music/spooky-halloween.mp3", { cache: "force-cache" });
    audio.setBattlePhase("active");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledWith("/api/dev-audio/battle", { cache: "force-cache" });
    const callsBeforeResult = fetchMock.mock.calls.length;
    audio.setBattlePhase("result");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.length).toBe(callsBeforeResult);
    audio.setBattlePhase("lobby");
    release();
  });

  it("keeps unavailable production battle music silent through result", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const context = new MockAudioContext();
    (context as unknown as { decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer> }).decodeAudioData = vi.fn(async () => ({ duration: 10 } as unknown as AudioBuffer));
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setBattleRouteActive(true);
    audio.setPageHidden(false);
    await audio.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const musicStarts = () => context.sources.filter((item) => (item as unknown as { loop?: boolean }).loop === true && item.start.mock.calls.length > 0);
    expect(musicStarts()).toHaveLength(1);
    audio.setBattlePhase("active");
    await new Promise((resolve) => setTimeout(resolve, 0));
    audio.setBattlePhase("result");
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(musicStarts()).toHaveLength(1);
    const calledPaths = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(calledPaths.some(([path]) => path === "/api/dev-audio/battle")).toBe(false);
    audio.setBattlePhase("lobby");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(musicStarts()).toHaveLength(2);
    release();
  });

  it("keeps idle music audible and ducks result music below active music", async () => {
    const context = new MockAudioContext();
    (context as unknown as { decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer> }).decodeAudioData = vi.fn(async () => ({ duration: 10 } as unknown as AudioBuffer));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setBattleRouteActive(true);
    audio.setPageHidden(false);
    await audio.unlock();
    const musicGain = context.gains[1];
    const idleCalls = musicGain.gain.setTargetAtTime.mock.calls;
    expect(idleCalls[idleCalls.length - 1][0]).toBeGreaterThan(0);
    audio.setBattlePhase("active");
    const activeCalls = musicGain.gain.setTargetAtTime.mock.calls;
    const activeValue = activeCalls[activeCalls.length - 1][0] as number;
    audio.setBattlePhase("result");
    const resultCalls = musicGain.gain.setTargetAtTime.mock.calls;
    const resultValue = resultCalls[resultCalls.length - 1][0] as number;
    expect(resultValue).toBeLessThan(activeValue);
    release();
  });

  it("keeps overlapping important cue ducks until the final hold expires", async () => {
    vi.useFakeTimers();
    try {
      const context = new MockAudioContext();
      vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
      const audio = getAppAudio();
      const release = audio.mount();
      audio.setPageHidden(false);
      await audio.unlock();
      const musicGain = context.gains[1];
      audio.duck(0.2);
      audio.duck(0.4);
      const duckedCalls = musicGain.gain.setTargetAtTime.mock.calls;
      expect(duckedCalls[duckedCalls.length - 1][0]).toBeLessThan(0.1);
      vi.advanceTimersByTime(250);
      const heldCalls = musicGain.gain.setTargetAtTime.mock.calls;
      expect(heldCalls[heldCalls.length - 1][0]).toBeLessThan(0.1);
      vi.advanceTimersByTime(250);
      const restoredCalls = musicGain.gain.setTargetAtTime.mock.calls;
      expect(restoredCalls[restoredCalls.length - 1][0]).toBeGreaterThan(0.1);
      release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels an old fade when phases switch A to B to A quickly", async () => {
    const context = new MockAudioContext();
    (context as unknown as { decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer> }).decodeAudioData = vi.fn(async () => ({ duration: 10 } as unknown as AudioBuffer));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setBattleRouteActive(true);
    audio.setPageHidden(false);
    await audio.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    audio.setBattlePhase("active");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const startedBefore = context.sources.filter((item) => item.start.mock.calls.length > 0).length;
    audio.setBattlePhase("lobby");
    audio.setBattlePhase("active");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.sources.filter((item) => item.start.mock.calls.length > 0).length).toBe(startedBefore);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const musicSources = context.sources.filter((item) => (item as unknown as { loop?: boolean }).loop === true);
    expect(musicSources).toHaveLength(2);
    expect(musicSources[0].stop).toHaveBeenCalledOnce();
    expect(musicSources[1].stop).not.toHaveBeenCalled();
    const resumedBattleGain = context.gains[5].gain.setTargetAtTime.mock.calls;
    expect(resumedBattleGain.some((call) => call[0] === 1)).toBe(true);
    release();
  });

  it("remembers the result track across hidden and muted pauses", async () => {
    const context = new MockAudioContext();
    let nextBuffer = 0;
    (context as unknown as { decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer> }).decodeAudioData = vi.fn(async () => ({ duration: 10, id: ++nextBuffer } as unknown as AudioBuffer));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    vi.stubGlobal("window", { AudioContext: function () { return context; }, localStorage: { getItem: () => null, setItem: vi.fn() } });
    const audio = getAppAudio();
    const release = audio.mount();
    audio.setBattleRouteActive(true);
    audio.setPageHidden(false);
    await audio.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    audio.setBattlePhase("active");
    await new Promise((resolve) => setTimeout(resolve, 0));
    audio.setBattlePhase("result");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const startIds = () => context.sources
      .filter((item) => item.start.mock.calls.length > 0 && (item as unknown as { loop?: boolean }).loop === true)
      .map((item) => (item as unknown as { buffer?: { id?: number } }).buffer?.id)
      .filter((id): id is number => typeof id === "number");
    const initialTrackIds = startIds();
    expect(initialTrackIds).toHaveLength(2);
    const [lobbyTrackId, battleTrackId] = initialTrackIds;
    audio.setPageHidden(true);
    audio.setPageHidden(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    audio.setPreferences({ masterMuted: true });
    audio.setPreferences({ masterMuted: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(startIds().filter((id) => id === lobbyTrackId)).toHaveLength(1);
    expect(startIds().filter((id) => id === battleTrackId).length).toBeGreaterThan(1);
    release();
  });
});
