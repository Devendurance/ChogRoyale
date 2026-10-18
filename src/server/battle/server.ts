import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BATTLE_ROOM } from "@/lib/battle-protocol";
import { BattleRoom, type BattleRoomDeps } from "@/server/battle/room";

/** Boots the dev battle server. Tests pass deps; the script passes none. */
export async function startBattleServer(port: number, deps: BattleRoomDeps = {}, hostname = "127.0.0.1") {
  BattleRoom.deps = deps;
  const server = new Server({ transport: new WebSocketTransport(), gracefullyShutdown: false, greet: false } as ConstructorParameters<typeof Server>[0]);
  server.define(BATTLE_ROOM, BattleRoom);
  await server.listen(port, hostname);
  return server;
}
