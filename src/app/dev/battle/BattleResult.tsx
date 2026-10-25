"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { EndMessage, SettlementMessage, StartMessage } from "@/lib/battle-protocol";
import type { RankedAwardView } from "@/lib/ranked";
import { GameIcon } from "@/components/game/GameIcon";
import "./battle-result.css";

interface Props {
  start: StartMessage;
  end: EndMessage | null;
  abort: string | null;
  settlement: SettlementMessage | null;
  me: number;
  playerName?: string;
  onExit?: () => void;
  rankedAward?: RankedAwardView | null;
  rankedAwardStatus?: "idle" | "checking" | "awarded" | "unavailable" | "timeout";
}

const reasonText = (reason: string | null) => ({ core: "Core broken", crowns: "Crown lead", overtime: "Overtime tiebreak", timeout: "Time expired" }[reason ?? ""] ?? "Battle complete");
const settlementText = (value: SettlementMessage | null) => {
  if (!value) return "Waiting for result confirmation";
  if (value.status === "settled" || value.status === "already-settled") return "Result recorded";
  if (value.status === "pending") return "Result pending. Retrying in the background.";
  if (value.status === "disabled") return "Result recording is unavailable on this server.";
  return "Result could not be verified.";
};

export default function BattleResult({ start, end, abort, settlement, me, playerName = "You", onExit, rankedAward, rankedAwardStatus }: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDivElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inert: Array<[HTMLElement, boolean]> = [];
    let branch: HTMLElement = node;
    while (branch.parentElement && branch.parentElement !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        inert.push([sibling, sibling.inert]);
        sibling.inert = true;
      }
      branch = branch.parentElement;
    }
    exit.current?.focus({ preventScroll: true });
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Tab") { event.preventDefault(); exit.current?.focus({ preventScroll: true }); }
      if (event.key === "Escape" && onExit) onExit();
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      for (const [element, wasInert] of inert) element.inert = wasInert;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    };
  }, [onExit]);

  const result = end?.result ?? "abort";
  const title = result === "win" ? "Victory" : result === "loss" ? "Defeat" : result === "draw" ? "Draw" : "Battle interrupted";
  const mine = end?.crowns[me] ?? 0;
  const theirs = end?.crowns[1 - me] ?? 0;
  const seconds = end ? Math.floor(end.ticks / start.ticksPerSecond) : 0;
  return (
    <div className="chud-finale" data-result={result} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="chud-finale-title" aria-describedby="chud-finale-context">
      <div className="chud-finale-scrim" />
      <div className="chud-finale-content">
        <p className="chud-finale-kicker">{end ? "Battle complete" : "Connection ended"}</p>
        <div className="chud-finale-emblem" aria-hidden="true"><GameIcon kind={result === "win" ? "victory" : result === "loss" ? "defeat" : "crown"} size={110} /></div>
        <h2 id="chud-finale-title">{title}</h2>
        {end && <div className="chud-finale-versus">
          <div className="chud-finale-ribbon chud-finale-ribbon--foe">
            <span className="chud-finale-name" title={start.opponent}>{start.opponent}</span>
            <div className="chud-finale-crowns" aria-label={`${theirs} crowns`}>
              {Array.from({ length: 3 }, (_, i) => <span key={i} data-earned={i < theirs} style={{ animationDelay: `${2.3 + i * .14}s` }}><GameIcon kind="crown" size={43} /></span>)}
              <strong>{theirs}</strong>
            </div>
          </div>
          <span className="chud-finale-vs" aria-hidden="true">VS</span>
          <div className="chud-finale-ribbon chud-finale-ribbon--mine">
            <span className="chud-finale-name" title={playerName}>{playerName}</span>
            <div className="chud-finale-crowns" aria-label={`${mine} crowns`}>
              {Array.from({ length: 3 }, (_, i) => <span key={i} data-earned={i < mine} style={{ animationDelay: `${2.45 + i * .14}s` }}><GameIcon kind="crown" size={43} /></span>)}
              <strong>{mine}</strong>
            </div>
          </div>
        </div>}
        <div className="chud-finale-details" id="chud-finale-context">
          <p>{end ? `${reasonText(end.reason)} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : abort || "The match ended early."}</p>
          {end && <p aria-live="polite">{settlementText(settlement)}</p>}
          {end && start.mode === "ranked" && <p className="chud-finale-ranked" aria-live="polite">
            {rankedAward ? <><GameIcon kind="trophy" size={22} /> {rankedAward.delta > 0 ? "+" : ""}{rankedAward.delta} trophies · Balance {rankedAward.balanceAfter}</> : rankedAwardStatus === "checking" || rankedAwardStatus === "idle" ? "Confirming the ranked award" : rankedAwardStatus === "timeout" ? "Ranked award pending. Check Progress later." : "No ranked award confirmed."}
          </p>}
        </div>
      </div>
      <div className="chud-finale-footer"><button ref={exit} type="button" className="chud-finale-exit" onClick={onExit ?? (() => { router.push("/app/play"); })}>Back to lobby <span aria-hidden="true">›</span></button></div>
    </div>
  );
}
