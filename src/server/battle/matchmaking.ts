// B3.2b unranked matchmaking plus the P1b.1 ranked queue. MatchCoordinator
// is the single authoritative in-memory queue: this design assumes ONE
// battle-server process (the dev alpha topology). A multi-process
// deployment would need shared presence, which is a later slice. Queue
// tickets, in-match pins and one-shot match keys live here. The two queue
// rooms (casual + ranked) are thin adapters sharing the one coordinator,
// so one player can never hold two tickets at once and ranked tickets only
// ever pair with ranked tickets.

import { randomBytes } from "crypto";
import { matchMaker, Room, ServerError, type Client } from "@colyseus/core";
import { BATTLE_PRACTICE_ROOM, BATTLE_QUEUE_ROOM, BATTLE_RANKED_QUEUE_ROOM, BATTLE_ROOM, UNRANKED_FALLBACK_DELAY_MS, UNRANKED_FALLBACK_DIFFICULTIES, type MatchFoundMessage, type MatchMode, type QueueMode, type QueueStatusMessage, type SeatReservation } from "@/lib/battle-protocol";
import { logger } from "@/lib/logger";
import type { SeatPlayer } from "@/server/battle/session";
import { authenticateSeat, type BattleRoomDeps } from "@/server/battle/room";

export interface FallbackRoomHandle {
  roomId: string;
  reserve: (player: SeatPlayer) => Promise<SeatReservation>;
}

/** Server-owned Unranked AI fallback. Gated OFF unless explicitly enabled. */
export interface HumanRoomHandle {
  roomId: string;
  reserve: (player: SeatPlayer) => Promise<SeatReservation>;
}

export interface MatchCoordinatorFallbackDeps {
  /** Master switch. Default false: lone tickets wait for humans only. */
  enabled?: boolean;
  /** Lone-ticket wait before a bot is assigned. Default 20 seconds. */
  delayMs?: number;
  /** Conservative cap on simultaneous server-owned bot battles. */
  maxRooms?: number;
  /** Random source for the 50/50 medium/hard roll. Injectable for tests. */
  random?: () => number;
  /** Room factory. Default uses matchMaker; tests inject a stub. */
  createBotRoom?: (difficulty: "medium" | "hard", fallbackKey: string) => Promise<FallbackRoomHandle>;
  /** Human room factory. Default uses matchMaker; tests inject a stub. */
  createHumanRoom?: (matchKey: string) => Promise<HumanRoomHandle>;
}

export interface MatchCoordinatorDeps {
  /** Max time a ticket may wait before `queue_timeout`. Default 5 minutes. */
  maxWaitMs?: number;
  /** Delay between `match_found` and closing the queue socket. */
  closeDelayMs?: number;
  /** Unranked AI fallback. Absent or disabled means human-only matchmaking. */
  fallback?: MatchCoordinatorFallbackDeps;
}

interface Ticket {
  ticketId: string;
  player: SeatPlayer;
  /** Which queue this ticket waits in. Set once at enqueue, never changed. */
  mode: QueueMode;
  enqueuedAt: number;
  state: "waiting" | "matching";
  /** Server-owned Unranked fallback deadline. Cleared on pair/cancel/timeout. */
  fallbackTimer?: ReturnType<typeof setTimeout>;
  send: (type: string, msg: unknown) => void;
  close: () => void;
  expires: ReturnType<typeof setTimeout>;
}

export interface PendingFallback {
  /** The lone human the bot room is reserved for. */
  playerId: string;
  username: string;
  /** Server-rolled difficulty. Never ultimate, never client-chosen. */
  difficulty: "medium" | "hard";
}

export interface PendingMatch {
  players: [string, string];
  usernames: Record<string, string>;
  /** Authoritative queue the pair came from. The battle room turns this
   * into its MatchMode (ranked vs matchmaking); clients never choose it. */
  mode: QueueMode;
}

const DEFAULT_MAX_WAIT_MS = 300_000;
const DEFAULT_CLOSE_DELAY_MS = 1_000;
const DEFAULT_FALLBACK_MAX_ROOMS = 8;

/** One activity per player: a queue ticket OR a live battle room seat. */
type Activity = { kind: "queue"; ticketId: string } | { kind: "room"; roomId: string };

export class MatchCoordinator {
  /** playerId -> open queue ticket. At most one per player. */
  private readonly tickets = new Map<string, Ticket>();
  /** playerId -> their single live activity. */
  private readonly activities = new Map<string, Activity>();
  /** One-shot keys handed to BattleRoom.onCreate via createRoom options. */
  private readonly pendingMatches = new Map<string, PendingMatch>();
  /** One-shot keys handed to PracticeRoom.onCreate for fallback rooms. */
  private readonly pendingFallbacks = new Map<string, PendingFallback>();
  /** Fallback keys with a room create/reserve in flight. Counted toward capacity. */
  private readonly fallbackInFlight = new Set<string>();
  /** Live server-owned bot rooms, for the conservative capacity cap. */
  private readonly fallbackRooms = new Map<string, string>();
  private readonly maxWaitMs: number;
  private readonly closeDelayMs: number;
  private readonly fallbackEnabled: boolean;
  private readonly fallbackDelayMs: number;
  private readonly maxFallbackRooms: number;
  private readonly fallbackRandom: () => number;
  private readonly createBotRoom: (difficulty: "medium" | "hard", fallbackKey: string) => Promise<FallbackRoomHandle>;
  private readonly createHumanRoom: (matchKey: string) => Promise<HumanRoomHandle>;

  constructor(deps: MatchCoordinatorDeps = {}) {
    this.maxWaitMs = deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.closeDelayMs = deps.closeDelayMs ?? DEFAULT_CLOSE_DELAY_MS;
    this.fallbackEnabled = deps.fallback?.enabled ?? false;
    this.fallbackDelayMs = deps.fallback?.delayMs ?? UNRANKED_FALLBACK_DELAY_MS;
    this.maxFallbackRooms = deps.fallback?.maxRooms ?? DEFAULT_FALLBACK_MAX_ROOMS;
    this.fallbackRandom = deps.fallback?.random ?? Math.random;
    this.createBotRoom = deps.fallback?.createBotRoom ?? (async (difficulty, fallbackKey) => {
      const room = await matchMaker.createRoom(BATTLE_PRACTICE_ROOM, { difficulty, fallbackKey });
      return { roomId: room.roomId, reserve: (player) => matchMaker.reserveSeatFor(room, {}, player) };
    });
    this.createHumanRoom = deps.fallback?.createHumanRoom ?? (async (matchKey) => {
      const room = await matchMaker.createRoom(BATTLE_ROOM, { matchKey });
      return { roomId: room.roomId, reserve: (player) => matchMaker.reserveSeatFor(room, {}, player) };
    });
  }

  get waitingCount(): number {
    let n = 0;
    for (const t of this.tickets.values()) if (t.state === "waiting") n++;
    return n;
  }

  /** Simultaneous server-owned bot battles currently live. */
  get fallbackRoomCount(): number {
    return this.fallbackRooms.size;
  }

  /** Fallback wait for a queue mode, or null when no fallback is armed. */
  fallbackDelayFor(mode: QueueMode): number | null {
    return this.fallbackEnabled && mode === "unranked" ? this.fallbackDelayMs : null;
  }

  /** Waiting tickets in one queue only, so each lobby shows its own count. */
  waitingCountFor(mode: QueueMode): number {
    let n = 0;
    for (const t of this.tickets.values()) if (t.state === "waiting" && t.mode === mode) n++;
    return n;
  }

  /** Join one queue and immediately attempt to pair. Throws on conflicts.
   * A player holding any ticket or room pin cannot take a second ticket,
   * in either queue. */
  enqueue(player: SeatPlayer, send: Ticket["send"], close: Ticket["close"], mode: QueueMode = "unranked"): Ticket {
    const act = this.activities.get(player.playerId);
    if (act?.kind === "queue") throw new ServerError(409, "Already searching");
    if (act?.kind === "room") throw new ServerError(409, "Already in a battle");
    const ticket: Ticket = {
      ticketId: randomBytes(16).toString("hex"),
      player,
      mode,
      enqueuedAt: Date.now(),
      state: "waiting",
      send,
      close,
      expires: setTimeout(() => this.expire(player.playerId), this.maxWaitMs),
    };
    this.tickets.set(player.playerId, ticket);
    this.activities.set(player.playerId, { kind: "queue", ticketId: ticket.ticketId });
    this.pair();
    this.armFallback(ticket);
    return ticket;
  }

  /** Remove a ticket; a stale onLeave from an old socket cannot cancel a newer ticket. */
  cancel(playerId: string, ticketId: string): void {
    const t = this.tickets.get(playerId);
    if (!t || t.ticketId !== ticketId) return;
    clearTimeout(t.expires);
    this.clearFallbackTimer(t);
    this.tickets.delete(playerId);
    const act = this.activities.get(playerId);
    if (act?.kind === "queue" && act.ticketId === ticketId) this.activities.delete(playerId);
  }

  /**
   * Pin a player to a battle room. Idempotent for the same roomId (matched
   * reservations pre-pin it at match_found); rejects while the player holds
   * any other activity.
   */
  claimRoom(playerId: string, roomId: string): void {
    const act = this.activities.get(playerId);
    if (!act) {
      this.activities.set(playerId, { kind: "room", roomId });
      return;
    }
    if (act.kind === "room" && act.roomId === roomId) return;
    throw new ServerError(409, act.kind === "queue" ? "Already searching" : "Already in a battle");
  }

  /** Free one player's room pin, only when it still points at this room. */
  releaseRoom(playerId: string, roomId: string): void {
    const act = this.activities.get(playerId);
    if (act?.kind === "room" && act.roomId === roomId) this.activities.delete(playerId);
  }

  /** BattleRoom.onCreate consumes a key exactly once. Returns null for forged or consumed keys. */
  claimMatch(matchKey: string): PendingMatch | null {
    const m = this.pendingMatches.get(matchKey);
    if (!m) return null;
    this.pendingMatches.delete(matchKey);
    return m;
  }

  /** Free both players' room pins when the room ends, aborts or disposes. Idempotent. */
  release(roomId: string): void {
    for (const [pid, act] of this.activities) if (act.kind === "room" && act.roomId === roomId) this.activities.delete(pid);
  }

  /** PracticeRoom.onCreate consumes a fallback key exactly once. Null for forged or consumed keys. */
  claimFallback(fallbackKey: string): PendingFallback | null {
    const f = this.pendingFallbacks.get(fallbackKey);
    if (!f) return null;
    this.pendingFallbacks.delete(fallbackKey);
    return f;
  }

  /** PracticeRoom registers its fallback room; false at capacity (room creation must fail). */
  registerFallbackRoom(roomId: string): boolean {
    if (this.fallbackRooms.size + this.fallbackInFlight.size > this.maxFallbackRooms) return false;
    this.fallbackRooms.set(roomId, roomId);
    return true;
  }

  /** PracticeRoom releases its fallback room on dispose. Idempotent. */
  releaseFallbackRoom(roomId: string): void {
    this.fallbackRooms.delete(roomId);
  }

  /** Test/server shutdown helper: expire every ticket and drop all state. */
  dispose(): void {
    for (const t of this.tickets.values()) {
      clearTimeout(t.expires);
      this.clearFallbackTimer(t);
    }
    this.tickets.clear();
    this.activities.clear();
    this.pendingMatches.clear();
    this.pendingFallbacks.clear();
    this.fallbackInFlight.clear();
    this.fallbackRooms.clear();
  }

  private expire(playerId: string): void {
    const t = this.tickets.get(playerId);
    if (!t || t.state !== "waiting") return;
    this.clearFallbackTimer(t);
    this.tickets.delete(playerId);
    const act = this.activities.get(playerId);
    if (act?.kind === "queue" && act.ticketId === t.ticketId) this.activities.delete(playerId);
    t.send("queue_timeout", { reason: "No opponent found in time. Search again." });
    t.close();
    this.pair();
  }

  /** Arm the server-owned fallback deadline for a waiting unranked ticket. No-op otherwise. */
  private armFallback(t: Ticket): void {
    if (!this.fallbackEnabled || t.mode !== "unranked" || t.state !== "waiting") return;
    if (t.fallbackTimer) return;
    t.fallbackTimer = setTimeout(() => this.maybeFallback(t.player.playerId), this.fallbackDelayMs);
  }

  private clearFallbackTimer(t: Ticket): void {
    if (t.fallbackTimer) {
      clearTimeout(t.fallbackTimer);
      t.fallbackTimer = undefined;
    }
  }

  /** A fallback ticket survives only while it is still this matching claim. */
  private surviveFallback(t: Ticket): boolean {
    return this.tickets.get(t.player.playerId) === t && t.state === "matching";
  }

  /** Server-owned 50/50 medium/hard roll. Never ultimate, never client-chosen. */
  private pickFallbackDifficulty(): "medium" | "hard" {
    return UNRANKED_FALLBACK_DIFFICULTIES[this.fallbackRandom() < 0.5 ? 0 : 1]!;
  }

  /**
   * Fallback deadline for one ticket. Claims the ticket synchronously so a
   * human pairing in the same tick always wins: pair() marks both tickets
   * "matching" first, and a claimed ticket is invisible to every other path.
   */
  private maybeFallback(playerId: string): void {
    const t = this.tickets.get(playerId);
    if (!t || t.state !== "waiting" || t.mode !== "unranked" || !this.fallbackEnabled) return;
    t.state = "matching";
    this.clearFallbackTimer(t);
    void this.runFallback(t);
  }

  private async runFallback(t: Ticket): Promise<void> {
    const id = t.player.playerId;
    if (!this.surviveFallback(t)) return;
    if (this.fallbackRooms.size + this.fallbackInFlight.size >= this.maxFallbackRooms) {
      // Honest retry: stay queued for a human and try again on the next deadline.
      t.send("queue_status", { state: "searching", waiting: this.waitingCount, since: t.enqueuedAt, fallback: { scheduledInMs: this.fallbackDelayMs } } satisfies QueueStatusMessage);
      this.requeueAfterFallback(t);
      return;
    }
    const difficulty = this.pickFallbackDifficulty();
    const fallbackKey = randomBytes(16).toString("hex");
    this.fallbackInFlight.add(fallbackKey);
    this.pendingFallbacks.set(fallbackKey, { playerId: id, username: t.player.username, difficulty });
    let handle: FallbackRoomHandle;
    try {
      handle = await this.createBotRoom(difficulty, fallbackKey);
      if (!this.surviveFallback(t)) throw new Error("Fallback aborted");
      const reservation = await handle.reserve(t.player);
      if (!this.surviveFallback(t)) throw new Error("Fallback aborted");
      this.fallbackInFlight.delete(fallbackKey);
      this.tickets.delete(id);
      clearTimeout(t.expires);
      this.fallbackRooms.set(handle.roomId, id);
      this.activities.set(id, { kind: "room", roomId: handle.roomId });
      const botId = `practice-${difficulty}-v1`;
      t.send("match_found", { reservation, opponent: "AI Opponent", mode: "unranked", fallback: { botId, difficulty, source: "unranked-fallback" } } satisfies MatchFoundMessage);
      setTimeout(() => {
        t.close();
      }, this.closeDelayMs);
    } catch (e) {
      this.pendingFallbacks.delete(fallbackKey);
      this.fallbackInFlight.delete(fallbackKey);
      if (e instanceof Error && e.message === "Fallback aborted") return;
      logger.error("matchmaking: fallback bot room failed", { roomId: null, error: e instanceof Error ? e.message : String(e) });
      this.requeueAfterFallback(t);
      this.pair();
    }
  }

  /** Back to waiting after a fallback failure or capacity retry. Human pairing runs first. */
  private requeueAfterFallback(t: Ticket): void {
    if (!this.surviveFallback(t)) return;
    t.state = "waiting"; // original enqueuedAt preserved: it keeps its place
    this.armFallback(t);
    t.send("queue_status", { state: "searching", waiting: this.waitingCount, since: t.enqueuedAt, fallback: { scheduledInMs: this.fallbackDelayMs } } satisfies QueueStatusMessage);
    this.pair();
  }

  /**
   * FIFO pairing within each queue. Both tickets are marked "matching"
   * synchronously so a concurrent enqueue can never double-assign a
   * player, then the room is created and seats reserved asynchronously.
   * Ranked tickets only ever pair with ranked tickets.
   */
  private pair(): void {
    for (const mode of ["unranked", "ranked"] as const) {
      while (true) {
        const waiting = [...this.tickets.values()].filter((t) => t.state === "waiting" && t.mode === mode).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
        if (waiting.length < 2) break;
        const [a, b] = waiting as [Ticket, Ticket];
        a.state = "matching";
        b.state = "matching";
        void this.formMatch(a, b);
      }
    }
  }

  private survive(t: Ticket): boolean {
    return this.tickets.get(t.player.playerId) === t && t.state === "matching";
  }

  private requeue(t: Ticket): void {
    if (!this.survive(t)) return;
    t.state = "waiting"; // original enqueuedAt preserved: it keeps its place
    t.send("queue_status", { state: "searching", waiting: this.waitingCount, since: t.enqueuedAt } satisfies QueueStatusMessage);
  }

  private async formMatch(a: Ticket, b: Ticket): Promise<void> {
    if (a.mode !== b.mode) {
      // Defensive: pair() only hands same-mode tickets, but never mint a
      // cross-mode room if that invariant ever breaks.
      this.requeue(a);
      this.requeue(b);
      this.pair();
      return;
    }
    const matchKey = randomBytes(16).toString("hex");
    this.pendingMatches.set(matchKey, {
      players: [a.player.playerId, b.player.playerId],
      usernames: { [a.player.playerId]: a.player.username, [b.player.playerId]: b.player.username },
      mode: a.mode,
    });
    let handle: HumanRoomHandle;
    try {
      handle = await this.createHumanRoom(matchKey);
    } catch (e) {
      this.pendingMatches.delete(matchKey);
      logger.error("matchmaking: createRoom failed", { roomId: null, error: e instanceof Error ? e.message : String(e) });
      this.requeue(a);
      this.requeue(b);
      this.pair();
      return;
    }
    const aOk = this.survive(a);
    const bOk = this.survive(b);
    if (!aOk || !bOk) {
      // One side cancelled while the room was being created. The survivor
      // goes back to waiting; the unjoined room auto-disposes on the seat
      // reservation timeout.
      if (aOk) this.requeue(a);
      if (bOk) this.requeue(b);
      this.pair();
      return;
    }
    try {
      const [resA, resB] = await Promise.all([handle.reserve(a.player), handle.reserve(b.player)]);
      if (!this.survive(a) || !this.survive(b)) {
        if (this.survive(a)) this.requeue(a);
        if (this.survive(b)) this.requeue(b);
        this.pair();
        return;
      }
      this.tickets.delete(a.player.playerId);
      this.tickets.delete(b.player.playerId);
      clearTimeout(a.expires);
      clearTimeout(b.expires);
      this.clearFallbackTimer(a);
      this.clearFallbackTimer(b);
      this.activities.set(a.player.playerId, { kind: "room", roomId: handle.roomId });
      this.activities.set(b.player.playerId, { kind: "room", roomId: handle.roomId });
      a.send("match_found", { reservation: resA, opponent: b.player.username, mode: a.mode });
      b.send("match_found", { reservation: resB, opponent: a.player.username, mode: b.mode });
      setTimeout(() => {
        a.close();
        b.close();
      }, this.closeDelayMs);
    } catch (e) {
      logger.error("matchmaking: seat reservation failed", { roomId: handle.roomId, error: e instanceof Error ? e.message : String(e) });
      this.requeue(a);
      this.requeue(b);
      this.pair();
    }
  }
}

type QueueClient = Client & { auth: SeatPlayer };

/**
 * Queue lobby room base. Clients joinOrCreate it; joining is the enqueue
 * and leaving is the cancel. No client messages are defined. The queue
 * mode comes from the concrete subclass, never from a client option.
 */
export class QueueRoom extends Room {
  static deps: Pick<BattleRoomDeps, "verifier" | "loader"> = {};
  static coordinator: MatchCoordinator | null = null;
  /** Overridden by RankedQueueRoom. Base class is the casual queue. */
  static queueMode: QueueMode = "unranked";
  maxClients = 500;
  /** sessionId -> ticketId so a stale socket can only cancel its own ticket. */
  private readonly ticketIds = new Map<string, string>();

  static async onAuth(token: string | undefined): Promise<SeatPlayer> {
    return authenticateSeat(token, QueueRoom.deps);
  }

  onJoin(client: QueueClient) {
    const coordinator = (this.constructor as typeof QueueRoom).coordinator;
    if (!coordinator) throw new ServerError(503, "Matchmaking unavailable");
    const mode = (this.constructor as typeof QueueRoom).queueMode;
    const ticket = coordinator.enqueue(
      client.auth,
      (type, msg) => client.send(type, msg),
      () => {
        try {
          client.leave();
        } catch {
          /* already closed */
        }
      },
      mode
    );
    this.ticketIds.set(client.sessionId, ticket.ticketId);
    const fallbackInMs = coordinator.fallbackDelayFor(mode);
    client.send(
      "queue_status",
      { state: "searching", waiting: coordinator.waitingCountFor(mode), since: ticket.enqueuedAt, ...(fallbackInMs == null ? {} : { fallback: { scheduledInMs: fallbackInMs } }) } satisfies QueueStatusMessage
    );
  }

  onLeave(client: QueueClient) {
    const ticketId = this.ticketIds.get(client.sessionId);
    this.ticketIds.delete(client.sessionId);
    if (ticketId) (this.constructor as typeof QueueRoom).coordinator?.cancel(client.auth.playerId, ticketId);
  }
}

/** Ranked queue: same coordinator and lifecycle, isolated pairing. */
export class RankedQueueRoom extends QueueRoom {
  static override queueMode: QueueMode = "ranked";

  static override async onAuth(token: string | undefined): Promise<SeatPlayer> {
    return authenticateSeat(token, QueueRoom.deps);
  }
}

export { BATTLE_QUEUE_ROOM, BATTLE_RANKED_QUEUE_ROOM };
export type { MatchMode, QueueMode };
