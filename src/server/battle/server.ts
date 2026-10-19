import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BATTLE_QUEUE_ROOM, BATTLE_ROOM } from "@/lib/battle-protocol";
import { MatchCoordinator, QueueRoom } from "@/server/battle/matchmaking";
import { BattleRoom, type BattleRoomDeps } from "@/server/battle/room";

/** Boots the dev battle server. Tests pass deps; the script passes none. */
export async function startBattleServer(port: number, deps: BattleRoomDeps = {}, hostname = "127.0.0.1") {
  BattleRoom.deps = deps;
  QueueRoom.deps = deps;
  // One coordinator per process; every QueueRoom instance shares it.
  const coordinator = new MatchCoordinator({ maxWaitMs: deps.queueMaxWaitMs });
  BattleRoom.coordinator = coordinator;
  QueueRoom.coordinator = coordinator;
  const server = new Server({ transport: new WebSocketTransport(), gracefullyShutdown: false, greet: false } as ConstructorParameters<typeof Server>[0]);
  server.define(BATTLE_ROOM, BattleRoom);
  server.define(BATTLE_QUEUE_ROOM, QueueRoom);
  await server.listen(port, hostname);
  return server;
}
