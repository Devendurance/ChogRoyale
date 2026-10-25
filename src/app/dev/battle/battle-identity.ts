// One identity model for the battle presentation. Two different indexes exist:
// the lobby lists players by join slot (`lobby.you`), while the server shuffles
// battle seats at start (`start.seat`). Reading the lobby with the battle seat
// shows the opponent's name as your own whenever the shuffle swaps them.
import type { LobbyMessage, Seat, StartMessage } from "@/lib/battle-protocol";

export interface BattleIdentity {
  selfSeat: Seat;
  opponentSeat: Seat;
  /** Own server-verified username, or null while it isn't known. Never the opponent's name. */
  self: string | null;
  opponent: string;
}

export function battleIdentity(start: StartMessage, lobby: LobbyMessage | null): BattleIdentity {
  const selfSeat = start.seat;
  const opponentSeat = (1 - start.seat) as Seat;
  return { selfSeat, opponentSeat, self: start.self || lobbySelf(start, lobby), opponent: start.opponent };
}

/** Fallback for servers that predate `start.self`. Uses the lobby only when it
 * clearly belongs to this match: the other join slot holds this opponent. */
function lobbySelf(start: StartMessage, lobby: LobbyMessage | null): string | null {
  if (!lobby) return null;
  const own = lobby.players[lobby.you]?.username;
  const sameMatch = lobby.players.some((p, slot) => slot !== lobby.you && p.username === start.opponent);
  return own && sameMatch && own !== start.opponent ? own : null;
}
