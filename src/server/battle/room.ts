// B3.2a Colyseus adapter around BattleSession. Identity comes only from the
// Privy access token sent in the matchmaking request's Authorization header
// (never the WebSocket URL, never client options). The token is verified and
// the player loaded through the existing B0 guard, so seats are bound to
// server-side player ids. Combat runs only inside BattleSession. Commander
// entitlement is resolved here (onchain ownerOf for NFT claims), re-verified
// after both players confirm, and only then does the session start.
//
// Reconnect policy (B3.2c): only the active phase is resumable. A
// non-consented leave (close code != CONSENTED) marks the seat dropped for
// reconnectGraceMs, keeps the simulation running, unlocks the room and
// disables autoDispose so joinById can deliver a resume. Resume requires the
// seat owner's Privy identity plus the slot's rotating resumeToken (issued in
// StartMessage, rotated on each resume). Consented leave while active aborts
// immediately with no winner, as before.

import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { CloseCode, Room, ServerError, type Client } from "@colyseus/core";
import { requireOnboardedPlayer, type PlayerLoader } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { PrivyTokenVerifier } from "@/lib/privy-server";
import { readySchema, type CommanderChoice } from "@/lib/battle-protocol";
import { BattleSession, type SeatPlayer, type SessionRandom, type TrustedLoadout } from "@/server/battle/session";
import { productionEntitlementDeps, resolveCommander, type EntitlementDeps } from "@/server/battle/entitlement";
import { productionPatronSource, type PatronSource } from "@/server/battle/patron-source";
import type { MatchCoordinator, PendingMatch } from "@/server/battle/matchmaking";
import type { MatchMode } from "@/lib/battle-protocol";
import { recordFromReplay, type SettlementService } from "@/server/battle/settlement";
import { getPurchasedLevels } from "@/db/card-xp";

export interface BattleRoomDeps {
  /** Test-only injection points; production passes none and uses Privy + Neon. */
  verifier?: PrivyTokenVerifier;
  loader?: PlayerLoader;
  rng?: SessionRandom;
  tickMs?: number;
  /** Commander entitlement; defaults to production (live chain + DB reads). */
  entitlement?: EntitlementDeps;
  /** Directory for local replay records (config + commands). Null disables. */
  replayDir?: string | null;
  /** Grace period before a finished/aborted room closes. */
  closeAfterMs?: number;
  /** Deadline for a matched lobby to start; the room aborts past it. */
  matchLobbyMs?: number;
  /** Queue ticket expiry, consumed by the MatchCoordinator. */
  queueMaxWaitMs?: number;
  /** How long a dropped seat stays reservable during an active match. */
  reconnectGraceMs?: number;
  /** Durable settlement service; absent or null disables DB writes. */
  settlement?: SettlementService | null;
  /** Arena Patron source; defaults to the indexed Genesis pool. */
  patrons?: PatronSource;
  /** P2c card stat scaling. Off by default: without it (and without the
   * card XP migration) every match simulates at Level 1, exactly the
   * pre-scaling baseline. Enable explicitly per environment. */
  cardScaling?: boolean;
}

type BattleClient = Client & { auth: SeatPlayer };

const MATCH_LOBBY_MS = 90_000;
const RECONNECT_GRACE_MS = 30_000;

let productionDeps: EntitlementDeps | null = null;
function entitlement(): EntitlementDeps {
  const base = BattleRoom.deps.entitlement ?? (productionDeps ??= productionEntitlementDeps());
  if (base.activeTokenLoan && base.borrowSocialCheck) return base;
  // P5f.1 loan wiring: the NFT path re-verifies any active loan, the
  // friendship and both block directions on every ready and every
  // match-start lock. Lazy DB imports keep unit-stubbed tests hermetic.
  return {
    ...base,
    activeTokenLoan: async (tokenId) => {
      try {
        const { getActiveLoanForToken } = await import("@/db/lending");
        const row = await getActiveLoanForToken(tokenId);
        return row ? { loanId: row.id, ownerId: row.ownerId, borrowerId: row.borrowerId } : null;
      } catch (err) {
        // No-DB harnesses (room tests inject stub deps without routing the
        // DAL): behave as if no loan exists, exactly as before P5f.1.
        // Production always reaches this only after verifiedWallets proved
        // the DB reachable, so genuine outages still fail closed there.
        if (err instanceof Error && err.message.includes("without routeDalToTestDb")) return null;
        throw err;
      }
    },
    borrowSocialCheck: async (ownerId, borrowerId) => {
      const { getAcceptedFriendship } = await import("@/db/friendships");
      const { canSociallyInteract } = await import("@/db/blocks");
      const verdict = await canSociallyInteract(ownerId, borrowerId);
      if (!verdict.allowed) return false;
      return (await getAcceptedFriendship(ownerId, borrowerId)) !== null;
    },
  };
}

let productionPatrons: PatronSource | null = null;
function patronSource(): PatronSource {
  return BattleRoom.deps.patrons ?? (productionPatrons ??= productionPatronSource());
}

/** Shared seat authentication for every battle-path room (battle + queue). */
export async function authenticateSeat(token: string | undefined, deps: Pick<BattleRoomDeps, "verifier" | "loader">): Promise<SeatPlayer> {
  if (!token) throw new ServerError(401, "Authentication required");
  try {
    const req = new Request("http://battle.internal/auth", { headers: { authorization: `Bearer ${token}` } });
    const ctx = await requireOnboardedPlayer(req, deps.verifier, deps.loader);
    return { playerId: ctx.player.id, username: ctx.player.username ?? ctx.player.displayName ?? "player" };
  } catch (err) {
    if (err instanceof AppError) throw new ServerError(err.status, err.message);
    logger.error("battle auth failure");
    throw new ServerError(500, "Authentication unavailable");
  }
}

interface MatchedContext {
  /** The two playerIds the coordinator reserved this room for. */
  playerIds: Set<string>;
  /** playerId -> username, known before either client connects. */
  usernames: Record<string, string>;
  /** Authoritative queue the pair came from. Server-set at creation. */
  mode: MatchMode;
  /** Epoch ms by which the match must start, else the room aborts. */
  deadlineAt: number;
}

export class BattleRoom extends Room {
  static deps: BattleRoomDeps = {};
  /** Set by startBattleServer; required only for matchmaking-created rooms. */
  static coordinator: MatchCoordinator | null = null;
  maxClients = 2;
  maxMessagesPerSecond = 30;
  private session!: BattleSession;
  /** playerId -> the commander claim that produced its ready loadout. */
  private readonly choices = new Map<string, CommanderChoice>();
  /** Clients with an entitlement check in flight (double-submit guard). */
  private readonly checking = new Set<string>();
  /** Non-null when this room was created by the matchmaker with a matchKey. */
  private matched: MatchedContext | null = null;
  private earlyAbort = false;
  /** Durable match identity, minted at begin(); participants key off it. */
  private matchId: string | null = null;
  private startedAt: Date | null = null;
  /** Per-slot secret resume tokens, rotated on every successful resume. */
  private readonly resumeTokens: [string, string] = ["", ""];
  /** Join slot -> drop state while inside the reconnect grace window. */
  private readonly dropped = new Map<number, { deadlineAt: number; timer: { clear(): void } }>();

  static async onAuth(token: string | undefined): Promise<SeatPlayer> {
    return authenticateSeat(token, BattleRoom.deps);
  }

  onCreate(options?: { matchKey?: unknown }) {
    const matchKey = typeof options?.matchKey === "string" ? options.matchKey : null;
    if (matchKey) {
      // The coordinator hands out one-shot keys; a forged or consumed key
      // fails creation, so clients can never self-create a matched room.
      // The queue mode travels with the key, so a client label can never
      // promote an unranked pair into a ranked room or vice versa.
      const pending: PendingMatch | null | undefined = BattleRoom.coordinator?.claimMatch(matchKey);
      if (!pending) throw new ServerError(403, "Unknown or expired match");
      this.matched = {
        playerIds: new Set(pending.players),
        usernames: pending.usernames,
        mode: pending.mode === "ranked" ? "ranked" : "matchmaking",
        deadlineAt: Date.now() + (BattleRoom.deps.matchLobbyMs ?? MATCH_LOBBY_MS),
      };
      void this.setPrivate(true);
      this.clock.setTimeout(() => this.matchedLobbyTimeout(), this.matched.deadlineAt - Date.now());
    }
    this.session = new BattleSession(BattleRoom.deps.rng);
    this.session.mode = this.matched ? this.matched.mode : "private";
    this.onMessage("ready", (client: BattleClient, msg: unknown) => void this.onReady(client, msg));
    this.onMessage("unready", (client: BattleClient) => {
      try {
        this.session.unready(client.auth.playerId);
        this.sendLobby();
      } catch (e) {
        client.send("error", { reason: e instanceof Error ? e.message : "Unready rejected" });
      }
    });
    this.onMessage("cmd", (client: BattleClient, msg: unknown) => {
      const ack = this.session.submit(client.auth.playerId, msg);
      if (ack) client.send("ack", ack);
    });
  }

  private async onReady(client: BattleClient, msg: unknown) {
    const parsed = readySchema.safeParse(msg);
    if (!parsed.success) return client.send("error", { reason: "Malformed ready" });
    const playerId = client.auth.playerId;
    if (this.checking.has(playerId)) return client.send("error", { reason: "Loadout check in progress" });
    this.checking.add(playerId);
    try {
      const grant = await resolveCommander(playerId, parsed.data.commander, entitlement());
      // The world may have changed while the chain read ran.
      if (this.session.slotOf(playerId) < 0) return;
      const allReady = this.session.setReady(playerId, { cards: parsed.data.cards, grant });
      // Recorded only after the session accepted it, so a rejected post-lock ready can't swap the commander.
      this.choices.set(playerId, parsed.data.commander);
      this.sendLobby();
      if (allReady) void this.lockAndStart();
    } catch (e) {
      client.send("error", { reason: e instanceof Error ? e.message : "Ready rejected" });
      this.sendLobby();
    } finally {
      this.checking.delete(playerId);
    }
  }

  onJoin(client: BattleClient, options?: { resume?: unknown }) {
    const playerId = client.auth.playerId;
    if (this.matched && !this.matched.playerIds.has(playerId)) {
      throw new ServerError(409, "Not a player in this match");
    }
    if (this.session.phase === "finished" || this.session.phase === "aborted") {
      throw new ServerError(409, "Battle is over");
    }
    if (this.session.phase === "active") {
      this.resume(client, options?.resume);
      return;
    }
    // Waiting phase: claim the activity pin before seating so a player can
    // only ever be inside one queue/room at a time.
    const coordinator = BattleRoom.coordinator;
    coordinator?.claimRoom(playerId, this.roomId);
    const wasSeated = this.session.slotOf(playerId) >= 0;
    try {
      this.session.join(client.auth);
    } catch (e) {
      if (!wasSeated) coordinator?.releaseRoom(playerId, this.roomId);
      throw new ServerError(409, e instanceof Error ? e.message : "Cannot join");
    }
    this.sendLobby();
  }

  /**
   * Seat recovery for an unconsented drop during the active phase. The token
   * authorizes the slot, not the matchmaking request: the Privy identity is
   * re-verified by static onAuth on every resume.
   */
  private resume(client: BattleClient, token: unknown) {
    const playerId = client.auth.playerId;
    const slot = this.session.slotOf(playerId);
    if (slot < 0) throw new ServerError(409, "Battle already started");
    const drop = this.dropped.get(slot);
    if (!drop) throw new ServerError(409, "Seat already connected");
    const expected = Buffer.from(this.resumeTokens[slot]!, "utf8");
    const given = Buffer.from(typeof token === "string" ? token : "", "utf8");
    if (Date.now() >= drop.deadlineAt || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new ServerError(403, "Resume not authorized");
    }
    BattleRoom.coordinator?.claimRoom(playerId, this.roomId);
    drop.timer.clear();
    this.dropped.delete(slot);
    this.resumeTokens[slot] = randomBytes(16).toString("hex");
    if (this.dropped.size === 0) this.lock();
    const seat = this.session.seatOfSlot[slot]!;
    const msg = this.session.startMessage(slot);
    msg.resumeToken = this.resumeTokens[slot]!;
    msg.resumed = true;
    msg.reconnectGraceMs = BattleRoom.deps.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    client.send("start", msg);
    client.send("frame", this.session.frame(seat, []));
    this.clientFor(1 - slot)?.send("presence", { opponentConnected: true, reconnectDeadlineAt: null });
  }

  onLeave(client: BattleClient, code?: number) {
    const playerId = client.auth?.playerId;
    const slot = playerId ? this.session.slotOf(playerId) : -1;
    if (this.session.phase === "active" && slot >= 0 && code !== CloseCode.CONSENTED) {
      // Unconsented drop inside the grace window: the seat stays, the
      // simulation keeps running, and the room stays open and joinable.
      const grace = BattleRoom.deps.reconnectGraceMs ?? RECONNECT_GRACE_MS;
      const deadlineAt = Date.now() + grace;
      const timer = this.clock.setTimeout(() => this.graceExpired(slot), grace);
      this.dropped.set(slot, { deadlineAt, timer });
      this.autoDispose = false;
      this.unlock();
      this.clientFor(1 - slot)?.send("presence", { opponentConnected: false, reconnectDeadlineAt: deadlineAt });
      return;
    }
    const wasActive = this.session.phase === "active";
    const wasSeated = slot >= 0;
    if (playerId) {
      this.session.leave(playerId);
      this.choices.delete(playerId);
      if (wasSeated && this.session.phase === "waiting" && !this.matched) {
        BattleRoom.coordinator?.releaseRoom(playerId, this.roomId);
      }
    }
    if (wasActive && this.session.phase === "aborted") {
      this.setSimulationInterval();
      this.broadcast("aborted", { reason: this.session.abortReason });
      this.releaseMatch();
      this.closeSoon();
    } else if (this.matched && wasSeated && this.session.phase === "waiting" && !this.earlyAbort) {
      // Matched rooms never free a seat: a leave before start ends it.
      this.earlyAbort = true;
      this.broadcast("aborted", { reason: "Opponent left before the match started" });
      this.releaseMatch();
      void this.disconnect();
    } else if (this.session.phase === "waiting") this.sendLobby();
  }

  /** Grace ran out for a dropped seat: abort with no winner and no record. */
  private graceExpired(slot: number) {
    if (!this.dropped.delete(slot)) return;
    if (this.session.phase !== "active") return;
    const name = this.session.slots[slot]?.username ?? "Opponent";
    this.session.abort(`${name} did not reconnect in time. No result recorded.`);
    this.setSimulationInterval();
    this.broadcast("aborted", { reason: this.session.abortReason });
    this.releaseMatch();
    this.closeSoon();
  }

  private clientFor(slot: number): BattleClient | undefined {
    const id = this.session.slots[slot]?.playerId;
    return (this.clients as unknown as BattleClient[]).find((c) => c.auth?.playerId === id);
  }

  private sendLobby() {
    this.session.slots.forEach((_, slot) => {
      const c = this.clientFor(slot);
      if (!c) return;
      const msg = this.session.lobby(slot);
      if (this.matched) {
        const me = this.session.slots[slot]?.playerId;
        const oppId = [...this.matched.playerIds].find((id) => id !== me);
        msg.match = { opponent: (oppId && this.matched.usernames[oppId]) ?? null, deadlineAt: this.matched.deadlineAt, mode: this.matched.mode };
      }
      c.send("lobby", msg);
    });
  }

  private releaseMatch() {
    // Clears room activities for every mode: matched pairs were pinned at
    // match_found, private/matched players are pinned at onJoin.
    BattleRoom.coordinator?.release(this.roomId);
  }

  /** Fires when a matched lobby never reaches start before the deadline. */
  private matchedLobbyTimeout() {
    if (!this.matched || this.earlyAbort || this.session.phase !== "waiting") return;
    this.earlyAbort = true;
    this.broadcast("aborted", { reason: "Match timed out before start" });
    this.releaseMatch();
    void this.disconnect();
  }

  /**
   * Lock both loadouts, re-verify every commander entitlement (NFT ownerOf
   * runs again so a transfer between confirm and start fails closed), then
   * start from the same epoch. Any failure un-readies only the failing
   * player and tells them why.
   */
  private async lockAndStart() {
    const epoch = this.session.lock();
    this.sendLobby();
    const loadouts = this.session.readyLoadouts();
    for (const slot of [0, 1] as const) {
      const seated = this.session.slots[slot];
      const loadout = loadouts[slot];
      if (!seated || !loadout) return;
      const choice = this.choices.get(seated.playerId) ?? null;
      if (!choice) return;
      try {
        loadout.grant = await resolveCommander(seated.playerId, choice, entitlement());
      } catch (e) {
        if (this.session.lockEpoch !== epoch || this.session.phase !== "waiting") return;
        this.session.clearReady(slot);
        const reason = e instanceof Error ? e.message : "verification failed";
        // tokenIds and classes are safe to log; tokens never are.
        logger.info("commander entitlement failed at match start", { roomId: this.roomId, tokenId: choice.kind === "nft" ? choice.tokenId : null });
        this.clientFor(slot)?.send("error", { reason: `Commander entitlement failed at match start: ${reason}` });
        this.sendLobby();
        return;
      }
    }
    // Lock one authentic indexed patron for the match. Fails closed: no
    // synthetic fallback, and both players are un-readied and told why.
    // Purchased card levels freeze here too: the room reads them once from
    // verified server progression (never the client), clamps them, and the
    // session deep-copies them into the config before start. Disabled by
    // default; without the flag every match is Level 1, exactly baseline.
    const pids = [this.session.slots[0]?.playerId, this.session.slots[1]?.playerId];
    const [patronResult, levelsResult] = await Promise.allSettled([
      patronSource().lock(randomBytes(16).toString("hex")),
      // A missing migration or DB outage rejects here and falls back to
      // Level 1 below; the match always starts, never on partial levels.
      BattleRoom.deps.cardScaling ? getPurchasedLevels(pids.filter((id): id is string => !!id)) : Promise.resolve({}),
    ]);
    if (patronResult.status === "rejected") {
      const e = patronResult.reason;
      if (this.session.lockEpoch !== epoch || this.session.phase !== "waiting") return;
      this.session.clearReady(0);
      this.session.clearReady(1);
      logger.info("arena patron unavailable", { roomId: this.roomId, reason: e instanceof Error ? e.message : String(e) });
      for (const slot of [0, 1] as const) {
        this.clientFor(slot)?.send("error", { reason: "No authentic Arena Patron available, match cannot start" });
      }
      this.sendLobby();
      return;
    }
    const patron = patronResult.value;
    if (levelsResult.status === "fulfilled") {
      this.session.cardLevelsByPlayer = levelsResult.value as Record<string, Record<string, number>>;
    } else {
      // Missing table or DB outage: fail closed to Level 1, keep the match.
      logger.info("card levels unavailable, starting at Level 1", { roomId: this.roomId });
      this.session.cardLevelsByPlayer = {};
    }
    if (this.earlyAbort || this.session.lockEpoch !== epoch || this.session.phase !== "waiting") return;
    try {
      this.session.start(epoch, loadouts as [TrustedLoadout, TrustedLoadout], patron);
    } catch {
      return;
    }
    this.begin();
  }

  private begin() {
    this.lock();
    this.matchId = randomUUID();
    this.startedAt = new Date();
    const grace = BattleRoom.deps.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    this.session.slots.forEach((_, slot) => {
      this.resumeTokens[slot] = randomBytes(16).toString("hex");
      const msg = this.session.startMessage(slot);
      msg.resumeToken = this.resumeTokens[slot]!;
      msg.reconnectGraceMs = grace;
      this.clientFor(slot)?.send("start", msg);
    });
    this.setSimulationInterval(() => this.step(), BattleRoom.deps.tickMs ?? 100);
  }

  private step() {
    const out = this.session.tick();
    if (!out) return;
    for (const slot of [0, 1]) {
      const seat = this.session.seatOfSlot[slot]!;
      const c = this.clientFor(slot);
      if (!c) continue;
      for (const ack of out.acks[seat]) c.send("ack", ack);
      c.send("frame", out.frames[seat]);
      if (out.end) c.send("end", { ...out.end[seat], matchId: this.matchId });
    }
    if (out.end) {
      this.setSimulationInterval();
      this.saveReplay();
      this.settleResult();
      this.releaseMatch();
      this.closeSoon();
    }
  }

  /**
   * Submit the finished match to durable settlement. The room is only a
   * courier: verification, atomic insert and retry all live in the service,
   * which outlives the room, so closeSoon/dispose can never drop a result.
   * Nothing is claimed settled until the DB confirms.
   */
  private settleResult() {
    const service = BattleRoom.deps.settlement;
    const r = this.session.replay;
    if (!service) {
      this.broadcast("settlement", { matchId: this.matchId, status: "disabled" });
      return;
    }
    if (!r || !this.matchId || !this.startedAt || !r.replayIdentical) {
      logger.error("settlement refused", { roomId: this.roomId, reason: !r ? "no replay" : r.replayIdentical ? "no match id" : "replay mismatch" });
      this.broadcast("settlement", { matchId: this.matchId, status: "refused" });
      return;
    }
    const record = recordFromReplay(r, {
      matchId: this.matchId,
      roomId: this.roomId,
      matchType: this.matched ? this.matched.mode : "private",
      startedAt: this.startedAt,
      crowns: [...this.session.state!.crowns] as [number, number],
    });
    void service.submit(record).then((status) => {
      const mapped = status === "settled" || status === "already-settled" ? status : status === "pending" ? "pending" : "refused";
      this.broadcast("settlement", { matchId: record.matchId, status: mapped });
    });
  }

  private saveReplay() {
    const dir = BattleRoom.deps.replayDir === undefined ? path.join(process.cwd(), ".battle-replays") : BattleRoom.deps.replayDir;
    const r = this.session.replay;
    if (!dir || !r) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${this.roomId}.json`), JSON.stringify({ roomId: this.roomId, ...r }));
    logger.info("battle finished", { roomId: this.roomId, winner: r.winner, endReason: r.endReason, ticks: r.ticks, commands: r.commands.length, replayIdentical: r.replayIdentical });
  }

  private closeSoon() {
    this.clock.setTimeout(() => void this.disconnect(), BattleRoom.deps.closeAfterMs ?? 30_000);
  }

  onDispose() {
    this.releaseMatch();
  }
}
