"use client";

import RoomInvite from "./RoomInvite";
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
  const practiceOpponent = lobby.practice?.opponent;
  const isPractice = practiceOpponent?.kind === "bot" || lobby.match?.mode === "practice";
  const opponent = lobby.players.find((_, index) => index !== lobby.you);
  const opponentName = practiceOpponent?.displayName ?? opponent?.username ?? lobby.match?.opponent ?? "Open seat";
  const opponentReady = isPractice ? true : !!opponent?.ready;
  const opponentStatus = isPractice
    ? `${practiceOpponent?.difficulty === "medium" ? "Medium" : practiceOpponent?.difficulty ?? "Practice"} difficulty · no rewards`
    : opponent?.username ? opponent.ready ? "Ready" : "Not ready" : "Waiting to join";
  const seconds = lobby.match && now > 0 ? Math.max(0, Math.ceil((lobby.match.deadlineAt - now) / 1000)) : null;
  return (
    <section className="battle-lobby" aria-label="Battle ready room">
      <header className="battle-lobby-heading">
        <div><span className="lp-eyebrow">{isPractice ? "Practice arena" : lobby.match ? "Opponent found" : "Private battle"}</span><h1>{isPractice ? "Practice against AI" : lobby.locked ? "Battle Incoming" : "Prepare for Battle"}</h1></div>
        {lobby.match ? <div className="battle-lobby-countdown" role="status"><GameIcon kind="ready" size={24} /><span>{lobby.locked ? "Checking loadouts" : seconds === null ? "Ready check" : `${seconds}s to ready up`}</span></div> : roomCode && <RoomInvite roomCode={roomCode} />}
      </header>
      <div className="battle-lobby-duel" aria-label="Player readiness">
        <div className={`battle-lobby-player${ownPlayer?.ready ? " battle-lobby-player--ready" : ""}`}><GameIcon kind={ownPlayer?.ready ? "ready" : "crown"} size={28} /><div><span>You</span><strong>{ownPlayer?.username || "Your seat"}</strong><small>{ownPlayer?.ready ? "Ready" : "Not ready"}</small></div></div>
        <span className="battle-lobby-vs" aria-hidden="true">VS</span>
        <div className={`battle-lobby-player battle-lobby-player--opponent${opponentReady ? " battle-lobby-player--ready" : ""}`} data-opponent-kind={isPractice ? "bot" : "human"}><GameIcon kind={opponentReady ? "ready" : "crown"} size={28} /><div><span>{isPractice ? "AI Opponent" : "Opponent"}</span><strong>{opponentName}</strong><small>{opponentStatus}</small></div></div>
      </div>
      {isPractice
        ? <p className="battle-lobby-invite">Choose your loadout, then confirm to start a live practice match against the server&apos;s AI Opponent. Practice currently has no rewards or progression.</p>
        : !lobby.match && <p className="battle-lobby-invite">Invite a friend with the link or room code. Both players must confirm their loadout to begin.</p>}
      <LoadoutPicker {...picker} lobby={lobby} mine={lobby.mine} />
    </section>
  );
}
