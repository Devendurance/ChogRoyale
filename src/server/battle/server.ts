import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BATTLE_PRACTICE_ROOM, BATTLE_QUEUE_ROOM, BATTLE_RANKED_QUEUE_ROOM, BATTLE_ROOM } from "@/lib/battle-protocol";
import { logger } from "@/lib/logger";
import { MatchCoordinator, QueueRoom, RankedQueueRoom } from "@/server/battle/matchmaking";
import { BattleRoom, type BattleRoomDeps } from "@/server/battle/room";
import { PracticeRoom } from "@/server/battle/practice-room";
import { botGoldService } from "@/server/battle/bot-gold";

export interface BattleServerRuntimeOptions {
  /** Install SIGTERM/SIGINT handlers that drain rooms then exit. Hosting only. */
  enableShutdownHooks?: boolean;
}

/** Boots the dev battle server. Tests pass deps; the script passes none. */
export async function startBattleServer(
  port: number,
  deps: BattleRoomDeps = {},
  hostname = "127.0.0.1",
  runtime: BattleServerRuntimeOptions = {}
) {
  const startedAt = Date.now();
  BattleRoom.deps = deps;
  QueueRoom.deps = deps;
  PracticeRoom.deps = deps;
  // One coordinator per process; every QueueRoom instance shares it.
  const coordinator = new MatchCoordinator({ maxWaitMs: deps.queueMaxWaitMs, fallback: deps.unrankedFallback });
  BattleRoom.coordinator = coordinator;
  QueueRoom.coordinator = coordinator;
  RankedQueueRoom.coordinator = coordinator;
  PracticeRoom.coordinator = coordinator;
  // Ranked shares the coordinator's deps object so auth stays identical.
  RankedQueueRoom.deps = QueueRoom.deps;
  // Retries pending settlement records at startup and periodically. The
  // service (not the room) owns results, so room dispose can't drop them.
  deps.settlement?.startSweeper();
  if (deps.botGold?.enabled) botGoldService().startSweeper();
  const transport = new WebSocketTransport();
  // Host health probe. Plain liveness only: no rooms, players, or secrets.
  transport.getExpressApp().get("/healthz", (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json({ status: "ok", uptimeSec: Math.floor((Date.now() - startedAt) / 1000) });
  });
  const server = new Server({ transport, gracefullyShutdown: false, greet: false } as ConstructorParameters<typeof Server>[0]);
  server.define(BATTLE_ROOM, BattleRoom);
  server.define(BATTLE_QUEUE_ROOM, QueueRoom);
  server.define(BATTLE_RANKED_QUEUE_ROOM, RankedQueueRoom);
  server.define(BATTLE_PRACTICE_ROOM, PracticeRoom);
  await server.listen(port, hostname);
  if (runtime.enableShutdownHooks) installShutdownHooks(server, deps);
  return server;
}

/**
 * Hosting-only drain: stop the settlement sweeper, disconnect rooms
 * gracefully, then exit. A hard cap forces exit so a stuck room cannot
 * pin the deploy. Never logs tokens or connection secrets. POSIX signals
 * (SIGTERM/SIGINT) only exist on Linux hosts; on Windows, process
 * termination bypasses handlers, so stopping there is always abrupt.
 */
export async function drainBattleServer(
  server: Pick<Server, "gracefullyShutdown">,
  deps: Pick<BattleRoomDeps, "settlement" | "botGold">
): Promise<void> {
  try {
    deps.settlement?.stopSweeper();
    if (deps.botGold?.enabled) botGoldService().stopSweeper();
  } catch {
    // Sweeper stop is best-effort; shutdown proceeds regardless.
  }
  await server.gracefullyShutdown();
}

export function installShutdownHooks(
  server: Pick<Server, "gracefullyShutdown">,
  deps: Pick<BattleRoomDeps, "settlement" | "botGold">
): void {
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("battle server draining", { signal });
    try {
      deps.settlement?.stopSweeper();
      if (deps.botGold?.enabled) botGoldService().stopSweeper();
    } catch {
      // Sweeper stop is best-effort; shutdown proceeds regardless.
    }
    const force = setTimeout(() => process.exit(1), 15_000);
    if (typeof force.unref === "function") force.unref();
    // Set exitCode instead of calling process.exit so buffered log output
    // flushes before the process ends; the event loop is empty after the
    // graceful shutdown, so exit follows promptly on its own.
    void drainBattleServer(server, deps)
      .catch(() => undefined)
      .then(() => {
        clearTimeout(force);
        process.exitCode = 0;
      });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
