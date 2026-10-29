// B3.1 battle network contract. Client-safe: no engine, crypto or DB imports.
// The server owns all combat state; clients only send intents below and
// render the per-seat frames they receive.

import { z } from "zod";

export const BATTLE_ROOM = "battle";
export const BATTLE_QUEUE_ROOM = "battle_queue";
export const BATTLE_RANKED_QUEUE_ROOM = "battle_queue_ranked";
export const BATTLE_PRACTICE_ROOM = "battle_practice";

/** Authoritative match identity: server-chosen, never a client label. */
export type MatchMode = "private" | "matchmaking" | "ranked" | "practice";
/** Which queue a ticket waits in. Unranked tickets use the casual queue. */
export type QueueMode = "unranked" | "ranked";
/** Practice bot difficulty. Server-validated at room creation; omitted means Medium. */
export type PracticeDifficulty = "medium" | "hard" | "ultimate";
/** Supported Practice room creation difficulties, in ascending strength. */
export const PRACTICE_DIFFICULTIES: readonly PracticeDifficulty[] = ["medium", "hard", "ultimate"] as const;
/** Room creation options for battle_practice. Difficulty only; everything else is server-owned. */
export interface PracticeCreateOptions {
  difficulty?: PracticeDifficulty;
}
/** Server-owned Practice opponent. Never a human username, never a players row. */
export interface PracticeOpponent {
  kind: "bot";
  botId: string;
  difficulty: PracticeDifficulty;
  displayName: "AI Opponent";
  /** Solo practice vs server-assigned Unranked fallback. Defaults to practice when omitted. */
  source?: "practice" | "unranked-fallback";
}
export const BATTLE_PROTOCOL_VERSION = "b3.1" as const;

/** Structural copy of a Colyseus seat reservation (client-safe). */
export interface SeatReservation {
  name: string;
  sessionId: string;
  roomId: string;
  publicAddress?: string;
  processId?: string;
  reconnectionToken?: string;
  devMode?: boolean;
}

/** Server-owned Unranked AI fallback wait before a lone ticket gets a bot. */
export const UNRANKED_FALLBACK_DELAY_MS = 20_000 as const;
/** Difficulties the Unranked fallback may assign. Never ultimate. */
export const UNRANKED_FALLBACK_DIFFICULTIES = ["medium", "hard"] as const;
/** Sent on the queue socket while a ticket waits. */
export interface QueueStatusMessage {
  state: "searching";
  waiting: number;
  /** Epoch ms when this ticket joined the queue. */
  since: number;
  /** Present while an Unranked AI fallback is armed for this ticket. */
  fallback?: { scheduledInMs: number };
}

/** Sent once per matched player; consume the reservation to enter the room. */
export interface MatchFoundMessage {
  reservation: SeatReservation;
  opponent: string;
  /** Authoritative queue the pair came from. */
  mode: QueueMode;
  /** Present only when the server assigned an Unranked AI opponent. */
  fallback?: { botId: string; difficulty: "medium" | "hard"; source: "unranked-fallback" };
}

/** The ticket waited too long; the queue socket is closed after this. */
export interface QueueTimeoutMessage {
  reason: string;
}

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("deploy"), cid: z.string().min(1).max(40), cardId: z.string().min(1).max(60), x: z.number().int().min(0).max(100), y: z.number().int().min(0).max(160) }).strict(),
  z.object({ type: z.literal("ability"), cid: z.string().min(1).max(40), abilityId: z.string().min(1).max(80) }).strict(),
]);
export type ClientCommand = z.infer<typeof clientCommandSchema>;

// Client-safe copies of the chain constants the loadout picker needs. A test
// asserts these equal src/lib/chain.ts; never import chain.ts (viem) here.
export const COMMANDER_CLASS_CHOICES = ["bulwark", "reaver", "deadeye", "scout", "warden"] as const;
export const CHOG_GENESIS_CHAIN_ID = 143;
export const CHOG_GENESIS_CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";

export const commanderChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("free"), class: z.enum(COMMANDER_CLASS_CHOICES) }).strict(),
  z
    .object({
      kind: z.literal("nft"),
      chainId: z.number().int(),
      contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      tokenId: z.string().regex(/^\d{1,78}$/),
    })
    .strict(),
]);
export type CommanderChoice = z.infer<typeof commanderChoiceSchema>;

/** Player-built loadout: 7 distinct ordinary cards + one commander claim. */
export const readySchema = z
  .object({
    cards: z.array(z.string().min(1).max(60)).length(7),
    commander: commanderChoiceSchema,
  })
  .strict();
export type ReadyMessage = z.infer<typeof readySchema>;

export type SessionPhase = "waiting" | "active" | "finished" | "aborted";
export type Seat = 0 | 1;

/** Who a commander is and how the server proved the right to field it. */
export interface CommanderIdentity {
  kind: "free" | "nft";
  commanderId: string;
  cardId: string;
  class: string;
  variant: string;
  prestige: string;
  name: string;
  /** Chog Genesis token id for NFT commanders (differs from display names), null for free. */
  tokenId: string | null;
  /** Original metadata image URI (ipfs:// or https), verbatim. */
  imageOriginal: string | null;
  rulesetVersion: string;
  derivationHash: string;
  /** "direct-owner" = verified linked wallet holds the token onchain.
   * "borrowed" = an active P5f.1 loan delegates use to a friend; the NFT
   * stays in the owner's wallet and ownership is re-proven at match start. */
  basis: "free" | "direct-owner" | "borrowed";
  /** ISO time of the last successful ownership check, null for free. */
  verifiedAt: string | null;
}

export interface LobbyMessage {
  phase: SessionPhase;
  you: number;
  /** True once both players confirmed and the server is re-verifying; loadouts can no longer change. */
  locked: boolean;
  /** Ready flags only. Opponent deck and commander are never exposed. */
  players: Array<{ username: string; ready: boolean }>;
  /** Present only in Practice rooms. The bot is never a players row. */
  practice?: { opponent: PracticeOpponent };
  /** The ordinary (non-commander, deckable) cards. */
  catalog: CardInfo[];
  /** Suggested loadouts, convenience only. */
  presets: Record<string, { cards: string[]; commanderClass: string }>;
  /** Own confirmed loadout, null until ready. */
  mine: { cards: string[]; commander: CommanderIdentity } | null;
  /** Present only in queue-created rooms. Server-set, never a client label. */
  match?: { opponent: string | null; /** epoch ms */ deadlineAt: number; mode: MatchMode };
}

export interface CardInfo {
  id: string;
  name: string;
  cost: number;
  kind: "troop" | "spell" | "building" | "commander";
  air: boolean;
  radius: number;
  description: string;
}

export interface StartMessage {
  protocol: typeof BATTLE_PROTOCOL_VERSION;
  /** Authoritative match identity chosen by the server at room creation. */
  mode: MatchMode;
  /** Present only in Practice rooms. Human-vs-AI provenance, preserved through reconnect. */
  opponentKind?: "human" | "bot";
  practiceOpponent?: PracticeOpponent;
  ruleset: string;
  arena: string;
  seat: Seat;
  /** Own server-verified username. Optional because older servers omit it. */
  self?: string;
  opponent: string;
  deck: string[];
  /** Own commander identity. The opponent's is never sent. */
  commander: CommanderIdentity;
  /** The indexed Chog Genesis patron locked for this match. Public metadata only. */
  patron: { tokenId: string; name: string | null; tier: string | null; theme: string };
  catalog: Record<string, CardInfo>;
  geometry: {
    width: number;
    height: number;
    river: { minY: number; maxY: number };
    bridges: Array<{ id: string; minX: number; maxX: number }>;
    ford: { minX: number; maxX: number };
    zones: Record<string, { minY: number; maxY: number }>;
    ownTerritory: { minY: number; maxY: number };
    /** Deploy bounds for client-side placement hints only. The server still validates every deploy. */
    deploy: { minX: number; maxX: number; laneSplitX: number; pocketDepth: number };
  };
  durationTicks: number;
  overtimeTicks: number;
  ticksPerSecond: number;
  /** Secret seat-recovery token, rotated on every resume. Never shared. */
  resumeToken: string;
  /** True when this start message answers a resume, not a fresh start. */
  resumed: boolean;
  /** How long a dropped seat stays reservable, in ms. */
  reconnectGraceMs: number;
}

/** Sent to the connected player when the opponent's socket state changes. */
export interface PresenceMessage {
  opponentConnected: boolean;
  /** Epoch ms deadline for the drop's grace window, null when connected. */
  reconnectDeadlineAt: number | null;
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
  /** Spawner buildings only: next due wave tick and waves remaining. */
  nextSpawnAt?: number;
  spawnsLeft?: number;
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
  impacts: Array<{ id: string; owner: Seat; cardId: string; x: number; y: number; impactTick: number; radius?: number }>;
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
  /** Server-issued durable match id, present whether or not settlement runs. */
  matchId: string | null;
  /** Present only in Practice rooms. No rewards, no settlement, no progression writes. */
  practice?: { opponentKind: "bot"; noReward: true; source?: "practice" | "unranked-fallback" };
}

/** Server-authoritative Unranked fallback Gold outcome, sent after `end` when evaluated.
 * The frontend must never guess rewards from victory or defeat alone. Solo
 * Practice never receives this message and always earns zero. */
export interface BotGoldMessage {
  matchId: string | null;
  source: "unranked-fallback";
  eligibility: "eligible" | "practice-earns-zero" | "short-match" | "too-few-deploys" | "replay-mismatch" | "duplicate" | "capped";
  policyVersion: number;
  /** Confirmed spendable Gold. Zero unless status is confirmed. */
  amount: number;
  status: "confirmed" | "pending" | "refused" | "capped";
  /** Bot matches rewarded to this player today (UTC), including this one when confirmed. */
  rewardedToday: number;
  dailyCap: number;
}

/** Server-authoritative Unranked fallback Card XP outcome, sent after end when evaluated. The frontend must never guess progression from victory or defeat alone. Solo Practice never receives this message and always earns zero. */
export interface BotCardXpMessage {
  matchId: string | null;
  source: "unranked-fallback";
  eligibility: "eligible" | "practice-earns-zero" | "not-xp-eligible" | "short-match" | "too-few-deploys" | "replay-mismatch" | "duplicate" | "awaiting-gold" | "capped";
  policyVersion: number;
  totalXp: number;
  status: "confirmed" | "pending" | "refused" | "capped";
  awardedCards: Array<{ cardId: string; deployments: number; xp: number }>;
  rewardedToday: number;
  dailyCap: number;
}

/** Server-authoritative Player Account XP outcome, sent after `end` once the
 * durable award outcome is known. The frontend must never calculate rewards
 * from victory or defeat alone. A duplicated confirmed receipt repeats the
 * original award and never implies a second award. Solo Practice and private
 * rooms never receive a confirmed receipt. Level snapshots are
 * counterfactual against the additive ledger (total excluding this award
 * versus total including it), so concurrent awards attribute each threshold
 * crossing exactly once and duplicates repeat identical snapshots. */
export interface AccountXpMessage {
  matchId: string;
  source: "matchmaking" | "unranked-fallback";
  policyVersion: number;
  status: "confirmed" | "pending" | "refused" | "capped";
  /** Machine-readable award outcome. */
  eligibility: string;
  /** This player's own result, null unless the match verified. */
  result: "win" | "loss" | "draw" | null;
  /** Confirmed Account XP. Positive only when status is confirmed. */
  amount: number;
  /** The awarded player's id. Clients must ignore receipts for other players. */
  playerId: string;
  /** Lifetime Account XP after this award, null when unproven. */
  totalXp: number | null;
  /** Level derived from lifetime XP excluding this award, null when unproven. */
  levelBefore: number | null;
  /** Level derived from lifetime XP including this award, null when unproven. */
  levelAfter: number | null;
  /** True only when this award provably crossed a level threshold. */
  leveledUp: boolean | null;
}

/** Durable settlement status, sent after `end` once the service reports back. */
export interface SettlementMessage {
  matchId: string | null;
  status: "settled" | "already-settled" | "pending" | "refused" | "disabled";
}

export interface AbortMessage {
  reason: string;
}
