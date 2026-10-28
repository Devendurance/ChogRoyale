"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { EndMessage, SettlementMessage, StartMessage } from "@/lib/battle-protocol";
import type { RankedAwardView } from "@/lib/ranked";
import { GameIcon } from "@/components/game/GameIcon";
import type { BattleCue } from "./battle-audio";
import { finaleView, opponentNameFor, practiceDifficultyLabel, tallyAt } from "./battle-result-model";
import "./battle-result.css";

interface Props {
  start: StartMessage;
  end: EndMessage | null;
  abort: string | null;
  settlement: SettlementMessage | null;
  me: number;
  playerName?: string;
  onExit?: () => void;
  onAgain?: () => void;
  onAudioCue?: (cue: BattleCue) => void;
  rankedAward?: RankedAwardView | null;
  rankedAwardStatus?: "idle" | "checking" | "awarded" | "unavailable" | "timeout";
}

/** Ribbons land 0.75s after the reveal starts, then each crown step takes 0.34s. */
const TALLY_LEAD_MS = 750;
const TALLY_STEP_MS = 340;

function Ribbon({ side, name, crowns, shown, winner, you }: { side: "foe" | "mine"; name: string | null; crowns: number; shown: number; winner: boolean; you?: boolean }) {
  return (
    <div className={`chud-finale-ribbon chud-finale-ribbon--${side}`} data-winner={winner}>
      <div className="chud-finale-who">
        {you && <i className="chud-finale-you">You</i>}
        {name && <span className="chud-finale-name" title={name}>{name}</span>}
        {winner && <span className="chud-finale-badge">Winner</span>}
      </div>
      <div className="chud-finale-crowns" role="img" aria-label={`${crowns} ${crowns === 1 ? "crown" : "crowns"}`}>
        {Array.from({ length: 3 }, (_, i) => <span key={i} data-earned={i < shown} aria-hidden="true"><GameIcon kind="crown" size={44} /></span>)}
        <strong aria-hidden="true">{shown}</strong>
      </div>
    </div>
  );
}

export default function BattleResult({ start, end, abort, settlement, me, playerName, onExit, onAgain, onAudioCue, rankedAward, rankedAwardStatus }: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDivElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  const view = finaleView(end, abort, me, settlement, start.ticksPerSecond, start.mode);
  const opponent = opponentNameFor(start, view.practice);
  const practiceDifficulty = view.practice ? practiceDifficultyLabel(start.practiceOpponent?.difficulty) : null;
  const goBack = () => { onExit?.(); if (!onExit) router.push("/app/play"); };
  const goAgain = () => { onAgain?.(); if (!onAgain) router.push("/app/play/battle?mode=practice"); };
  const [reduced] = useState(() => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [step, setStep] = useState(() => (reduced ? 3 : 0));
  const cue = useRef(onAudioCue);
  useEffect(() => { cue.current = onAudioCue; }, [onAudioCue]);

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
    (view.practice ? again.current : exit.current)?.focus({ preventScroll: true });
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
        if (buttons.length > 0) {
          event.preventDefault();
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const offset = event.shiftKey ? -1 : 1;
          buttons[(current + offset + buttons.length) % buttons.length]?.focus({ preventScroll: true });
        }
      }
      if (event.key === "Escape" && onExit) onExit();
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      for (const [element, wasInert] of inert) element.inert = wasInert;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    };
  }, [onExit, view.practice]);

  // Presentation-only tally of the server's final crowns. Each step that
  // lights a crown gets one soft tick. Reduced motion shows the final count.
  const top = Math.max(view.mine, view.theirs);
  useEffect(() => {
    if (reduced || !end || top === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let next = 1; next <= top; next++) {
      timers.push(setTimeout(() => { setStep(next); cue.current?.("crown-tally"); }, view.revealDelayMs + TALLY_LEAD_MS + (next - 1) * TALLY_STEP_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [end, reduced, top, view.revealDelayMs]);

  const style = { "--fd": `${view.revealDelayMs / 1000}s` } as CSSProperties;
  return (
    <div className="chud-finale" data-result={view.result} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="chud-finale-title" aria-describedby="chud-finale-context" style={style}>
      <div className="chud-finale-scrim" />
      <div className="chud-finale-content">
        <p className="chud-finale-kicker">{view.kicker}</p>
        <div className="chud-finale-emblem" aria-hidden="true"><GameIcon kind={view.result === "win" ? "victory" : view.result === "loss" ? "defeat" : "crown"} size={112} /></div>
        <h2 id="chud-finale-title">{view.title}</h2>
        <p className="chud-finale-context" id="chud-finale-context">{view.context}</p>
        {view.practice && <p className="chud-finale-practice-meta" data-difficulty={practiceDifficulty?.toLowerCase() ?? "unknown"}>{opponent}{practiceDifficulty ? ` · ${practiceDifficulty} difficulty` : ""}</p>}
        {end && <div className="chud-finale-versus">
          <Ribbon side="mine" name={playerName ?? null} crowns={view.mine} shown={tallyAt(step, view.mine)} winner={view.winner === "mine"} you />
          <span className="chud-finale-vs" aria-hidden="true">VS</span>
          <Ribbon side="foe" name={opponent} crowns={view.theirs} shown={tallyAt(step, view.theirs)} winner={view.winner === "theirs"} />
        </div>}
        {(view.settlement || view.noRewards) && <div className="chud-finale-details">
          {view.noRewards && <p className="chud-finale-settle chud-finale-no-rewards" data-state="no-rewards" aria-live="polite"><i aria-hidden="true" />{view.noRewards}</p>}
          {view.settlement && <p className="chud-finale-settle" data-state={view.settlement.state} aria-live="polite"><i aria-hidden="true" />{view.settlement.text}</p>}
          {view.settlement && start.mode === "ranked" && <p className="chud-finale-ranked" aria-live="polite">
            {rankedAward ? <><GameIcon kind="trophy" size={22} /> {rankedAward.delta > 0 ? "+" : ""}{rankedAward.delta} trophies · Balance {rankedAward.balanceAfter}</> : rankedAwardStatus === "checking" || rankedAwardStatus === "idle" ? "Confirming the ranked award" : rankedAwardStatus === "timeout" ? "Ranked award pending. Check Progress later." : "No ranked award confirmed."}
          </p>}
        </div>}
      </div>
      <div className="chud-finale-footer">
        <div className={`chud-finale-actions${view.practice ? " chud-finale-actions--practice" : ""}`}>
          {view.practice && <button ref={again} type="button" className="chud-finale-exit" onClick={goAgain}>Battle Again <span aria-hidden="true">↻</span></button>}
          <button ref={exit} type="button" className={`chud-finale-exit${view.practice ? " chud-finale-exit--secondary" : ""}`} onClick={goBack}>{view.practice ? "Back to Battle Hall" : "Back to lobby"} <span aria-hidden="true">›</span></button>
        </div>
      </div>
    </div>
  );
}
