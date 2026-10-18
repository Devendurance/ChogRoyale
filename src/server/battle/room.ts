// B3.1 Colyseus adapter around BattleSession. Identity comes only from the
// Privy access token sent in the matchmaking request's Authorization header
// (never the WebSocket URL, never client options). The token is verified and
// the player loaded through the existing B0 guard, so seats are bound to
// server-side player ids. Combat runs only inside BattleSession.

import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { Room, ServerError, type Client } from "@colyseus/core";
import { requireOnboardedPlayer, type PlayerLoader } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { PrivyTokenVerifier } from "@/lib/privy-server";
import { readySchema } from "@/lib/battle-protocol";
import { BattleSession, type SeatPlayer, type SessionRandom } from "@/server/battle/session";

export interface BattleRoomDeps {
  /** Test-only injection points; production passes none and uses Privy + Neon. */
  verifier?: PrivyTokenVerifier;
  loader?: PlayerLoader;
  rng?: SessionRandom;
  tickMs?: number;
  /** Directory for local replay records (config + commands). Null disables. */
  replayDir?: string | null;
  /** Grace period before a finished/aborted room closes. */
  closeAfterMs?: number;
}

type BattleClient = Client & { auth: SeatPlayer };

export class BattleRoom extends Room {
  static deps: BattleRoomDeps = {};
  maxClients = 2;
  maxMessagesPerSecond = 30;
  private session!: BattleSession;

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
    this.onMessage("ready", (client: BattleClient, msg: unknown) => {
      const parsed = readySchema.safeParse(msg);
      if (!parsed.success) return client.send("error", { reason: "Malformed ready" });
      try {
        const started = this.session.setReady(client.auth.playerId, parsed.data.deck);
        this.sendLobby();
        if (started) this.begin();
      } catch (e) {
        client.send("error", { reason: e instanceof Error ? e.message : "Ready rejected" });
      }
    });
    this.onMessage("cmd", (client: BattleClient, msg: unknown) => {
      const ack = this.session.submit(client.auth.playerId, msg);
      if (ack) client.send("ack", ack);
    });
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
