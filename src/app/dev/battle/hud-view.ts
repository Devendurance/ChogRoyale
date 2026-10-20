// Pure view-model helpers for the B2.8f.1 scoreboard, timer and ability
// control. No Phaser or React imports so every rule stays unit-testable.

import type { AbilityView, BattleFrame, EndMessage } from "@/lib/battle-protocol";

export interface ScoreView {
  mine: number;
  theirs: number;
}

/** Crowns by perspective: the local seat always reads "mine". Once the match
 * ends the authoritative end.crowns wins over the last frame's. */
export function scoreView(frame: BattleFrame | null, end: EndMessage | null, seat: 0 | 1): ScoreView {
  const crowns = end?.crowns ?? frame?.crowns ?? [0, 0];
  return { mine: crowns[seat] ?? 0, theirs: crowns[1 - seat] ?? 0 };
}

// Display-only copy of energyPhaseMult (src/lib/combat.ts); combat.ts imports
// node crypto so it cannot ship to the client. Keep thresholds in sync.
const phaseMult = (tick: number) => (tick >= 2400 ? 3 : tick >= 1200 ? 2 : 1);

const mmss = (ticks: number) => `${Math.floor(ticks / 600)}:${String(Math.floor((ticks % 600) / 10)).padStart(2, "0")}`;

export interface TimerView {
  /** mm:ss remaining. clockTicks is ticks until the phase's authoritative
   * end: 1800 in regulation, 3000 in overtime (session.ts buildFrame). */
  text: string;
  /** Short badge beside the clock, or null. */
  badge: "OT" | "Final" | null;
  /** Energy phase multiplier for the separate badge. */
  mult: 1 | 2 | 3;
}

export function timerView(frame: BattleFrame | null, end: EndMessage | null): TimerView {
  if (end) return { text: mmss(end.ticks), badge: "Final", mult: 1 };
  if (!frame) return { text: "--", badge: null, mult: 1 };
  return {
    text: mmss(frame.clockTicks),
    badge: frame.phase === "overtime" ? "OT" : frame.phase === "final" ? "Final" : null,
    mult: phaseMult(frame.tick + 1) as 1 | 2 | 3,
  };
}

export interface AbilityButtonView {
  label: "READY" | "ACTIVE" | "BLOCKED" | "COOLDOWN";
  /** Cooldown remaining as a 0..1 fraction of the full cooldown (0 = ready). */
  cooldownFrac: number;
  cooldownSecs: number;
  /** Block reason to surface as small text/tooltip, or null. */
  blockedBy: string | null;
  disabled: boolean;
}

export function abilityView(a: AbilityView, tick: number): AbilityButtonView {
  const remaining = Math.max(0, a.readyAt - tick);
  const cooldownFrac = a.cooldownTicks > 0 ? Math.min(1, remaining / a.cooldownTicks) : 0;
  const cooldownSecs = Math.ceil(remaining / 10);
  const active = a.activeUntil !== null && a.activeUntil > tick;
  if (active) return { label: "ACTIVE", cooldownFrac, cooldownSecs, blockedBy: a.blockedBy, disabled: true };
  if (!a.ready) return { label: "COOLDOWN", cooldownFrac, cooldownSecs, blockedBy: a.blockedBy, disabled: true };
  if (a.blockedBy) return { label: "BLOCKED", cooldownFrac: 0, cooldownSecs: 0, blockedBy: a.blockedBy, disabled: true };
  return { label: "READY", cooldownFrac: 0, cooldownSecs: 0, blockedBy: null, disabled: false };
}
