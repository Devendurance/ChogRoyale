"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { AccountXpMessage, BotCardXpMessage, BotGoldMessage, EndMessage, SettlementMessage, StartMessage } from "@/lib/battle-protocol";
import type { RankedAwardView } from "@/lib/ranked";
import { GameIcon } from "@/components/game/GameIcon";
import type { BattleCue } from "./battle-audio";
import { finaleView, opponentNameFor, practiceDifficultyLabel, tallyAt } from "./battle-result-model";
import { botGoldView } from "./bot-gold-model";
import { botCardXpView } from "./bot-card-xp-model";
import { accountXpRewardView, validateAccountXpReward, type AccountXpRewardPresentation } from "./account-xp-reward-model";
import { Portrait } from "./portrait";
import { portraitCandidatesForCard, type SpriteManifest } from "./sprite-registry";
import "./battle-result.css";

interface Props {
  start: StartMessage;
  end: EndMessage | null;
  abort: string | null;
  settlement: SettlementMessage | null;
  /** Server-authoritative reward outcome for an Unranked AI fallback. */
  botGold?: BotGoldMessage | null;
  /** Latest server-confirmed Gold balance, when the caller has reread it. */
  goldBalance?: number | null;
  goldBalanceStatus?: "idle" | "loading" | "ready" | "unavailable";
  /** Server-authoritative Card XP outcome for an Unranked AI fallback. */
  botCardXp?: BotCardXpMessage | null;
  /** Status of the authenticated Card XP progression readback. */
  cardXpReadbackStatus?: "idle" | "loading" | "ready" | "unavailable";
  /** Server-authoritative Account XP receipt for this result. */
  accountXp?: AccountXpMessage | null;
  /** Reconnect lookup state when the receipt itself is not available. */
  accountXpStatus?: AccountXpMessage["status"] | "unknown";
  /** Authenticated Account XP readback state, used to keep missing receipts neutral. */
  accountXpReadbackStatus?: "idle" | "loading" | "ready" | "unavailable";
  /** Loaded card-art manifest. Missing art falls back to the card name tile. */
  spriteManifest?: SpriteManifest | null;
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

type AccountXpDisplayState = AccountXpRewardPresentation["state"] | "unknown";
interface AccountXpDisplay {
  state: AccountXpDisplayState;
  title: string;
  text: string;
  amount: number | null;
  totalXp: number | null;
  levelBefore: number | null;
  levelAfter: number | null;
  leveledUp: boolean;
}

function accountXpDisplay(
  value: AccountXpMessage | null | undefined,
  statusHint: AccountXpDisplayState | undefined,
  matchId: string | null | undefined,
  source: "matchmaking" | "unranked-fallback",
): AccountXpDisplay {
  if (!value) {
    if (statusHint === "pending") {
      return { state: "pending", title: "Account XP verification pending", text: "Check your account progression later.", amount: null, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: false };
    }
    if (statusHint === "refused") {
      return { state: "refused", title: "No Account XP awarded", text: "The server did not award Account XP for this battle.", amount: null, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: false };
    }
    if (statusHint === "capped") {
      return { state: "capped", title: "Account XP limit reached", text: "The Account XP daily limit has been reached.", amount: null, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: false };
    }
    return { state: "unknown", title: "Account XP outcome unknown", text: "No server receipt arrived, so no Account XP amount is shown.", amount: null, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: false };
  }

  if (!matchId) return { state: "unknown", title: "Account XP outcome unknown", text: "The Account XP receipt could not be verified for this battle.", amount: null, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: false };
  const validation = validateAccountXpReward(value, { matchId, source });
  if (!validation.ok) return { state: "unknown", title: "Account XP outcome unknown", text: "The Account XP receipt could not be verified for this battle.", amount: null, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: false };
  const reward = accountXpRewardView(validation.receipt, { matchId, source });
  return reward.state === "no-message" ? { ...reward, state: "unknown" } : reward;
}

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

export default function BattleResult({ start, end, abort, settlement, botGold, goldBalance, goldBalanceStatus, botCardXp, cardXpReadbackStatus, accountXp, accountXpStatus, accountXpReadbackStatus, spriteManifest, me, playerName, onExit, onAgain, onAudioCue, rankedAward, rankedAwardStatus }: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDivElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  const view = finaleView(end, abort, me, settlement, start.ticksPerSecond, start.mode, start.practiceOpponent?.source);
  const opponent = opponentNameFor(start, view.practice);
  const practiceDifficulty = view.practice ? practiceDifficultyLabel(start.practiceOpponent?.difficulty) : null;
  const reward = view.origin === "unranked-fallback" && end
    ? botGoldView(botGold, end.matchId ?? undefined)
    : null;
  const cardXpReward = view.origin === "unranked-fallback" && end
    ? botCardXpView(botCardXp, end.matchId ?? undefined)
    : null;
  const cardXpState = cardXpReward?.eligibility === "awaiting-gold" && cardXpReward.state === "pending"
    ? "awaiting-gold"
    : cardXpReward?.eligibility === "not-xp-eligible"
      ? "not-eligible"
      : cardXpReward?.state;
  const cardXpTitle = cardXpReward?.eligibility === "awaiting-gold"
    ? "Card XP waiting for Gold confirmation"
    : cardXpReward?.title;
  const cardXpText = cardXpReward?.eligibility === "awaiting-gold"
    ? "Card XP is recorded only after the server confirms Gold."
    : cardXpReward?.text;
  const showAccountXp = Boolean(end && (view.origin === "unranked-fallback" || (view.origin === "human" && start.mode === "matchmaking")));
  const accountXpRewardBase = showAccountXp
    ? accountXpDisplay(accountXp, accountXpStatus, end?.matchId, view.origin === "unranked-fallback" ? "unranked-fallback" : "matchmaking")
    : null;
  const accountXpReward = accountXpRewardBase && accountXpRewardBase.state === "unknown" && accountXpReadbackStatus === "unavailable"
    ? { ...accountXpRewardBase, title: "Account XP unavailable", text: "Account progression is not available yet. Check Progress later." }
    : accountXpRewardBase;
  const rewardMessage = reward?.message;
  const goldBalanceText = typeof goldBalance === "number" && Number.isFinite(goldBalance) && goldBalance >= 0
    ? Math.trunc(goldBalance).toLocaleString("en-US")
    : null;
  const rewardHasAmount = reward?.state === "confirmed" || reward?.state === "duplicate";
  const cardXpHasAmount = cardXpReward?.state === "confirmed" || cardXpReward?.state === "duplicate";
  const noRewardCopy = reward?.state === "no-message" ? reward.text : reward ? null : view.noRewards;
  const goBack = () => { onExit?.(); if (!onExit) router.push("/app/play"); };
  const hasAgainAction = view.origin === "practice" || (view.origin === "unranked-fallback" && Boolean(onAgain));
  const goAgain = () => {
    if (onAgain) {
      onAgain();
      return;
    }
    if (view.origin === "practice") router.push("/app/play/battle?mode=practice");
  };
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
    (hasAgainAction ? again.current : exit.current)?.focus({ preventScroll: true });
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
  }, [hasAgainAction, onExit]);

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
        {(view.settlement || noRewardCopy || (reward && reward.state !== "no-message") || cardXpReward || accountXpReward) && <div className="chud-finale-details">
          {noRewardCopy && <p className="chud-finale-settle chud-finale-no-rewards" data-state="no-rewards" aria-live="polite"><i aria-hidden="true" />{noRewardCopy}</p>}
          {accountXpReward && <section className="chud-finale-account-xp" data-state={accountXpReward.state} aria-labelledby="chud-finale-account-xp-title">
            <div className="chud-finale-account-xp-main">
              <span className="chud-finale-account-xp-mark" aria-hidden="true">LV</span>
              <span>
                <strong id="chud-finale-account-xp-title">{accountXpReward.title}</strong><br />
                <span>{accountXpReward.text}</span>
              </span>
            </div>
            {accountXpReward.state === "confirmed" && accountXpReward.totalXp !== null && <p>Lifetime Account XP: {accountXpReward.totalXp.toLocaleString("en-US")}</p>}
            {accountXpReward.state === "confirmed" && accountXpReward.leveledUp && accountXpReward.levelBefore !== null && accountXpReward.levelAfter !== null && <div className="chud-finale-account-xp-levelup" role="status" aria-live="polite" aria-atomic="true">
              <span aria-hidden="true">✦</span>
              <strong>Level up!</strong>
              <span>Account Level {accountXpReward.levelBefore} → {accountXpReward.levelAfter}</span>
              {accountXpReward.levelAfter === 100 && <strong>MAX LEVEL</strong>}
              <span aria-hidden="true">✦</span>
            </div>}
          </section>}
          {reward && reward.state !== "no-message" && <div className="chud-finale-gold" data-state={reward.state} aria-live="polite">
            <div className="chud-finale-gold-main"><span className="chud-finale-gold-mark" aria-hidden="true">G</span><span><strong>{reward.title}</strong><br /><span>{reward.text}</span></span></div>
            {rewardHasAmount && rewardMessage && <p>Daily AI rewards: {rewardMessage.rewardedToday} / {rewardMessage.dailyCap}</p>}
            {rewardHasAmount && goldBalanceText !== null && <p>Gold balance: {goldBalanceText}</p>}
            {rewardHasAmount && goldBalanceText === null && goldBalanceStatus === "loading" && <p>Checking Gold balance...</p>}
            {rewardHasAmount && goldBalanceText === null && goldBalanceStatus === "unavailable" && <p>Gold balance refresh unavailable.</p>}
            {reward.state === "duplicate" && <p>Already recorded for this battle.</p>}
          </div>}
          {cardXpReward && <div className="chud-finale-card-xp" data-state={cardXpState} aria-live="polite">
            <div className="chud-finale-card-xp-main"><span className="chud-finale-card-xp-mark" aria-hidden="true">XP</span><span><strong>{cardXpTitle}</strong><br /><span>{cardXpText}</span></span></div>
            {cardXpHasAmount && cardXpReward.message && <p>Daily AI Card XP: {cardXpReward.message.rewardedToday} / {cardXpReward.message.dailyCap}</p>}
            {cardXpHasAmount && cardXpReward.awardedCards.length > 0 && <ul className="chud-finale-card-xp-list" aria-label="Cards that earned Card XP">
              {cardXpReward.awardedCards.map((award) => {
                const card = start.catalog?.[award.cardId];
                const cardName = card?.name ?? "Card";
                const portrait = spriteManifest && card ? portraitCandidatesForCard(spriteManifest, award.cardId) : null;
                return <li key={award.cardId}>
                  <Portrait src={portrait} name={cardName} className="chud-finale-card-xp-portrait" />
                  <span className="chud-finale-card-xp-card-name" title={cardName}>{cardName}</span>
                  <span className="chud-finale-card-xp-card-value">+{award.xp} XP</span>
                </li>;
              })}
            </ul>}
            {cardXpHasAmount && cardXpReadbackStatus === "ready" && <p>Card progress readback confirmed.</p>}
            {cardXpHasAmount && cardXpReadbackStatus === "loading" && <p>Checking Card XP progress...</p>}
            {cardXpHasAmount && cardXpReadbackStatus === "unavailable" && <p>Card XP progress readback unavailable.</p>}
            {cardXpReward.state === "duplicate" && <p>Already recorded for this battle.</p>}
          </div>}
          {view.settlement && <p className="chud-finale-settle" data-state={view.settlement.state} aria-live="polite"><i aria-hidden="true" />{view.settlement.text}</p>}
          {view.settlement && start.mode === "ranked" && <p className="chud-finale-ranked" aria-live="polite">
            {rankedAward ? <><GameIcon kind="trophy" size={22} /> {rankedAward.delta > 0 ? "+" : ""}{rankedAward.delta} trophies · Balance {rankedAward.balanceAfter}</> : rankedAwardStatus === "checking" || rankedAwardStatus === "idle" ? "Confirming the ranked award" : rankedAwardStatus === "timeout" ? "Ranked award pending. Check Progress later." : "No ranked award confirmed."}
          </p>}
        </div>}
      </div>
      <div className="chud-finale-footer">
        <div className={`chud-finale-actions${view.practice ? " chud-finale-actions--practice" : ""}`}>
          {hasAgainAction && view.againLabel && <button ref={again} type="button" className="chud-finale-exit" onClick={goAgain}>{view.againLabel} <span aria-hidden="true">↻</span></button>}
          <button ref={exit} type="button" className={`chud-finale-exit${hasAgainAction ? " chud-finale-exit--secondary" : ""}`} onClick={goBack}>{view.practice ? "Back to Battle Hall" : "Back to lobby"} <span aria-hidden="true">›</span></button>
        </div>
      </div>
    </div>
  );
}
