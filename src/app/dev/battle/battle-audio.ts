import type { AckMessage, BattleFrame, FrameEvent } from "@/lib/battle-protocol";
import { combatEventKey } from "./combat-vfx";

export type BattleCue =
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
}

const toneSpecs: Record<BattleCue, ToneSpec[]> = {
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

export class BattleAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly lastPlayed = new Map<BattleCue, number>();
  private activeVoices = 0;
  private muted: boolean;
  private volume: number;
  private unlockPromise: Promise<boolean> | null = null;
  private pageHidden = false;

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
  }

  setPageHidden(hidden: boolean): void {
    this.pageHidden = hidden;
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted || hidden ? 0 : this.volume, this.context.currentTime, 0.015);
  }

  async unlock(): Promise<boolean> {
    if (this.muted) return false;
    if (!this.context) {
      const Ctor = audioContextCtor();
      if (!Ctor) return false;
      try {
        this.context = new Ctor();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.context.destination);
      } catch {
        this.context = null;
        this.master = null;
        return false;
      }
    }
    if (this.context.state === "suspended") {
      if (!this.unlockPromise) {
        const context = this.context;
        const pending = context
          .resume()
          .then(() => context.state === "running")
          .catch(() => false);
        this.unlockPromise = pending;
        void pending.finally(() => {
          if (this.unlockPromise === pending) this.unlockPromise = null;
        });
      }
      return this.unlockPromise;
    }
    return this.context.state === "running";
  }

  play(cue: BattleCue): boolean {
    const context = this.context;
    const master = this.master;
    if (this.muted || this.pageHidden || !context || !master || this.activeVoices >= 10) return false;
    if (context.state !== "running") {
      if (this.unlockPromise) void this.unlockPromise.then((ready) => ready && this.play(cue));
      return false;
    }
    const now = context.currentTime;
    const last = this.lastPlayed.get(cue) ?? -Infinity;
    if (now - last < cueGap[cue]) return false;
    this.lastPlayed.set(cue, now);
    for (const spec of toneSpecs[cue]) this.playTone(spec);
    return true;
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    this.master = null;
    this.unlockPromise = null;
    this.lastPlayed.clear();
    this.activeVoices = 0;
    if (context) void context.close().catch(() => {});
  }

  private playTone(spec: ToneSpec): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const start = context.currentTime + (spec.delay ?? 0);
    const end = start + spec.duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, spec.endFrequency ?? spec.frequency), end);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, spec.gain), start + Math.min(0.018, spec.duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(master);
    this.activeVoices += 1;
    oscillator.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }
}

