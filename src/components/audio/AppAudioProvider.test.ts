import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_AUDIO_PREFERENCES, type AppAudioSnapshot } from "@/lib/audio/audio-core";
import { installAudioGestureUnlock } from "./AppAudioProvider";

type Listener = (event: Event) => void;

function makeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(typeof listener === "function" ? listener : (event) => listener.handleEvent(event));
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const set = listeners.get(type);
      if (!set) return;
      const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
      // The helper removes the same function reference. This lookup keeps the
      // fake target small while still checking the browser listener contract.
      for (const registered of set) {
        if (registered === callback || registered.toString() === callback.toString()) set.delete(registered);
      }
    },
    dispatch(type: string, event: Event = new Event(type)) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    count(type: string) { return listeners.get(type)?.size ?? 0; },
  };
}

function makeAudio() {
  let snapshot: AppAudioSnapshot = {
    preferences: { ...DEFAULT_APP_AUDIO_PREFERENCES },
    ready: false,
    needsUnlock: true,
    pageHidden: false,
    battlePhase: "idle",
  };
  const unlock = vi.fn(async () => {
    snapshot = { ...snapshot, ready: true, needsUnlock: false };
    return true;
  });
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    unlock,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

describe("audio gesture recovery", () => {
  it("unlocks from the first real pointer and removes temporary listeners", async () => {
    const target = makeTarget();
    const audio = makeAudio();
    const stop = installAudioGestureUnlock(audio, target);

    expect(target.count("pointerdown")).toBe(1);
    expect(target.count("keydown")).toBe(1);
    target.dispatch("pointerdown", new Event("pointerdown"));
    await Promise.resolve();

    expect(audio.unlock).toHaveBeenCalledWith({ fromGesture: true });
    expect(target.count("pointerdown")).toBe(0);
    expect(target.count("keydown")).toBe(0);
    stop();
  });

  it("does not install recovery listeners for an already-ready or muted snapshot", () => {
    const target = makeTarget();
    const readyAudio = makeAudio();
    const readySnapshot = readyAudio.getSnapshot();
    readyAudio.getSnapshot = () => ({ ...readySnapshot, ready: true, needsUnlock: false });
    expect(installAudioGestureUnlock(readyAudio, target)).toBeTypeOf("function");
    expect(target.count("pointerdown")).toBe(0);

    const mutedAudio = makeAudio();
    const mutedSnapshot = mutedAudio.getSnapshot();
    mutedAudio.getSnapshot = () => ({
      ...mutedSnapshot,
      preferences: { ...DEFAULT_APP_AUDIO_PREFERENCES, masterMuted: true },
      needsUnlock: false,
    });
    const stop = installAudioGestureUnlock(mutedAudio, target);
    expect(target.count("pointerdown")).toBe(0);
    target.dispatch("pointerdown");
    expect(mutedAudio.unlock).not.toHaveBeenCalled();
    stop();
  });
});
