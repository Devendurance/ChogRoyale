// B3.2a Colyseus adapter around BattleSession. Identity comes only from the
// Privy access token sent in the matchmaking request's Authorization header
// (never the WebSocket URL, never client options). The token is verified and
// the player loaded through the existing B0 guard, so seats are bound to
// server-side player ids. Combat runs only inside BattleSession. Commander
// entitlement is resolved here (onchain ownerOf for NFT claims), re-verified
// after both players confirm, and only then does the session start.

import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { Room, ServerError, type Client } from "@colyseus/core";
import { requireOnboardedPlayer, type PlayerLoader } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { PrivyTokenVerifier } from "@/lib/privy-server";
import { readySchema, type CommanderChoice } from "@/lib/battle-protocol";
import { BattleSession, type SeatPlayer, type SessionRandom, type TrustedLoadout } from "@/server/battle/session";
import { productionEntitlementDeps, resolveCommander, type EntitlementDeps } from "@/server/battle/entitlement";

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
}

type BattleClient = Client & { auth: SeatPlayer };

let productionDeps: EntitlementDeps | null = null;
function entitlement(): EntitlementDeps {
  return BattleRoom.deps.entitlement ?? (productionDeps ??= productionEntitlementDeps());
}

export class BattleRoom extends Room {
  static deps: BattleRoomDeps = {};
  maxClients = 2;
  maxMessagesPerSecond = 30;
  private session!: BattleSession;
  /** playerId -> the commander claim that produced its ready loadout. */
  private readonly choices = new Map<string, CommanderChoice>();
  /** Clients with an entitlement check in flight (double-submit guard). */
  private readonly checking = new Set<string>();

  static async onAuth(token: string | undefined): Promise<SeatPlayer> {
    if (!token) throw new ServerError(401, "Authentication required");
    try {
      const req = new Request("http://battle.internal/auth", { headers: { authorization: `Bearer ${token}` } });
      const ctx = await requireOnboardedPlayer(req, BattleRoom.deps.verifier, BattleRoom.deps.loader);
      return { playerId: ctx.player.id, username: ctx.player.username ?? ctx.player.displayName ?? "player" };
    } catch (err) {
      if (err instanceof AppError) throw new ServerError(err.status, err.message);
      logger.error("battle auth failure");
      throw new ServerError(500, "Authentication unavailable");
    }
  }

  onCreate() {
    this.session = new BattleSession(BattleRoom.deps.rng);
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

  onJoin(client: BattleClient) {
    try {
      this.session.join(client.auth);
    } catch (e) {
      throw new ServerError(409, e instanceof Error ? e.message : "Cannot join");
    }
    this.sendLobby();
  }

  onLeave(client: BattleClient) {
    const wasActive = this.session.phase === "active";
    this.session.leave(client.auth.playerId);
    this.choices.delete(client.auth.playerId);
    if (wasActive && this.session.phase === "aborted") {
      this.setSimulationInterval();
      this.broadcast("aborted", { reason: this.session.abortReason });
      this.closeSoon();
    } else if (this.session.phase === "waiting") this.sendLobby();
  }

  private clientFor(slot: number): BattleClient | undefined {
    const id = this.session.slots[slot]?.playerId;
    return (this.clients as unknown as BattleClient[]).find((c) => c.auth?.playerId === id);
  }

  private sendLobby() {
    this.session.slots.forEach((_, slot) => this.clientFor(slot)?.send("lobby", this.session.lobby(slot)));
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
    if (this.session.lockEpoch !== epoch || this.session.phase !== "waiting") return;
    try {
      this.session.start(epoch, loadouts as [TrustedLoadout, TrustedLoadout]);
    } catch {
      return;
    }
    this.begin();
  }

  private begin() {
    this.lock();
    this.session.slots.forEach((_, slot) => this.clientFor(slot)?.send("start", this.session.startMessage(slot)));
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
      if (out.end) c.send("end", out.end[seat]);
    }
    if (out.end) {
      this.setSimulationInterval();
      this.saveReplay();
      this.closeSoon();
    }
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
}
