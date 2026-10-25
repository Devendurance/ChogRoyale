"use client";

import { GameIcon } from "@/components/game/GameIcon";
import LoadoutPicker, { type LoadoutPickerProps } from "./LoadoutPicker";
import "./loadout-picker.css";

export type BattleLobbyProps = Omit<LoadoutPickerProps, "mine"> & {
  roomCode?: string;
  now: number;
};

/** The production ready room. Readiness and the locked state come from the server. */
export default function BattleLobby({ lobby, roomCode, now, ...picker }: BattleLobbyProps) {
  const ownPlayer = lobby.players[lobby.you];
  const opponent = lobby.players.find((_, index) => index !== lobby.you);
  const seconds = lobby.match && now > 0 ? Math.max(0, Math.ceil((lobby.match.deadlineAt - now) / 1000)) : null;
  return (
    <section className="battle-lobby" aria-label="Battle ready room">
      <header className="battle-lobby-heading">
        <div><span className="lp-eyebrow">{lobby.match ? "Opponent found" : "Private battle"}</span><h1>{lobby.locked ? "Battle Incoming" : "Prepare for Battle"}</h1></div>
        {lobby.match ? <div className="battle-lobby-countdown" role="status"><GameIcon kind="ready" size={24} /><span>{lobby.locked ? "Checking loadouts" : seconds === null ? "Ready check" : `${seconds}s to ready up`}</span></div> : roomCode && <div className="battle-lobby-code"><span>Room Code</span><strong>{roomCode}</strong></div>}
      </header>
      <div className="battle-lobby-duel" aria-label="Player readiness">
        <div className={`battle-lobby-player${ownPlayer?.ready ? " battle-lobby-player--ready" : ""}`}><GameIcon kind={ownPlayer?.ready ? "ready" : "crown"} size={28} /><div><span>You</span><strong>{ownPlayer?.username || "Your seat"}</strong><small>{ownPlayer?.ready ? "Ready" : "Not ready"}</small></div></div>
        <span className="battle-lobby-vs" aria-hidden="true">VS</span>
        <div className={`battle-lobby-player battle-lobby-player--opponent${opponent?.ready ? " battle-lobby-player--ready" : ""}`}><GameIcon kind={opponent?.ready ? "ready" : "crown"} size={28} /><div><span>Opponent</span><strong>{opponent?.username || lobby.match?.opponent || "Open seat"}</strong><small>{opponent?.username ? opponent.ready ? "Ready" : "Not ready" : "Waiting to join"}</small></div></div>
      </div>
      {!lobby.match && <p className="battle-lobby-invite">Share your room code with a friend. Both players must confirm their loadout to begin.</p>}
      <LoadoutPicker {...picker} lobby={lobby} mine={lobby.mine} />
    </section>
  );
}
