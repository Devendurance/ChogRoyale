// B3.2b unranked matchmaking. MatchCoordinator is the single authoritative
// in-memory queue: this design assumes ONE battle-server process (the dev
// alpha topology). A multi-process deployment would need shared presence,
// which is a later slice. Queue tickets, in-match pins and one-shot match
// keys live here; the QueueRoom is a thin adapter and every QueueRoom
// instance shares the one coordinator.

import { randomBytes } from "crypto";
import { matchMaker, Room, ServerError, type Client } from "@colyseus/core";
import { BATTLE_QUEUE_ROOM, BATTLE_ROOM, type QueueStatusMessage } from "@/lib/battle-protocol";
import { logger } from "@/lib/logger";
import type { SeatPlayer } from "@/server/battle/session";
import { authenticateSeat, type BattleRoomDeps } from "@/server/battle/room";

export interface MatchCoordinatorDeps {
  /** Max time a ticket may wait before `queue_timeout`. Default 5 minutes. */
  maxWaitMs?: number;
  /** Delay between `match_found` and closing the queue socket. */
  closeDelayMs?: number;
}

interface Ticket {
  ticketId: string;
  player: SeatPlayer;
  enqueuedAt: number;
  state: "waiting" | "matching";
  send: (type: string, msg: unknown) => void;
  close: () => void;
  expires: ReturnType<typeof setTimeout>;
}

export interface PendingMatch {
  players: [string, string];
  usernames: Record<string, string>;
}

const DEFAULT_MAX_WAIT_MS = 300_000;
const DEFAULT_CLOSE_DELAY_MS = 1_000;

export class MatchCoordinator {
  /** playerId -> open queue ticket. At most one per player. */
  private readonly tickets = new Map<string, Ticket>();
  /** playerId -> battle roomId while a matched room is live. */
  private readonly inMatch = new Map<string, string>();
  /** One-shot keys handed to BattleRoom.onCreate via createRoom options. */
  private readonly pendingMatches = new Map<string, PendingMatch>();
  private readonly maxWaitMs: number;
  private readonly closeDelayMs: number;

  constructor(deps: MatchCoordinatorDeps = {}) {
    this.maxWaitMs = deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.closeDelayMs = deps.closeDelayMs ?? DEFAULT_CLOSE_DELAY_MS;
  }

  get waitingCount(): number {
    let n = 0;
    for (const t of this.tickets.values()) if (t.state === "waiting") n++;
    return n;
  }

  /** Join the queue and immediately attempt to pair. Throws on conflicts. */
  enqueue(player: SeatPlayer, send: Ticket["send"], close: Ticket["close"]): Ticket {
    if (this.tickets.has(player.playerId)) throw new ServerError(409, "Already searching");
    if (this.inMatch.has(player.playerId)) throw new ServerError(409, "Already in a match");
    const ticket: Ticket = {
      ticketId: randomBytes(16).toString("hex"),
      player,
      enqueuedAt: Date.now(),
      state: "waiting",
      send,
      close,
      expires: setTimeout(() => this.expire(player.playerId), this.maxWaitMs),
    };
    this.tickets.set(player.playerId, ticket);
    this.pair();
    return ticket;
  }

  /** Remove a ticket; a stale onLeave from an old socket cannot cancel a newer ticket. */
  cancel(playerId: string, ticketId: string): void {
    const t = this.tickets.get(playerId);
    if (!t || t.ticketId !== ticketId) return;
    clearTimeout(t.expires);
    this.tickets.delete(playerId);
  }

  /** BattleRoom.onCreate consumes a key exactly once. Returns null for forged or consumed keys. */
  claimMatch(matchKey: string): PendingMatch | null {
    const m = this.pendingMatches.get(matchKey);
    if (!m) return null;
    this.pendingMatches.delete(matchKey);
    return m;
  }

  /** Free both players' in-match pins when the room ends, aborts or disposes. Idempotent. */
  release(roomId: string): void {
    for (const [pid, rid] of this.inMatch) if (rid === roomId) this.inMatch.delete(pid);
  }

  /** Test/server shutdown helper: expire every ticket and drop all state. */
  dispose(): void {
    for (const t of this.tickets.values()) clearTimeout(t.expires);
    this.tickets.clear();
    this.inMatch.clear();
    this.pendingMatches.clear();
  }

  private expire(playerId: string): void {
    const t = this.tickets.get(playerId);
    if (!t || t.state !== "waiting") return;
    this.tickets.delete(playerId);
    t.send("queue_timeout", { reason: "No opponent found in time. Search again." });
    t.close();
    this.pair();
  }

  /**
   * FIFO pairing. Both tickets are marked "matching" synchronously so a
   * concurrent enqueue can never double-assign a player, then the room is
   * created and seats reserved asynchronously.
   */
  private pair(): void {
    while (true) {
      const waiting = [...this.tickets.values()].filter((t) => t.state === "waiting").sort((a, b) => a.enqueuedAt - b.enqueuedAt);
      if (waiting.length < 2) return;
      const [a, b] = waiting as [Ticket, Ticket];
      a.state = "matching";
      b.state = "matching";
      void this.formMatch(a, b);
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
    const matchKey = randomBytes(16).toString("hex");
    this.pendingMatches.set(matchKey, {
      players: [a.player.playerId, b.player.playerId],
      usernames: { [a.player.playerId]: a.player.username, [b.player.playerId]: b.player.username },
    });
    let room;
    try {
      room = await matchMaker.createRoom(BATTLE_ROOM, { matchKey });
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
      const [resA, resB] = await Promise.all([matchMaker.reserveSeatFor(room, {}, a.player), matchMaker.reserveSeatFor(room, {}, b.player)]);
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
      this.inMatch.set(a.player.playerId, room.roomId);
      this.inMatch.set(b.player.playerId, room.roomId);
      a.send("match_found", { reservation: resA, opponent: b.player.username });
      b.send("match_found", { reservation: resB, opponent: a.player.username });
      setTimeout(() => {
        a.close();
        b.close();
      }, this.closeDelayMs);
    } catch (e) {
      logger.error("matchmaking: seat reservation failed", { roomId: room.roomId, error: e instanceof Error ? e.message : String(e) });
      this.requeue(a);
      this.requeue(b);
      this.pair();
    }
  }
}

type QueueClient = Client & { auth: SeatPlayer };

/**
 * Queue lobby room. Clients joinOrCreate it; joining is the enqueue and
 * leaving is the cancel. No client messages are defined.
 */
export class QueueRoom extends Room {
  static deps: Pick<BattleRoomDeps, "verifier" | "loader"> = {};
  static coordinator: MatchCoordinator | null = null;
  maxClients = 500;
  /** sessionId -> ticketId so a stale socket can only cancel its own ticket. */
  private readonly ticketIds = new Map<string, string>();

  static async onAuth(token: string | undefined): Promise<SeatPlayer> {
    return authenticateSeat(token, QueueRoom.deps);
  }

  onJoin(client: QueueClient) {
    const coordinator = QueueRoom.coordinator;
    if (!coordinator) throw new ServerError(503, "Matchmaking unavailable");
    const ticket = coordinator.enqueue(
      client.auth,
      (type, msg) => client.send(type, msg),
      () => {
        try {
          client.leave();
        } catch {
          /* already closed */
        }
      }
    );
    this.ticketIds.set(client.sessionId, ticket.ticketId);
    client.send("queue_status", { state: "searching", waiting: coordinator.waitingCount, since: ticket.enqueuedAt } satisfies QueueStatusMessage);
  }

  onLeave(client: QueueClient) {
    const ticketId = this.ticketIds.get(client.sessionId);
    this.ticketIds.delete(client.sessionId);
    if (ticketId) QueueRoom.coordinator?.cancel(client.auth.playerId, ticketId);
  }
}

export { BATTLE_QUEUE_ROOM };
