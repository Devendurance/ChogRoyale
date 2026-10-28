"use client";

import { BATTLE_MUSIC_ASSETS, UI_AUDIO_ASSETS, type UiAudioCueKey } from "./audio-assets";

/**
 * The application audio store. It owns one WebAudio context for the lifetime
 * of the app shell, while individual presentation systems only receive a bus
 * output. Keeping the context here is important on mobile browsers, where a
 * route change can otherwise strand the user's gesture unlock.
 */

export const AUDIO_STORAGE_KEY = "chog.audio.v2";
export const LEGACY_BATTLE_AUDIO_STORAGE_KEY = "chog.battle-audio.v1";

export type AudioBus = "master" | "music" | "ui" | "battle";
export type BattlePhase = "idle" | "lobby" | "active" | "reconnecting" | "result";

export interface AppAudioPreferences {
  masterVolume: number;
  musicVolume: number;
  uiVolume: number;
  battleVolume: number;
  masterMuted: boolean;
  musicMuted: boolean;
  uiMuted: boolean;
  battleMuted: boolean;
}

export interface AppAudioSnapshot {
  preferences: AppAudioPreferences;
  ready: boolean;
  needsUnlock: boolean;
  pageHidden: boolean;
  battlePhase: BattlePhase;
}

/**
 * UI cue names are a closed union shared by the asset manifest and all
 * semantic interaction callers.
 */
export type UiCue =
  | "primary"
  | "secondary"
  | "navigation"
  | "card-select"
  | "card-drag"
  | "placement"
  | "success"
  | "error"
  | "friend-request"
  | "notification"
  | "invite"
  | "ready"
  | "upgrade"
  | "reward"
  | "confirm"
  | "reveal";

export interface BattleAudioOutput {
  readonly kind: "shared";
  readonly getContext: () => AudioContext | null;
  readonly getGain: () => GainNode | null;
  readonly getReady: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly unlock: () => Promise<boolean>;
  /** Temporarily lower menu music for an important battle cue. Duration is seconds. */
  readonly duck: (durationSeconds: number) => void;
}

export interface AppAudioController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => AppAudioSnapshot;
  readonly getServerSnapshot: () => AppAudioSnapshot;
  readonly setPreferences: (patch: Partial<AppAudioPreferences>) => void;
  readonly unlock: () => Promise<boolean>;
  readonly attemptAutoplay: () => Promise<boolean>;
  readonly playUi: (cue: UiCue) => boolean;
  readonly duck: (cues: boolean | number | readonly UiCue[]) => void;
  readonly setBattlePhase: (phase: BattlePhase) => void;
  readonly setBattleRouteActive: (active: boolean) => void;
  readonly getBattleOutput: () => BattleAudioOutput;
  readonly mount: () => () => void;
  readonly setPageHidden: (hidden: boolean) => void;
}

export const DEFAULT_APP_AUDIO_PREFERENCES: AppAudioPreferences = Object.freeze({
  masterVolume: 1,
  musicVolume: 0.52,
  uiVolume: 0.72,
  battleVolume: 0.62,
  masterMuted: false,
  musicMuted: false,
  uiMuted: false,
  battleMuted: false,
});
export const APP_AUDIO_UI_VOICE_LIMIT = 12;

const SERVER_SNAPSHOT: AppAudioSnapshot = Object.freeze({
  preferences: DEFAULT_APP_AUDIO_PREFERENCES,
  ready: false,
  needsUnlock: false,
  pageHidden: false,
  battlePhase: "idle",
});

const clamp = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
};

const bool = (value: unknown): boolean => value === true;

function normalizePreferences(raw: Partial<AppAudioPreferences> | null | undefined): AppAudioPreferences {
  return Object.freeze({
    masterVolume: clamp(raw?.masterVolume, DEFAULT_APP_AUDIO_PREFERENCES.masterVolume),
    musicVolume: clamp(raw?.musicVolume, DEFAULT_APP_AUDIO_PREFERENCES.musicVolume),
    uiVolume: clamp(raw?.uiVolume, DEFAULT_APP_AUDIO_PREFERENCES.uiVolume),
    battleVolume: clamp(raw?.battleVolume, DEFAULT_APP_AUDIO_PREFERENCES.battleVolume),
    masterMuted: bool(raw?.masterMuted),
    musicMuted: bool(raw?.musicMuted),
    uiMuted: bool(raw?.uiMuted),
    battleMuted: bool(raw?.battleMuted),
  });
}

/** Reads v2 and safely migrates the old battle-only preference shape. */
export function readAppAudioPreferences(storage?: Storage | null): AppAudioPreferences {
  if (!storage) return DEFAULT_APP_AUDIO_PREFERENCES;
  let current: Partial<AppAudioPreferences> | null = null;
  try { current = JSON.parse(storage.getItem(AUDIO_STORAGE_KEY) ?? "null") as Partial<AppAudioPreferences> | null; } catch { current = null; }
  if (current && typeof current === "object" && (
      "masterVolume" in current || "musicVolume" in current || "uiVolume" in current ||
      "battleVolume" in current || "masterMuted" in current || "musicMuted" in current ||
      "uiMuted" in current || "battleMuted" in current
  )) return normalizePreferences(current);

  let legacy: { muted?: unknown; volume?: unknown } | null = null;
  try { legacy = JSON.parse(storage.getItem(LEGACY_BATTLE_AUDIO_STORAGE_KEY) ?? "null") as { muted?: unknown; volume?: unknown } | null; } catch { legacy = null; }
  if (legacy && typeof legacy === "object") {
      // A legacy explicit zero is meaningful. Do not replace it with the
      // normal positive default, and preserve an explicit mute as a mute. A
      // battle-only mute or zero was the user's global silence choice in v1,
      // so keep newly introduced music silent on first migration too.
      const volume = clamp(legacy.volume, DEFAULT_APP_AUDIO_PREFERENCES.battleVolume);
      const silent = legacy.muted === true || volume === 0;
    return normalizePreferences({ masterMuted: silent, battleVolume: volume, battleMuted: legacy.muted === true });
  }
  return DEFAULT_APP_AUDIO_PREFERENCES;
}

export function writeAppAudioPreferences(preferences: AppAudioPreferences, storage?: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preference writes are best effort. The in-memory state remains valid.
  }
}

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const candidate = window as Window & { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null;
}

interface ToneSpec {
  frequency: number;
  endFrequency?: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
}

const UI_TONES: Record<string, ToneSpec> = {
  primary: { frequency: 620, endFrequency: 760, duration: 0.045, gain: 0.1, type: "triangle" },
  secondary: { frequency: 480, endFrequency: 540, duration: 0.025, gain: 0.045, type: "sine" },
  navigation: { frequency: 580, duration: 0.04, gain: 0.08, type: "triangle" },
  "card-select": { frequency: 560, endFrequency: 700, duration: 0.06, gain: 0.09, type: "triangle" },
  "card-drag": { frequency: 480, endFrequency: 600, duration: 0.05, gain: 0.07, type: "sine" },
  placement: { frequency: 420, endFrequency: 760, duration: 0.1, gain: 0.1, type: "triangle" },
  error: { frequency: 180, endFrequency: 120, duration: 0.1, gain: 0.1, type: "square" },
  "friend-request": { frequency: 450, endFrequency: 720, duration: 0.12, gain: 0.09, type: "sine" },
  notification: { frequency: 720, endFrequency: 980, duration: 0.12, gain: 0.09, type: "sine" },
  invite: { frequency: 430, endFrequency: 860, duration: 0.16, gain: 0.11, type: "triangle" },
  ready: { frequency: 330, endFrequency: 660, duration: 0.14, gain: 0.1, type: "sine" },
  upgrade: { frequency: 500, endFrequency: 780, duration: 0.11, gain: 0.1, type: "triangle" },
  reward: { frequency: 620, endFrequency: 930, duration: 0.12, gain: 0.1, type: "triangle" },
  confirm: { frequency: 540, endFrequency: 820, duration: 0.09, gain: 0.11, type: "triangle" },
  reveal: { frequency: 400, endFrequency: 680, duration: 0.14, gain: 0.1, type: "sine" },
};

const IMPORTANT_UI_CUES: ReadonlySet<UiCue> = new Set([
  "success",
  "error",
  "friend-request",
  "notification",
  "invite",
  "ready",
  "upgrade",
  "reward",
  "confirm",
  "reveal",
]);

const UI_GAP = 0.04;

class AppAudio implements AppAudioController {
  private context: AudioContext | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private master: GainNode | null = null;
  private readonly buses: Partial<Record<AudioBus, GainNode>> = {};
  private readonly musicBuffers = new Map<"track-a" | "track-b", AudioBuffer>();
  private readonly musicLoads = new Map<"track-a" | "track-b", Promise<void>>();
  private readonly musicSources = new Map<"track-a" | "track-b", { source: AudioBufferSourceNode; gain: GainNode; startedAt: number }>();
  private readonly musicOffsets: Record<"track-a" | "track-b", number> = { "track-a": 0, "track-b": 0 };
  private musicTrack: "track-a" | "track-b" | null = null;
  private lastDesiredMusicTrack: "track-a" | "track-b" | null = null;
  private resultMusicTrack: "track-a" | "track-b" | null = null;
  private musicTransition = 0;
  private readonly musicTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly musicFadeTimers = new Map<"track-a" | "track-b", ReturnType<typeof setTimeout>>();
  private readonly uiBuffers = new Map<UiCue, AudioBuffer>();
  private readonly uiLoads = new Map<UiCue, Promise<void>>();
  private cueDucked = false;
  private readonly duckHolds = new Map<number, ReturnType<typeof setTimeout>>();
  private nextDuckHoldId = 1;
  private manualDuckHold = false;
  private readonly listeners = new Set<() => void>();
  private readonly voices = new Set<AudioScheduledSourceNode>();
  private readonly lastUi = new Map<string, number>();
  private unlockPromise: Promise<boolean> | null = null;
  private autoplayAttempted = false;
  private mounted = 0;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private pageHidden = false;
  private resumeOnVisible = false;
  private visibilityResumePromise: Promise<boolean> | null = null;
  private battlePhase: BattlePhase = "idle";
  private battleRouteActive = false;
  private preferences: AppAudioPreferences = DEFAULT_APP_AUDIO_PREFERENCES;
  private snapshot: AppAudioSnapshot = SERVER_SNAPSHOT;
  private battleOutput: BattleAudioOutput;

  constructor() {
    this.battleOutput = {
      kind: "shared",
      getContext: () => this.context,
      getGain: () => this.buses.battle ?? null,
      getReady: () => this.getSnapshot().ready && this.hasAudibleBus("battle"),
      subscribe: (listener) => this.subscribe(listener),
      unlock: () => this.unlock(),
      duck: (durationSeconds) => this.duck(durationSeconds),
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): AppAudioSnapshot => this.snapshot;
  readonly getServerSnapshot = (): AppAudioSnapshot => SERVER_SNAPSHOT;

  mount(): () => void {
    this.mounted += 1;
    if (this.teardownTimer !== null) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    if (typeof window !== "undefined") {
      try {
        const storage = window.localStorage;
        const hasCurrent = storage.getItem(AUDIO_STORAGE_KEY) !== null;
        this.preferences = readAppAudioPreferences(storage);
        if (!hasCurrent && storage.getItem(LEGACY_BATTLE_AUDIO_STORAGE_KEY) !== null) {
          writeAppAudioPreferences(this.preferences, storage);
        }
      } catch {
        this.preferences = DEFAULT_APP_AUDIO_PREFERENCES;
      }
      this.rebuildSnapshot();
    }
    return () => {
      this.mounted = Math.max(0, this.mounted - 1);
      if (this.mounted === 0) {
        this.setPageHidden(true);
        // React StrictMode probes unmount and remount synchronously. Delay the
        // close by one task so the probe can cancel it, while a real unmount
        // still releases the context and all scheduled sources.
        this.teardownTimer = setTimeout(() => {
          this.teardownTimer = null;
          if (this.mounted === 0) this.shutdown();
        }, 0);
      }
    };
  }

  setPageHidden(hidden: boolean): void {
    if (hidden && !this.pageHidden) {
      this.resumeOnVisible = this.context?.state === "running";
    }
    this.pageHidden = hidden;
    if (this.context) {
      if (hidden) {
        this.stopUiVoices();
        this.stopMusic();
      } else {
        this.resumeContextAfterVisibility();
        void this.syncMusicTrack();
      }
      this.applyBusGains(0.018);
    }
    this.rebuildSnapshot();
  }

  setPreferences(patch: Partial<AppAudioPreferences>): void {
    this.preferences = normalizePreferences({ ...this.preferences, ...patch });
    if (typeof window !== "undefined") {
      try { writeAppAudioPreferences(this.preferences, window.localStorage); } catch { /* blocked storage */ }
    }
    this.applyBusGains(0.015);
    if (this.preferences.masterMuted || this.preferences.uiMuted || this.preferences.uiVolume === 0) this.stopUiVoices();
    if (this.preferences.masterMuted || this.preferences.musicMuted || this.preferences.musicVolume === 0) this.stopMusic();
    else if (!this.pageHidden) void this.syncMusicTrack();
    this.rebuildSnapshot();
  }

  async attemptAutoplay(): Promise<boolean> {
    if (this.autoplayAttempted || this.preferences.masterMuted || this.pageHidden) return this.getSnapshot().ready;
    this.autoplayAttempted = true;
    return this.unlock();
  }

  async unlock(): Promise<boolean> {
    if (this.preferences.masterMuted || this.pageHidden || !this.hasAnyAudibleBus()) {
      this.rebuildSnapshot();
      return false;
    }
    if (!this.context || this.context.state === "closed") {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return false;
      try {
        this.context = new Ctor();
        this.master = this.context.createGain();
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -9;
        this.limiter.knee.value = 6;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.002;
        this.limiter.release.value = 0.12;
        this.master.connect(this.limiter).connect(this.context.destination);
        for (const bus of ["music", "ui", "battle"] as const) {
          const gain = this.context.createGain();
          this.buses[bus] = gain;
          gain.connect(this.master);
        }
        this.context.onstatechange = () => {
          this.rebuildSnapshot();
          if (this.context?.state === "running" && !this.pageHidden) {
            void this.syncMusicTrack();
          }
        };
        const warmup = this.context.createBufferSource();
        warmup.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
        warmup.connect(this.master);
        warmup.onended = () => warmup.disconnect();
        warmup.start();
        this.applyBusGains(0);
        void this.syncMusicTrack();
        void this.preloadUiAssets();
      } catch {
        this.clearContext();
        return false;
      }
    }
    if (this.context.state !== "running") {
      if (!this.unlockPromise) {
        const context = this.context;
        const pending = context.resume()
          .then(() => {
            const running = this.context === context && context.state === "running";
            if (running) void this.preloadUiAssets();
            return running;
          })
          .catch(() => false);
        this.unlockPromise = pending;
        void pending.finally(() => {
          if (this.unlockPromise === pending) this.unlockPromise = null;
          this.rebuildSnapshot();
        });
      }
      return this.unlockPromise;
    }
    void this.preloadUiAssets();
    this.rebuildSnapshot();
    return this.snapshot.ready;
  }

  playUi(cue: UiCue): boolean {
    const context = this.context;
    const bus = this.buses.ui;
    const spec = UI_TONES[cue] ?? UI_TONES.primary;
    if (!context || !bus || !this.snapshot.ready || !this.hasAudibleBus("ui")) return false;
    if (this.voices.size >= APP_AUDIO_UI_VOICE_LIMIT) return false;
    const now = context.currentTime;
    if (now - (this.lastUi.get(cue) ?? -Infinity) < UI_GAP) return false;
    this.lastUi.set(cue, now);
    const buffer = this.uiBuffers.get(cue);
    if (buffer) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(bus);
      this.voices.add(source);
      source.onended = () => { this.voices.delete(source); source.disconnect(); };
      source.start(now + 0.01);
    } else {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = spec.type ?? "sine";
      const start = now + 0.01;
      const end = start + spec.duration;
      oscillator.frequency.setValueAtTime(spec.frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(spec.endFrequency ?? spec.frequency, end);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(spec.gain, start + Math.min(0.012, spec.duration * 0.3));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain).connect(bus);
      this.voices.add(oscillator);
      oscillator.onended = () => {
        this.voices.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    }
    void this.ensureUiLoaded(cue);
    if (IMPORTANT_UI_CUES.has(cue)) {
      const duration = buffer?.duration ?? spec.duration;
      this.holdDuck(duration + 0.09);
    }
    return true;
  }

  duck(cues: boolean | number | readonly UiCue[]): void {
    if (typeof cues === "boolean") {
      this.manualDuckHold = cues;
      this.refreshDuckState();
      return;
    }
    if (typeof cues === "number") {
      if (cues > 0) this.holdDuck(cues);
      return;
    }
    if (cues.length === 0) return;
    const duration = Math.max(...cues.map((cue) => UI_AUDIO_ASSETS[cue]?.durationSeconds ?? UI_TONES[cue].duration));
    this.holdDuck(duration + 0.09);
  }

  setBattlePhase(phase: BattlePhase): void {
    if (!this.battleRouteActive && (phase === "active" || phase === "reconnecting" || phase === "result")) return;
    if (phase === "result" && this.battlePhase !== "result") {
      this.resultMusicTrack = this.lastDesiredMusicTrack;
    } else if (phase !== "result") {
      this.resultMusicTrack = null;
    }
    this.battlePhase = phase;
    this.applyBusGains(0.03);
    if (!this.pageHidden) void this.syncMusicTrack();
    this.rebuildSnapshot();
  }

  setBattleRouteActive(active: boolean): void {
    this.battleRouteActive = active;
    if (!active && this.battlePhase !== "lobby" && this.battlePhase !== "idle") {
      this.battlePhase = "lobby";
      this.resultMusicTrack = null;
      this.applyBusGains(0.03);
      if (!this.pageHidden) void this.syncMusicTrack();
      this.rebuildSnapshot();
    }
  }

  getBattleOutput(): BattleAudioOutput {
    return this.battleOutput;
  }

  private hasAudibleBus(bus: Exclude<AudioBus, "master">): boolean {
    const pref = this.preferences;
    if (pref.masterMuted || pref.masterVolume <= 0) return false;
    const volume = pref[`${bus}Volume` as "musicVolume" | "uiVolume" | "battleVolume"];
    const muted = pref[`${bus}Muted` as "musicMuted" | "uiMuted" | "battleMuted"];
    return !muted && volume > 0;
  }

  private hasAnyAudibleBus(): boolean {
    return this.hasAudibleBus("music") || this.hasAudibleBus("ui") || this.hasAudibleBus("battle");
  }

  private applyBusGains(timeConstant: number): void {
    const context = this.context;
    if (!context || !this.master) return;
    const p = this.preferences;
    this.master.gain.setTargetAtTime(this.pageHidden || p.masterMuted ? 0 : p.masterVolume, context.currentTime, timeConstant);
    const phase = this.battlePhase;
    const musicPhase = phase === "active" || phase === "reconnecting" ? 0.22 : phase === "result" ? 0.08 : 0.32;
    const battlePhase = phase === "lobby" || phase === "idle" ? 0.18 : 1;
    const set = (bus: "music" | "ui" | "battle", value: number, volume: number, muted: boolean) => {
      this.buses[bus]?.gain.setTargetAtTime(this.pageHidden || muted ? 0 : value * volume, context.currentTime, timeConstant);
    };
    set("music", musicPhase * (this.cueDucked ? 0.5 : 1), p.musicVolume, p.musicMuted);
    set("ui", 1, p.uiVolume, p.uiMuted);
    set("battle", battlePhase, p.battleVolume, p.battleMuted);
  }

  private desiredMusicTrack(): "track-a" | "track-b" | null {
    if (this.battlePhase === "active" || this.battlePhase === "reconnecting") {
      const battleTrack = BATTLE_MUSIC_ASSETS["track-b"];
      const available = process.env.NODE_ENV === "production"
        ? battleTrack.production && Boolean(battleTrack.path)
        : Boolean(battleTrack.developmentPath ?? battleTrack.path);
      return available ? "track-b" : null;
    }
    if (this.battlePhase === "result") return this.resultMusicTrack;
    return "track-a";
  }

  private async syncMusicTrack(): Promise<void> {
    if (this.pageHidden || !this.hasAudibleBus("music")) {
      this.stopMusic();
      return;
    }
    const desired = this.desiredMusicTrack();
    // A null desired track is meaningful. In production it records that the
    // manifest intentionally has no commercial battle master, so result mode
    // must not fall back to the previous lobby track.
    this.lastDesiredMusicTrack = desired;
    this.musicTrack = desired;
    const transition = ++this.musicTransition;
    for (const [track] of this.musicSources) {
      if (track !== desired) this.fadeOutMusic(track);
    }
    if (!desired) return;
    if (this.musicBuffers.has(desired)) {
      this.startMusic(desired, transition);
      return;
    }
    await this.ensureMusicLoaded(desired);
    if (this.musicTransition !== transition || this.musicTrack !== desired) return;
    this.startMusic(desired, transition);
  }

  private async ensureMusicLoaded(track: "track-a" | "track-b"): Promise<void> {
    const context = this.context;
    const asset = BATTLE_MUSIC_ASSETS[track];
    const path = track === "track-b" && process.env.NODE_ENV !== "production"
      ? (asset.developmentPath ?? asset.path)
      : asset.path;
    if (!context || !path || typeof fetch !== "function" || typeof context.decodeAudioData !== "function") return;
    if (!this.musicLoads.has(track)) {
      const pending = fetch(path, { cache: "force-cache" })
        .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`music ${response.status}`)))
        .then((bytes) => context.decodeAudioData(bytes))
        .then((buffer) => { if (this.context === context) this.musicBuffers.set(track, buffer); })
        .catch(() => {
          // Music is optional. UI and battle cues remain available through
          // their procedural or pre-rendered fallbacks when it is unavailable.
        })
        .finally(() => { this.musicLoads.delete(track); });
      this.musicLoads.set(track, pending);
    }
    await this.musicLoads.get(track);
  }

  private async ensureUiLoaded(cue: UiCue): Promise<void> {
    const context = this.context;
    if (!context || typeof fetch !== "function" || typeof context.decodeAudioData !== "function" || this.uiBuffers.has(cue)) return;
    if (!this.uiLoads.has(cue)) {
      const path = UI_AUDIO_ASSETS[cue as UiAudioCueKey]?.path;
      if (!path) return;
      const pending = fetch(path, { cache: "force-cache" })
        .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`ui ${response.status}`)))
        .then((bytes) => context.decodeAudioData(bytes))
        .then((buffer) => { if (this.context === context) this.uiBuffers.set(cue, buffer); })
        .catch(() => { /* the procedural tone remains the safe fallback */ })
        .finally(() => { this.uiLoads.delete(cue); });
      this.uiLoads.set(cue, pending);
    }
    await this.uiLoads.get(cue);
  }

  private async preloadUiAssets(): Promise<void> {
    await Promise.all(Object.keys(UI_AUDIO_ASSETS).map((cue) => this.ensureUiLoaded(cue as UiCue)));
  }

  private resumeContextAfterVisibility(): void {
    const context = this.context;
    if (!this.resumeOnVisible || !context || context.state === "running" || this.preferences.masterMuted || !this.hasAnyAudibleBus()) return;
    this.resumeOnVisible = false;
    if (this.visibilityResumePromise) return;
    const pending = context.resume()
      .then(() => {
        const running = this.context === context && context.state === "running";
        if (running && !this.pageHidden) {
          void this.syncMusicTrack();
          this.applyBusGains(0.018);
          this.rebuildSnapshot();
        }
        return running;
      })
      .catch(() => false);
    this.visibilityResumePromise = pending;
    void pending.finally(() => {
      if (this.visibilityResumePromise === pending) this.visibilityResumePromise = null;
    });
  }

  private startMusic(track: "track-a" | "track-b", transition: number): void {
    const context = this.context;
    const bus = this.buses.music;
    const buffer = this.musicBuffers.get(track);
    if (!context || !bus || !buffer || this.pageHidden || !this.hasAudibleBus("music") || context.state !== "running") return;
    const existing = this.musicSources.get(track);
    if (existing) {
      const timer = this.musicFadeTimers.get(track);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.musicTimers.delete(timer);
        this.musicFadeTimers.delete(track);
      }
      existing.gain.gain.setTargetAtTime(1, context.currentTime, 0.18);
      return;
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    // Track A is authored as a cyclic loop by the asset worker. Keeping the
    // flag true also protects older baked derivatives from stopping at 53 s.
    source.loop = true;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.setTargetAtTime(1, context.currentTime, 0.22);
    source.connect(gain).connect(bus);
    const offset = buffer.duration > 0 ? this.musicOffsets[track] % buffer.duration : 0;
    this.musicSources.set(track, { source, gain, startedAt: context.currentTime - offset });
    source.onended = () => {
      const state = this.musicSources.get(track);
      if (state?.source === source) this.musicSources.delete(track);
      source.disconnect();
      gain.disconnect();
    };
    source.start(context.currentTime, offset);
    if (this.musicTransition !== transition) this.fadeOutMusic(track);
  }

  private fadeOutMusic(track: "track-a" | "track-b"): void {
    const context = this.context;
    const state = this.musicSources.get(track);
    if (!state || !context) return;
    const buffer = this.musicBuffers.get(track);
    if (buffer?.duration) this.musicOffsets[track] = (context.currentTime - state.startedAt) % buffer.duration;
    const previousTimer = this.musicFadeTimers.get(track);
    if (previousTimer !== undefined) {
      clearTimeout(previousTimer);
      this.musicTimers.delete(previousTimer);
    }
    state.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.18);
    const timer = setTimeout(() => {
      this.musicTimers.delete(timer);
      this.musicFadeTimers.delete(track);
      if (this.musicTrack !== track && this.musicSources.get(track)?.source === state.source) {
        try { state.source.stop(); } catch { /* source may have ended */ }
        state.source.disconnect();
        state.gain.disconnect();
        if (this.musicSources.get(track)?.source === state.source) this.musicSources.delete(track);
      }
    }, 600);
    this.musicTimers.add(timer);
    this.musicFadeTimers.set(track, timer);
  }

  private stopMusic(): void {
    const context = this.context;
    this.musicTransition += 1;
    this.musicTrack = null;
    for (const timer of this.musicTimers) clearTimeout(timer);
    this.musicTimers.clear();
    this.musicFadeTimers.clear();
    for (const [track, state] of this.musicSources) {
      const buffer = this.musicBuffers.get(track);
      if (context && buffer?.duration) this.musicOffsets[track] = (context.currentTime - state.startedAt) % buffer.duration;
      try { state.source.stop(); } catch { /* source may have ended */ }
      state.source.disconnect();
      state.gain.disconnect();
    }
    this.musicSources.clear();
  }

  private stopUiVoices(): void {
    for (const timer of this.duckHolds.values()) clearTimeout(timer);
    this.duckHolds.clear();
    this.manualDuckHold = false;
    this.cueDucked = false;
    for (const voice of this.voices) {
      try { voice.stop(); } catch { /* already ended */ }
      voice.disconnect();
    }
    this.voices.clear();
  }

  private holdDuck(durationSeconds: number): void {
    const durationMs = Math.max(100, Math.ceil(durationSeconds * 1000));
    const id = this.nextDuckHoldId++;
    const timer = setTimeout(() => {
      this.duckHolds.delete(id);
      this.refreshDuckState();
    }, durationMs);
    this.duckHolds.set(id, timer);
    this.refreshDuckState();
  }

  private refreshDuckState(): void {
    const active = this.manualDuckHold || this.duckHolds.size > 0;
    if (active === this.cueDucked) return;
    this.cueDucked = active;
    this.applyBusGains(0.025);
  }

  private clearContext(): void {
    this.stopMusic();
    this.musicBuffers.clear();
    this.musicLoads.clear();
    this.lastDesiredMusicTrack = null;
    this.resultMusicTrack = null;
    this.resumeOnVisible = false;
    this.visibilityResumePromise = null;
    this.musicOffsets["track-a"] = 0;
    this.musicOffsets["track-b"] = 0;
    this.uiBuffers.clear();
    this.uiLoads.clear();
    if (this.context) this.context.onstatechange = null;
    this.context = null;
    this.master = null;
    this.limiter = null;
    delete this.buses.music;
    delete this.buses.ui;
    delete this.buses.battle;
    this.rebuildSnapshot();
  }

  private shutdown(): void {
    this.stopUiVoices();
    const context = this.context;
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => {});
    }
    this.clearContext();
    this.pageHidden = true;
    this.autoplayAttempted = false;
    this.rebuildSnapshot();
  }

  private rebuildSnapshot(): void {
    const running = this.context?.state === "running";
    const ready = Boolean(running && !this.pageHidden && this.hasAnyAudibleBus());
    this.snapshot = Object.freeze({
      preferences: this.preferences,
      ready,
      needsUnlock: !running && !this.preferences.masterMuted && this.hasAnyAudibleBus(),
      pageHidden: this.pageHidden,
      battlePhase: this.battlePhase,
    });
    for (const listener of this.listeners) listener();
  }
}

let sharedAudio: AppAudioController | null = null;

export function getAppAudio(): AppAudioController {
  if (!sharedAudio) sharedAudio = new AppAudio();
  return sharedAudio;
}

export function resetAppAudioForTests(): void {
  // Only test code should reset the module singleton. The browser app keeps a
  // single instance across route transitions and StrictMode probes.
  sharedAudio = null;
}

/** Imperative bridge for event handlers that cannot use React context. */
export function uiSound(cue: UiCue): boolean {
  return getAppAudio().playUi(cue);
}
