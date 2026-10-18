// B3.1 battle network contract. Client-safe: no engine, crypto or DB imports.
// The server owns all combat state; clients only send intents below and
// render the per-seat frames they receive.

import { z } from "zod";

export const BATTLE_ROOM = "battle";
export const BATTLE_PROTOCOL_VERSION = "b3.1" as const;

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("deploy"), cid: z.string().min(1).max(40), cardId: z.string().min(1).max(60), x: z.number().int().min(0).max(100), y: z.number().int().min(0).max(160) }).strict(),
  z.object({ type: z.literal("ability"), cid: z.string().min(1).max(40), abilityId: z.string().min(1).max(80) }).strict(),
]);
export type ClientCommand = z.infer<typeof clientCommandSchema>;

export const readySchema = z.object({ deck: z.string().min(1).max(40) }).strict();

export type SessionPhase = "waiting" | "active" | "finished" | "aborted";
export type Seat = 0 | 1;

export interface LobbyMessage {
  phase: SessionPhase;
  you: number;
  players: Array<{ username: string; ready: boolean; deck: string | null }>;
  decks: Record<string, string[]>;
}

export interface CardInfo {
  id: string;
  name: string;
  cost: number;
  kind: "troop" | "spell" | "building" | "commander";
  air: boolean;
  radius: number;
}

export interface StartMessage {
  protocol: typeof BATTLE_PROTOCOL_VERSION;
  ruleset: string;
  arena: string;
  seat: Seat;
  opponent: string;
  deck: string[];
  catalog: Record<string, CardInfo>;
  geometry: {
    width: number;
    height: number;
    river: { minY: number; maxY: number };
    bridges: Array<{ id: string; minX: number; maxX: number }>;
    ford: { minX: number; maxX: number };
    zones: Record<string, { minY: number; maxY: number }>;
    ownTerritory: { minY: number; maxY: number };
  };
  durationTicks: number;
  overtimeTicks: number;
  ticksPerSecond: number;
}

export interface UnitView {
  id: string;
  owner: Seat;
  cardId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  air: boolean;
  shield: number;
}
export interface CommanderView extends UnitView {
  cls: string;
}
export interface StructureView {
  id: string;
  owner: Seat;
  kind: "tower" | "core";
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}
export interface BuildingView {
  id: string;
  owner: Seat;
  cardId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  footprint: number;
  expiresAt: number;
}
export interface AbilityView {
  abilityId: string;
  cost: number;
  readyAt: number;
  cooldownTicks: number;
  activeUntil: number | null;
  ready: boolean;
  blockedBy: string | null;
}
export interface ChaosView {
  id: string;
  family: string;
  name: string;
  state: "warning" | "active";
  activationTick: number;
  expireTick: number;
  /** Ranked (side-neutral) zones, or empty when board-wide. */
  zones: string[];
}
/** Public, seat-safe gameplay events (no opponent rejections, no seed). */
export type FrameEvent = { type: string; tick: number; [k: string]: unknown };

export interface BattleFrame {
  tick: number;
  phase: "active" | "overtime" | "final";
  clockTicks: number;
  crowns: [number, number];
  /** Own economy only. Opponent energy, hand and queue are never sent. */
  energy: number;
  energyProgress: number;
  regenMult: number;
  hand: string[];
  next: string | null;
  abilities: AbilityView[];
  troops: UnitView[];
  commanders: CommanderView[];
  structures: StructureView[];
  buildings: BuildingView[];
  projectiles: Array<{ id: string; owner: Seat; x: number; y: number; targetId: string }>;
  impacts: Array<{ id: string; owner: Seat; cardId: string; x: number; y: number; impactTick: number }>;
  chaos: ChaosView[];
  riftOpen: boolean;
  events: FrameEvent[];
}

export interface AckMessage {
  cid: string;
  ok: boolean;
  reason: string | null;
  tick: number;
}

export interface EndMessage {
  result: "win" | "loss" | "draw";
  reason: string | null;
  crowns: [number, number];
  ticks: number;
  replayIdentical: boolean;
  stateHash: string;
  commands: number;
}

export interface AbortMessage {
  reason: string;
}
