"use client";

import { useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { battleInviteUrl, copyInviteText, validRoomCode } from "@/lib/battle-invite";
import { uiSound } from "@/components/audio/ui-interactions";
import "./room-invite.css";

export default function RoomInvite({ roomCode }: { roomCode: string }) {
  const [feedback, setFeedback] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  if (!validRoomCode(roomCode)) return null;
  async function copy(value: string, label: string) {
    const copied = await copyInviteText(value);
    setFeedback(copied ? `Copied! ${label} is ready to paste.` : "Copy unavailable. Select and copy the text below.");
    setManual(copied ? null : value);
    if (copied) uiSound("invite");
    return copied;
  }
  async function share() {
    const url = battleInviteUrl(window.location.origin, roomCode);
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Chog Royale private battle", text: "Join my private room in Chog Royale.", url });
        setFeedback("Invitation shared");
        uiSound("invite");
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    await copy(url, "Invite link");
  }
  return <div className="battle-room-invite">
    <span>Room Code</span>
    <button className="battle-room-invite-code" type="button" data-audio-skip="true" aria-label={`Copy room code ${roomCode}`} onClick={() => void copy(roomCode, "Room code")}><strong>{roomCode}</strong><Copy size={18} aria-hidden="true" /></button>
    <div className="battle-room-invite-actions">
      <button type="button" data-audio-skip="true" onClick={() => void share()}><Share2 size={17} aria-hidden="true" />Share Invite</button>
      <button type="button" data-audio-skip="true" onClick={() => { const url = battleInviteUrl(window.location.origin, roomCode); if (url) void copy(url, "Invite link"); }}><Copy size={17} aria-hidden="true" />Copy Invite Link</button>
    </div>
    <span className="battle-room-invite-feedback" role="status" aria-live="polite">{feedback}</span>
    {manual && <input aria-label="Invitation text to copy" value={manual} readOnly onFocus={(event) => event.currentTarget.select()} />}
  </div>;
}
