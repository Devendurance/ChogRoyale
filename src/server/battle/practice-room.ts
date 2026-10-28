// V2.1c Practice room: genuine human-vs-AI through the existing combat engine.
// One Privy-verified human plus one internal bot seat at a server-validated
// difficulty (medium/hard/ultimate, default medium). No synthetic Privy
// account, no DB player row for the bot, no MatchCoordinator ticket/queue,
// no PvP settlement writer. The bot runs its difficulty policy on bounded
// server ticks with the same energy/cards/timing/legal placement rules.

import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { CloseCode, Room, ServerError, type Client } from "@colyseus/core";
import { logger } from "@/lib/logger";
import { readySchema, type CommanderChoice, type PracticeDifficulty, type PracticeOpponent } from "@/lib/battle-protocol";
import {
  PRACTICE_BOT_DISPLAY_NAME,
  botSeatFor,
  policyFor,
  practiceBotCommanderClass,
  practiceBotOrdinaryCards,
  practiceBotPlayerId,
  practiceOpponentFor,
  resolvePracticeDifficulty,
} from "@/server/battle/practice";
import { BattleSession, deckFor, type SeatPlayer, type SessionRandom, type TrustedLoadout } from "@/server/battle/session";
import { authenticateSeat, type BattleRoomDeps } from "@/server/battle/room";
import { freeStarterSlot } from "@/lib/combat";
import { commanderCardId, validateDeck } from "@/lib/combat";
import { productionEntitlementDeps, resolveCommander, type EntitlementDeps } from "@/server/battle/entitlement";
import { productionPatronSource, type PatronSource } from "@/server/battle/patron-source";
import type { MatchCoordinator } from "@/server/battle/matchmaking";

type PracticeClient = Client & { auth: SeatPlayer };

/** V2.1a compatibility alias: the Medium internal seat id. */
export const PRACTICE_BOT_PLAYER_ID = practiceBotPlayerId("medium");
const MATCH_LOBBY_MS = 90_000;
const RECONNECT_GRACE_MS = 30_000;

let productionPatrons: PatronSource | null = null;
function patronSource(): PatronSource {
  return PracticeRoom.deps.patrons ?? (productionPatrons ??= productionPatronSource());
}

let productionEntitlement: EntitlementDeps | null = null;
function entitlement(): EntitlementDeps {
  return PracticeRoom.deps.entitlement ?? (productionEntitlement ??= productionEntitlementDeps());
}

function botGrant(): TrustedLoadout["grant"] {
  const cls = practiceBotCommanderClass() as "bulwark" | "reaver" | "deadeye" | "scout" | "warden";
  const slot = freeStarterSlot(cls);
  const cap = `${cls[0]!.toUpperCase()}${cls.slice(1)}`;
  return {
    slot,
    identity: {
      kind: "free",
      commanderId: slot.commanderId,
      cardId: commanderCardId(slot.commanderId),
      class: cls,
      variant: "free",
      prestige: "Free",
      name: `${cap} Commander`,
      tokenId: null,
      imageOriginal: null,
      rulesetVersion: "v1",
      derivationHash: slot.definition.derivationHash,
      basis: "free",
      verifiedAt: null,
    },
    owner: null,
  };
}

function botLoadout(): TrustedLoadout {
  const cards = practiceBotOrdinaryCards();
  const grant = botGrant();
  validateDeck(deckFor({ cards, grant }), grant.slot);
  return { cards, grant };
}

export class PracticeRoom extends Room {
  static deps: BattleRoomDeps = {};
  static coordinator: MatchCoordinator | null = null;
  maxClients = 1;
  private session!: BattleSession;
  /** Immutable difficulty profile, resolved once at room creation. */
  private difficulty: PracticeDifficulty = "medium";
  /** Solo practice vs server-assigned Unranked fallback. Never client-chosen. */
  private origin: "practice" | "unranked-fallback" = "practice";
  /** The lone human a fallback room is reserved for. Null for solo practice. */
  private fallbackPlayerId: string | null = null;
  private opponent: PracticeOpponent = practiceOpponentFor("medium");
  private botPlayerId: string = practiceBotPlayerId("medium");
  private humanClient: PracticeClient | null = null;
  private choice: CommanderChoice | null = null;
  private checking = false;
  private matchId: string | null = null;
  private resumeToken = "";
  private drop: { deadlineAt: number; timer: { clear(): void } } | null = null;
  private botCid = 0;

  static async onAuth(token: string | undefined): Promise<SeatPlayer> {
    return authenticateSeat(token, PracticeRoom.deps);
  }

  onCreate(options?: { difficulty?: unknown; fallbackKey?: unknown }) {
    if (typeof options?.fallbackKey === "string" && options.fallbackKey.length > 0) {
      // Server-assigned Unranked fallback: the key is a single-use coordinator
      // mint. A forged, consumed, or missing key fails creation. Client
      // difficulty options are ignored on this path.
      const fb = PracticeRoom.coordinator?.claimFallback(options.fallbackKey);
      if (!fb) throw new ServerError(403, "Unknown or expired fallback");
      this.origin = "unranked-fallback";
      this.fallbackPlayerId = fb.playerId;
      this.difficulty = fb.difficulty;
      this.opponent = { ...practiceOpponentFor(fb.difficulty), source: "unranked-fallback" };
      this.botPlayerId = practiceBotPlayerId(fb.difficulty);
      if (!PracticeRoom.coordinator?.registerFallbackRoom(this.roomId)) throw new ServerError(503, "AI opponents at capacity");
    } else {
      // Server-owned difficulty: omitted means Medium (existing clients),
      // anything else must be an exact supported value or creation fails.
      this.difficulty = resolvePracticeDifficulty(options?.difficulty);
      this.opponent = { ...practiceOpponentFor(this.difficulty), source: "practice" };
      this.botPlayerId = practiceBotPlayerId(this.difficulty);
    }
    this.session = new BattleSession(PracticeRoom.deps.rng as SessionRandom | undefined);
    this.session.mode = "practice";
    this.session.slots[1] = { playerId: this.botPlayerId, username: PRACTICE_BOT_DISPLAY_NAME };
    try { this.session.setReady(this.botPlayerId, botLoadout()); } catch (e) { logger.info("practice bot ready failed", { roomId: this.roomId, reason: e instanceof Error ? e.message : String(e) }); }
    this.onMessage("ready", (client: PracticeClient, msg: unknown) => void this.onReady(client, msg));
    this.onMessage("unready", (client: PracticeClient) => {
      try {
        this.session.unready(client.auth.playerId);
        this.sendLobby(client);
      } catch (e) {
        client.send("error", { reason: e instanceof Error ? e.message : "Unready rejected" });
      }
    });
    this.onMessage("cmd", (client: PracticeClient, msg: unknown) => {
      const ack = this.session.submit(client.auth.playerId, msg);
      if (ack) client.send("ack", ack);
    });
    this.clock.setTimeout(() => this.lobbyTimeout(), MATCH_LOBBY_MS);
  }

  onJoin(client: PracticeClient, options?: { resume?: unknown }) {
    const playerId = client.auth.playerId;
    if (playerId.startsWith("bot:")) throw new ServerError(403, "Bot seats are server-owned");
    if (this.origin === "unranked-fallback" && playerId !== this.fallbackPlayerId) {
      throw new ServerError(403, "Not the reserved player for this match");
    }
    this.humanClient = client;
    if (this.session.phase === "finished" || this.session.phase === "aborted") {
      throw new ServerError(409, "Practice is over");
    }
    if (this.session.phase === "active") {
      this.resume(client, options?.resume);
      return;
    }
    PracticeRoom.coordinator?.claimRoom(playerId, this.roomId);
    if (this.session.slotOf(playerId) < 0) {
      try {
        this.session.join(client.auth);
      } catch (e) {
        PracticeRoom.coordinator?.releaseRoom(playerId, this.roomId);
        throw new ServerError(409, e instanceof Error ? e.message : "Cannot join");
      }
    }
    this.sendLobby(client);
  }

  private sendLobby(client: PracticeClient) {
    const slot = Math.max(0, this.session.slotOf(client.auth.playerId));
    const base = this.session.lobby(slot);
    client.send("lobby", {
      ...base,
      you: 0,
      players: [{ username: this.session.slots[0]?.username ?? "", ready: base.mine !== null }],
      practice: { opponent: this.opponent },
      match: { opponent: this.opponent.displayName, deadlineAt: Date.now() + MATCH_LOBBY_MS, mode: "practice" as const },
    });
  }

  private async onReady(client: PracticeClient, msg: unknown) {
    const parsed = readySchema.safeParse(msg);
    if (!parsed.success) return client.send("error", { reason: "Malformed ready" });
    if (this.checking) return client.send("error", { reason: "Loadout check in progress" });
    this.checking = true;
    try {
      const grant = await resolveCommander(client.auth.playerId, parsed.data.commander, entitlement());
      if (this.session.slotOf(client.auth.playerId) < 0) return;
      this.session.setReady(client.auth.playerId, { cards: parsed.data.cards, grant });
      this.choice = parsed.data.commander;
      this.sendLobby(client);
      await this.lockAndStart(client);
    } catch (e) {
      client.send("error", { reason: e instanceof Error ? e.message : "Ready rejected" });
      this.sendLobby(client);
    } finally {
      this.checking = false;
    }
  }

  private async lockAndStart(client: PracticeClient) {
    const human = this.session.slots[0];
    if (!human || !this.choice) return;
    const epoch = this.session.lock();
    this.sendLobby(client);
    let grant: TrustedLoadout["grant"];
    try {
      grant = await resolveCommander(human.playerId, this.choice, entitlement());
    } catch (e) {
      if (this.session.lockEpoch !== epoch || this.session.phase !== "waiting") return;
      this.session.clearReady(0);
      client.send("error", { reason: `Commander entitlement failed at match start: ${e instanceof Error ? e.message : "verification failed"}` });
      this.sendLobby(client);
      return;
    }
    const locked = this.session.readyLoadouts();
    const lockedBot = locked[1];
    if (!lockedBot) { client.send("error", { reason: "Practice opponent unavailable" }); return; }
    const humanLoadout: TrustedLoadout = { cards: [...(locked[0]?.cards ?? [])], grant };
    const bot = lockedBot;
    this.session.cardLevelsByPlayer = {};
    let patron;
    try {
      patron = await patronSource().lock(randomBytes(16).toString("hex"));
    } catch (e) {
      if (this.session.lockEpoch !== epoch || this.session.phase !== "waiting") return;
      this.session.clearReady(0);
      logger.info("practice arena patron unavailable", { roomId: this.roomId, reason: e instanceof Error ? e.message : String(e) });
      client.send("error", { reason: "No authentic Arena Patron available, match cannot start" });
      this.sendLobby(client);
      return;
    }
    if (this.session.lockEpoch !== epoch || this.session.phase !== "waiting") return;
    try {
      this.session.start(epoch, [humanLoadout, bot], patron);
    } catch {
      return;
    }
    this.begin(client);
  }

  private begin(client: PracticeClient) {
    this.lock();
    this.matchId = randomUUID();
    const grace = PracticeRoom.deps.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    this.resumeToken = randomBytes(16).toString("hex");
    const msg = this.session.startMessage(0);
    msg.resumeToken = this.resumeToken;
    msg.reconnectGraceMs = grace;
    msg.opponentKind = "bot";
    msg.practiceOpponent = this.opponent;
    msg.opponent = this.opponent.displayName;
    client.send("start", msg);
    this.setSimulationInterval(() => this.step(), PracticeRoom.deps.tickMs ?? 100);
  }

  private step() {
    const client = this.humanClient;
    if (!client) return;
    const state = this.session.state;
    if (state && this.session.phase === "active") {
      try {
        const humanSeat = this.session.seatOfSlot[0]!;
        const botSeat = botSeatFor(humanSeat);
        const policy = policyFor(this.difficulty);
        // Ultimate also times commander abilities; Medium/Hard hold them.
        const abilityId = policy.ability?.(state, botSeat);
        if (abilityId) {
          this.botCid += 1;
          this.session.submit(this.botPlayerId, { type: "ability", cid: `bot-${state.tick}-${this.botCid}`, abilityId });
        } else {
          const move = policy.choose(state, botSeat, state.tick);
          if (move) {
            this.botCid += 1;
            const cid = `bot-${state.tick}-${this.botCid}`;
            this.session.submit(this.botPlayerId, {
              type: "deploy",
              cid,
              cardId: move.cardId,
              x: Math.max(0, Math.min(100, move.x)),
              y: Math.max(0, Math.min(160, move.y)),
            });
          }
        }
      } catch (e) {
        logger.info("practice bot tick skipped", { roomId: this.roomId, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    const out = this.session.tick();
    if (!out) return;
    const humanSeat = this.session.seatOfSlot[0]!;
    for (const ack of out.acks[humanSeat]) client.send("ack", ack);
    client.send("frame", out.frames[humanSeat]);
    if (out.end) {
      const end = { ...out.end[humanSeat], matchId: this.matchId, practice: { opponentKind: "bot" as const, noReward: true as const, source: this.origin } };
      client.send("end", end);
      client.send("settlement", { matchId: this.matchId, status: "disabled" });
      this.setSimulationInterval();
      this.releaseHuman();
      this.clock.setTimeout(() => void this.disconnect(), PracticeRoom.deps.closeAfterMs ?? 5_000);
    }
  }

  private resume(client: PracticeClient, token: unknown) {
    const playerId = client.auth.playerId;
    const slot = this.session.slotOf(playerId);
    if (slot !== 0) throw new ServerError(409, "Practice already started");
    if (!this.drop) throw new ServerError(409, "Seat already connected");
    const expected = Buffer.from(this.resumeToken, "utf8");
    const given = Buffer.from(typeof token === "string" ? token : "", "utf8");
    if (Date.now() >= this.drop.deadlineAt || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new ServerError(403, "Resume not authorized");
    }
    PracticeRoom.coordinator?.claimRoom(playerId, this.roomId);
    this.drop.timer.clear();
    this.drop = null;
    this.resumeToken = randomBytes(16).toString("hex");
    this.lock();
    const seat = this.session.seatOfSlot[0]!;
    const msg = this.session.startMessage(0);
    msg.resumeToken = this.resumeToken;
    msg.resumed = true;
    msg.reconnectGraceMs = PracticeRoom.deps.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    msg.opponentKind = "bot";
    msg.practiceOpponent = this.opponent;
    msg.opponent = this.opponent.displayName;
    client.send("start", msg);
    client.send("frame", this.session.frame(seat, []));
    client.send("presence", { opponentConnected: true, reconnectDeadlineAt: null });
  }

  onLeave(client: PracticeClient, code?: number) {
    const playerId = client.auth?.playerId;
    const slot = playerId ? this.session.slotOf(playerId) : -1;
    if (this.session.phase === "waiting" && slot === 0) {
      this.session.leave(playerId!);
      if (this.humanClient?.auth?.playerId === playerId) this.humanClient = null;
      this.releaseHuman();
      return;
    }
    if (this.session.phase === "active" && slot === 0 && code !== CloseCode.CONSENTED) {
      const grace = PracticeRoom.deps.reconnectGraceMs ?? RECONNECT_GRACE_MS;
      const deadlineAt = Date.now() + grace;
      const timer = this.clock.setTimeout(() => this.graceExpired(), grace);
      this.drop = { deadlineAt, timer };
      // Keep the room open and joinable so joinById can deliver a resume.
      this.autoDispose = false;
      this.unlock();
      return;
    }
    if (this.session.phase === "active" && slot === 0) {
      this.session.abort("Practice ended. No rewards.");
      this.setSimulationInterval();
      this.broadcast("aborted", { reason: this.session.abortReason });
      this.releaseHuman();
      this.clock.setTimeout(() => void this.disconnect(), PracticeRoom.deps.closeAfterMs ?? 5_000);
    }
  }

  private lobbyTimeout() {
    if (this.session.phase !== "waiting") return;
    this.broadcast("aborted", { reason: "Practice timed out before start" });
    this.releaseHuman();
    void this.disconnect();
  }

  private graceExpired() {
    if (!this.drop) return;
    this.drop = null;
    if (this.session.phase !== "active") return;
    this.session.abort("AI Opponent held the arena. Reconnect window expired. No rewards.");
    this.setSimulationInterval();
    this.broadcast("aborted", { reason: this.session.abortReason });
    this.releaseHuman();
    this.clock.setTimeout(() => void this.disconnect(), PracticeRoom.deps.closeAfterMs ?? 5_000);
  }

  private releaseHuman() {
    if (this.roomId) PracticeRoom.coordinator?.release(this.roomId);
  }

  onDispose() {
    if (this.origin === "unranked-fallback") PracticeRoom.coordinator?.releaseFallbackRoom(this.roomId);
    this.releaseHuman();
  }
}
