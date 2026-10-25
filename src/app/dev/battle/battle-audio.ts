import type { AckMessage, BattleFrame, FrameEvent } from "@/lib/battle-protocol";
import { combatEventKey } from "./combat-vfx";

export type BattleCue =
  | "start"
  | "select"
  | "deploy"
  | "spawn"
  | "reject"
  | "spell"
  | "fire"
  | "impact"
  | "structure-hit"
  | "death"
  | "destroy"
  | "crown-earned"
  | "crown-tally"
  | "ability"
  | "ability-impact"
  | "chaos-warning"
  | "chaos-active"
  | "chaos-expired"
  | "victory"
  | "defeat"
  | "draw";

export interface BattleAudioPreferences {
  muted: boolean;
  volume: number;
}

export interface BattleAudioCue {
  cue: BattleCue;
  key: string;
}

export function takeUnseenBattleAudioCues(cues: BattleAudioCue[], seen: Set<string>): BattleAudioCue[] {
  const unseen: BattleAudioCue[] = [];
  for (const cue of cues) {
    if (seen.has(cue.key)) continue;
    seen.add(cue.key);
    if (seen.size > 2048) seen.delete(seen.values().next().value!);
    unseen.push(cue);
  }
  return unseen;
}

export const BATTLE_AUDIO_STORAGE_KEY = "chog.battle-audio.v1";
export const DEFAULT_BATTLE_AUDIO_PREFERENCES: BattleAudioPreferences = { muted: false, volume: 0.55 };

const clampVolume = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_BATTLE_AUDIO_PREFERENCES.volume);

export function readBattleAudioPreferences(storage?: Storage | null): BattleAudioPreferences {
  if (!storage) return { ...DEFAULT_BATTLE_AUDIO_PREFERENCES };
  try {
    const raw = JSON.parse(storage.getItem(BATTLE_AUDIO_STORAGE_KEY) ?? "null") as Partial<BattleAudioPreferences> | null;
    return {
      muted: raw?.muted === true,
      volume: clampVolume(typeof raw?.volume === "number" ? raw.volume : DEFAULT_BATTLE_AUDIO_PREFERENCES.volume),
    };
  } catch {
    return { ...DEFAULT_BATTLE_AUDIO_PREFERENCES };
  }
}

export function writeBattleAudioPreferences(preferences: BattleAudioPreferences, storage?: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(BATTLE_AUDIO_STORAGE_KEY, JSON.stringify({ muted: preferences.muted, volume: clampVolume(preferences.volume) }));
  } catch {
    /* Storage is optional in private browsing and embedded previews. */
  }
}

const cueForEvent = (event: FrameEvent): BattleAudioCue | null => {
  const key = combatEventKey(event);
  switch (event.type) {
    case "deploy":
      return { cue: "deploy", key };
    case "building_spawned":
    case "unit_spawned":
    case "commander_deployed":
      return { cue: "spawn", key };
    case "spell_cast":
      return { cue: "spell", key };
    case "spell_impact":
      return { cue: "impact", key };
    case "tower_fired":
    case "siege_fired":
      return { cue: "fire", key };
    case "shockwave":
      return { cue: "impact", key };
    case "ability_fired":
      return event.trigger === "active" ? { cue: "ability-impact", key } : null;
    case "pulse_warning":
      return { cue: "chaos-warning", key };
    case "pulse_active":
      return { cue: "chaos-active", key };
    case "pulse_expired":
      return { cue: "chaos-expired", key };
    case "death":
      return { cue: "death", key };
    case "structure_destroyed":
      return { cue: "destroy", key };
    default:
      return null;
  }
};

/**
 * Maps one authoritative frame transition to concise cues. The caller owns
 * cross-snapshot deduplication so refreshing a frame cannot replay an event.
 */
export function cuesForBattleFrame(frame: BattleFrame, previous: BattleFrame | null): BattleAudioCue[] {
  const cues: BattleAudioCue[] = [];
  for (const event of frame.events) {
    const cue = cueForEvent(event);
    if (cue) cues.push(cue);
  }

  const previousStructures = new Map((previous?.structures ?? []).map((structure) => [structure.id, structure]));
  // The protocol has no ordinary melee attack/release event. Observed HP loss
  // can provide impact feedback without inventing an attacker or attack time.
  const previousUnits = new Map([...(previous?.troops ?? []), ...(previous?.commanders ?? []), ...(previous?.buildings ?? [])].map((unit) => [unit.id, unit]));
  for (const unit of [...frame.troops, ...frame.commanders, ...frame.buildings]) {
    const before = previousUnits.get(unit.id);
    if (before && unit.hp < before.hp) cues.push({ cue: "impact", key: `unit-hit:${frame.tick}:${unit.id}:${unit.hp}` });
  }
  for (const structure of frame.structures) {
    const before = previousStructures.get(structure.id);
    if (before && structure.hp < before.hp && structure.alive) {
      cues.push({ cue: "structure-hit", key: `structure-hit:${frame.tick}:${structure.id}` });
    }
  }

  const previousImpacts = new Set((previous?.impacts ?? []).map((impact) => impact.id));
  const eventImpacts = new Set(
    frame.events
      .filter((event) => event.type === "spell_impact" || event.type === "siege_fired")
      .map((event) => String(event.impactId ?? ""))
      .filter(Boolean)
  );
  for (const impact of frame.impacts) {
    if (!previousImpacts.has(impact.id) && !eventImpacts.has(impact.id)) cues.push({ cue: "impact", key: `impact:${impact.id}` });
  }

  return cues;
}

export function cueForAck(ack: AckMessage, label: string): BattleAudioCue | null {
  if (ack.ok) {
    if (label.startsWith("ability ")) return { cue: "ability", key: `ack:${ack.cid}:${ack.tick}` };
    return null;
  }
  if (label.startsWith("ability ") || label.includes(" @")) return { cue: "reject", key: `ack:${ack.cid}:${ack.tick}` };
  return null;
}

export function cueForResult(result: "win" | "loss" | "draw"): BattleAudioCue {
  return { cue: result === "win" ? "victory" : result === "loss" ? "defeat" : "draw", key: `result:${result}` };
}

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const candidate = window as Window & { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null;
}

const cueGap: Record<BattleCue, number> = {
  start: 0.8,
  select: 0.04,
  deploy: 0.08,
  spawn: 0.08,
  reject: 0.12,
  spell: 0.08,
  fire: 0.08,
  impact: 0.08,
  "structure-hit": 0.14,
  death: 0.09,
  destroy: 0.2,
  "crown-earned": 0.45,
  "crown-tally": 0.1,
  ability: 0.12,
  "ability-impact": 0.14,
  "chaos-warning": 0.45,
  "chaos-active": 0.3,
  "chaos-expired": 0.3,
  victory: 0.8,
  defeat: 0.8,
  draw: 0.8,
};

interface ToneSpec {
  frequency: number;
  endFrequency?: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  delay?: number;
  noise?: boolean;
}

const toneSpecs: Record<BattleCue, ToneSpec[]> = {
  start: [
    { frequency: 196, duration: 0.18, type: "triangle", gain: 0.18 },
    { frequency: 294, duration: 0.22, type: "triangle", gain: 0.15, delay: 0.12 },
    { frequency: 392, duration: 0.32, type: "triangle", gain: 0.14, delay: 0.26 },
  ],
  select: [{ frequency: 560, endFrequency: 700, duration: 0.055, type: "triangle", gain: 0.2 }],
  deploy: [{ frequency: 250, endFrequency: 520, duration: 0.12, type: "triangle", gain: 0.24 }],
  spawn: [{ frequency: 360, endFrequency: 620, duration: 0.13, type: "sine", gain: 0.16 }],
  reject: [{ frequency: 190, endFrequency: 110, duration: 0.12, type: "square", gain: 0.13 }],
  spell: [{ frequency: 420, endFrequency: 760, duration: 0.14, type: "sine", gain: 0.16 }],
  fire: [{ frequency: 220, endFrequency: 160, duration: 0.075, type: "square", gain: 0.12 }],
  impact: [{ frequency: 150, endFrequency: 70, duration: 0.13, type: "triangle", gain: 0.2 }],
  "structure-hit": [{ frequency: 180, endFrequency: 95, duration: 0.1, type: "triangle", gain: 0.16 }],
  death: [{ frequency: 190, endFrequency: 80, duration: 0.12, type: "sawtooth", gain: 0.1 }],
  destroy: [
    { frequency: 130, endFrequency: 55, duration: 0.24, type: "sawtooth", gain: 0.18 },
    { frequency: 390, endFrequency: 170, duration: 0.18, type: "triangle", gain: 0.1, delay: 0.02 },
  ],
  ability: [{ frequency: 460, endFrequency: 820, duration: 0.18, type: "triangle", gain: 0.18 }],
  "crown-earned": [
    { frequency: 659, endFrequency: 784, duration: 0.15, type: "sine", gain: 0.16 },
    { frequency: 988, duration: 0.24, type: "triangle", gain: 0.13, delay: 0.1 },
    { frequency: 1318, duration: 0.3, type: "sine", gain: 0.09, delay: 0.19 },
  ],
  "crown-tally": [
    { frequency: 880, endFrequency: 1175, duration: 0.09, type: "triangle", gain: 0.12 },
    { frequency: 1760, duration: 0.12, type: "sine", gain: 0.05, delay: 0.03 },
  ],
  "ability-impact": [{ frequency: 300, endFrequency: 900, duration: 0.2, type: "sine", gain: 0.16 }],
  "chaos-warning": [
    { frequency: 520, endFrequency: 620, duration: 0.08, type: "triangle", gain: 0.15 },
    { frequency: 620, endFrequency: 760, duration: 0.08, type: "triangle", gain: 0.12, delay: 0.16 },
  ],
  "chaos-active": [{ frequency: 260, endFrequency: 520, duration: 0.22, type: "sine", gain: 0.14 }],
  "chaos-expired": [{ frequency: 420, endFrequency: 220, duration: 0.18, type: "triangle", gain: 0.11 }],
  victory: [
    { frequency: 520, endFrequency: 700, duration: 0.18, type: "triangle", gain: 0.16 },
    { frequency: 700, endFrequency: 920, duration: 0.24, type: "triangle", gain: 0.14, delay: 0.16 },
  ],
  defeat: [{ frequency: 260, endFrequency: 100, duration: 0.3, type: "sawtooth", gain: 0.12 }],
  draw: [{ frequency: 420, endFrequency: 360, duration: 0.22, type: "triangle", gain: 0.13 }],
};

// Original short percussion layers. Filtered noise gives body and texture,
// while the pitched layers above supply a restrained magical identity.
const percussion: Partial<Record<BattleCue, ToneSpec>> = {
  select: { frequency: 2600, duration: 0.025, type: "sine", gain: 0.09, noise: true },
  deploy: { frequency: 1100, duration: 0.11, type: "sine", gain: 0.22, noise: true },
  spawn: { frequency: 1900, duration: 0.08, type: "sine", gain: 0.12, noise: true },
  spell: { frequency: 3200, duration: 0.22, type: "sine", gain: 0.15, noise: true },
  fire: { frequency: 1400, duration: 0.075, type: "sine", gain: 0.23, noise: true },
  impact: { frequency: 700, duration: 0.15, type: "sine", gain: 0.3, noise: true },
  "structure-hit": { frequency: 900, duration: 0.14, type: "sine", gain: 0.26, noise: true },
  death: { frequency: 1700, duration: 0.11, type: "sine", gain: 0.13, noise: true },
  destroy: { frequency: 650, duration: 0.45, type: "sine", gain: 0.34, noise: true },
  ability: { frequency: 2300, duration: 0.24, type: "sine", gain: 0.18, noise: true },
  "ability-impact": { frequency: 1300, duration: 0.28, type: "sine", gain: 0.23, noise: true },
  "chaos-active": { frequency: 850, duration: 0.36, type: "sine", gain: 0.23, noise: true },
};

export const BATTLE_AUDIO_VOICE_LIMIT = 16;

export class BattleAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly lastPlayed = new Map<BattleCue, number>();
  private activeVoices = 0;
  private muted: boolean;
  private volume: number;
  private unlockPromise: Promise<boolean> | null = null;
  private pageHidden = false;
  private readonly voices = new Set<AudioScheduledSourceNode>();
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getReady = (): boolean => this.context?.state === "running" && !this.muted && !this.pageHidden && this.volume > 0;

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  constructor(preferences: BattleAudioPreferences = DEFAULT_BATTLE_AUDIO_PREFERENCES) {
    this.muted = preferences.muted;
    this.volume = clampVolume(preferences.volume);
  }

  get preferences(): BattleAudioPreferences {
    return { muted: this.muted, volume: this.volume };
  }

  setPreferences(preferences: BattleAudioPreferences): void {
    this.muted = preferences.muted;
    this.volume = clampVolume(preferences.volume);
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted || this.pageHidden ? 0 : this.volume, this.context.currentTime, 0.015);
    if (this.muted || this.volume === 0) this.stopVoices();
    this.notify();
  }

  setPageHidden(hidden: boolean): void {
    this.pageHidden = hidden;
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted || hidden ? 0 : this.volume, this.context.currentTime, 0.015);
    if (hidden) this.stopVoices();
    this.notify();
  }

  async unlock(): Promise<boolean> {
    if (this.muted) return false;
    if (!this.context || this.context.state === "closed") {
      const Ctor = audioContextCtor();
      if (!Ctor) return false;
      try {
        this.context = new Ctor();
        this.noiseBuffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.5), this.context.sampleRate);
        const samples = this.noiseBuffer.getChannelData(0);
        let seed = 1319;
        for (let i = 0; i < samples.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
          samples[i] = (seed >>> 0) / 2147483648 - 1;
        }
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -9;
        limiter.knee.value = 6;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.12;
        this.master.connect(limiter).connect(this.context.destination);
        this.context.onstatechange = () => this.notify();
        // Start a silent buffer synchronously inside the gesture for WebKit.
        const warmup = this.context.createBufferSource();
        warmup.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
        warmup.connect(this.master);
        warmup.onended = () => warmup.disconnect();
        warmup.start();
      } catch {
        if (this.context) void this.context.close().catch(() => {});
        this.context = null;
        this.master = null;
        this.noiseBuffer = null;
        this.notify();
        return false;
      }
    }
    // Safari may report `interrupted` after a call or tab switch.
    if (this.context.state !== "running") {
      if (!this.unlockPromise) {
        const context = this.context;
        const pending = context
          .resume()
          .then(() => {
            this.notify();
            return this.context === context && context.state === "running";
          })
          .catch(() => false);
        this.unlockPromise = pending;
        void pending.finally(() => {
          if (this.unlockPromise === pending) this.unlockPromise = null;
        });
      }
      return this.unlockPromise;
    }
    this.notify();
    return this.getReady();
  }

  play(cue: BattleCue): boolean {
    const context = this.context;
    const master = this.master;
    if (!this.getReady() || !context || !master) return false;
    const layers = percussion[cue] ? [...toneSpecs[cue], percussion[cue]!] : toneSpecs[cue];
    const now = context.currentTime;
    const last = this.lastPlayed.get(cue) ?? -Infinity;
    if (now - last < cueGap[cue]) return false;
    if (cue === "start" || cue === "victory" || cue === "defeat" || cue === "draw") this.stopVoices();
    if (this.activeVoices + layers.length > BATTLE_AUDIO_VOICE_LIMIT) return false;
    this.lastPlayed.set(cue, now);
    for (const spec of layers) this.playTone(spec);
    return true;
  }

  dispose(): void {
    const context = this.context;
    this.stopVoices();
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.unlockPromise = null;
    this.lastPlayed.clear();
    this.activeVoices = 0;
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => {});
    }
    this.notify();
  }

  private stopVoices(): void {
    for (const voice of this.voices) {
      try { voice.stop(); } catch { /* A source may already have ended. */ }
      voice.disconnect();
    }
    this.voices.clear();
    this.activeVoices = 0;
  }

  private playTone(spec: ToneSpec): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const oscillator = spec.noise ? context.createBufferSource() : context.createOscillator();
    const gain = context.createGain();
    let filter: BiquadFilterNode | null = null;
    if ("frequency" in oscillator) {
      oscillator.type = spec.type;
    } else {
      // Reuse deterministic local noise, never allocate it during combat or
      // consume authoritative RNG. Each source still has its own envelope.
      oscillator.buffer = this.noiseBuffer;
      filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = spec.frequency;
      oscillator.connect(filter).connect(gain);
    }
    // Allocate nodes before choosing the start time. A short lookahead keeps
    // tiny UI transients out of the past when the render thread is busy.
    const start = context.currentTime + 0.015 + (spec.delay ?? 0);
    const end = start + spec.duration;
    if ("frequency" in oscillator) {
      oscillator.frequency.setValueAtTime(spec.frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, spec.endFrequency ?? spec.frequency), end);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, spec.gain), start + Math.min(0.018, spec.duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    if (!filter) oscillator.connect(gain);
    gain.connect(master);
    this.voices.add(oscillator);
    this.activeVoices += 1;
    oscillator.onended = () => {
      if (this.voices.delete(oscillator)) this.activeVoices = Math.max(0, this.activeVoices - 1);
      oscillator.disconnect();
      gain.disconnect();
      filter?.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }
}

