"use client";

// B2.8e portrait-first battle HUD. Presentational only: page.tsx owns all
// state, networking and gestures; every intent still flows through the same
// send/deploy path and the same card pointer handlers.
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type {
  AbilityView,
  AckMessage,
  BattleFrame,
  CardInfo,
  EndMessage,
  PresenceMessage,
  SettlementMessage,
  StartMessage,
} from "@/lib/battle-protocol";
import type { ArenaPoint } from "@/lib/battle-input";
import type { RankedAwardView } from "@/lib/ranked";
import type { BoardMapper, CanvasFeed } from "./BattleCanvas";

// Phaser must stay client-only, same as page.tsx's original dynamic import.
const BattleCanvas = dynamic(() => import("./BattleCanvas"), { ssr: false });
import { Portrait } from "./portrait";
import { useSpriteManifest } from "./use-sprite-manifest";
import { portraitForCard, portraitForCommanderClass, type SpriteManifest } from "./sprite-registry";
import { abilityView, scoreView, timerView } from "./hud-view";
import { satoshi, georama, lilitaOne } from "@/components/site/fonts";
import "./battle-hud.css";

// Display-only copy of energyPhaseMult (src/lib/combat.ts). combat.ts imports
// node crypto so it cannot ship to the client; keep thresholds in sync.
const phaseMult = (tick: number) => (tick >= 2400 ? 3 : tick >= 1200 ? 2 : 1);

const isCommanderCard = (id: string) => id.startsWith("cmdr:");

const secs = (ticks: number) => `${Math.floor(ticks / 600)}:${String(Math.floor((ticks % 600) / 10)).padStart(2, "0")}`;

const abilityLabel = (abilityId: string, cls: string) => {
  const base = abilityId.startsWith(`${cls}-`) ? abilityId.slice(cls.length + 1) : abilityId;
  return base.split("-").map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
};

const nftImageUrl = (u: string) => (u.startsWith("ipfs://") ? `https://ipfs.filebase.io/ipfs/${u.slice(7)}` : u);

export interface BattleHudProps {
  /** Keep development-only room diagnostics out of the player-facing route. */
  showDevDiagnostics?: boolean;
  connectionStatus?: string;
  error?: string | null;
  notice?: string | null;
  onGiveUp?: () => void;
  onExit?: () => void;
  start: StartMessage;
  frame: BattleFrame | null;
  me: number;
  end: EndMessage | null;
  abort: string | null;
  settlement: SettlementMessage | null;
  rankedAward?: RankedAwardView | null;
  rankedAwardStatus?: "idle" | "checking" | "awarded" | "unavailable" | "timeout";
  presence: PresenceMessage | null;
  now: number;
  acks: Array<AckMessage & { label: string }>;
  selected: string | null;
  dragging: string | null;
  hint: string | null;
  feed: React.RefObject<CanvasFeed | null>;
  mapRef: React.RefObject<BoardMapper | null>;
  onBoardTap: (at: ArenaPoint) => void;
  onBoardHover: (at: ArenaPoint | null) => void;
  onCardPointerDown: (id: string) => (e: React.PointerEvent<HTMLButtonElement>) => void;
  onCardPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onCardPointerEnd: (cancelled: boolean) => (e: React.PointerEvent<HTMLButtonElement>) => void;
  suppressClickUntil: React.RefObject<number>;
  onSelectCard: (id: string | null) => void;
  send: (cmd: Record<string, unknown>, label: string) => void;
  /** Drag ghost element plumbing owned by page.tsx gesture state. */
  previewRef: React.RefObject<HTMLDivElement | null>;
  lastAim: React.RefObject<{ x: number; y: number }>;
  placePreview: (el: HTMLDivElement | null, clientX: number, clientY: number) => void;
}

function portraitSrc(manifest: SpriteManifest | null, cardId: string, commanderCls: string): string | null {
  if (!manifest) return null;
  if (isCommanderCard(cardId)) return portraitForCommanderClass(manifest, commanderCls);
  return portraitForCard(manifest, cardId);
}

function CardButton({
  id,
  card,
  manifest,
  commanderCls,
  energy,
  energyProgress,
  selected,
  dragging,
  handlers,
  onSelect,
}: {
  id: string;
  card: CardInfo | undefined;
  manifest: SpriteManifest | null;
  commanderCls: string;
  energy: number;
  energyProgress: number;
  selected: boolean;
  dragging: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onLostPointerCapture: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
  };
  onSelect: (id: string | null) => void;
}) {
  const cost = card?.cost ?? 0;
  const afford = cost <= energy;
  const fill = cost > 0 ? Math.min(1, (energy + energyProgress) / cost) : 1;
  const src = portraitSrc(manifest, id, commanderCls);
  return (
    <button
      data-card={id}
      aria-pressed={selected}
      {...handlers}
      onClick={() => onSelect(id)}
      className="chud-card"
      data-selected={selected}
      data-afford={afford}
      aria-label={`${card?.name ?? id}, ${cost} energy${!afford ? ", not enough energy" : ""}${isCommanderCard(id) ? ", commander class art" : ""}`}
      style={{
        transform: selected ? "translateY(-4px)" : "none",
        opacity: dragging ? 0.3 : 1,
      }}
    >
      <Portrait src={src} name={card?.name ?? id} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", filter: afford ? undefined : "grayscale(0.85)" }} />
      {!afford && (
        <div
          className="chud-card-lockfill"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `${fill * 100}%`,
            background: "linear-gradient(to top, #7c3aed55, #7c3aed22)",
          }}
        />
      )}
      {!afford && <div style={{ position: "absolute", inset: 0, background: "#0009" }} />}
      <span
        className="chud-cost"
      >
        {card?.cost ?? "?"}
      </span>
      {isCommanderCard(id) && <span className="chud-class-art">Class art</span>}
      <span className="chud-name">{card?.name ?? id}</span>
    </button>
  );
}

function EnergyMeter({ frame }: { frame: BattleFrame }) {
  const fill = Math.max(0, Math.min(10, frame.energy + frame.energyProgress));
  const mult = phaseMult(frame.tick + 1);
  const chaosMod = Math.abs(frame.regenMult - mult) > 0.01;
  return (
    <div className="chud-energy">
      <div className="chud-energy-cells">
        {Array.from({ length: 10 }, (_, i) => {
          const f = Math.max(0, Math.min(1, fill - i));
          return (
            <div key={i} className="chud-cell">
              <div className="chud-cell-fill" style={{ width: `${f * 100}%` }} />
            </div>
          );
        })}
      </div>
      <span className="chud-energy-num">{frame.energy}/10</span>
      <span className="chud-mult">{mult}x</span>
      {chaosMod && <span className="chud-mult chud-chaos-mod">Chaos x{frame.regenMult.toFixed(2)}</span>}
    </div>
  );
}

/** Original crown mark (not Clash Royale art). */
const CrownIcon = ({ color }: { color: string }) => (
  <svg width="11" height="9" viewBox="0 0 12 10" aria-hidden="true" style={{ verticalAlign: "-1px" }}>
    <path d="M1 8.5h10l-.6-5L8 5.5 6 2 4 5.5 1.6 3.5z" fill={color} />
  </svg>
);

function AbilityButton({
  a,
  frame,
  start,
  manifest,
  acks,
  send,
}: {
  a: AbilityView;
  frame: BattleFrame;
  start: StartMessage;
  manifest: SpriteManifest | null;
  acks: Array<AckMessage & { label: string }>;
  send: BattleHudProps["send"];
}) {
  const [flash, setFlash] = useState(false);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const ack = acks.find((x) => x.ok && x.label === `ability ${a.abilityId}`);
    if (ack && ack.cid + ack.tick !== seen.current) {
      seen.current = ack.cid + ack.tick;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(t);
    }
  }, [acks, a.abilityId]);
  const v = abilityView(a, frame.tick);
  const sub =
    v.label === "READY" ? "READY" : v.label === "ACTIVE" ? "active" : v.label === "BLOCKED" ? (v.blockedBy ?? "blocked") : `${v.cooldownSecs}s`;
  return (
    <button
      className="chud-ability"
      data-ability={a.abilityId}
      data-state={v.label}
      disabled={v.disabled}
      title={`${abilityLabel(a.abilityId, start.commander.class)} · ${a.cost}e · Commander class art${a.blockedBy ? ` · ${a.blockedBy}` : ""}`}
      onClick={() => send({ type: "ability", abilityId: a.abilityId }, `ability ${a.abilityId}`)}
      style={{ boxShadow: flash ? "0 0 0 2px #4ade80" : undefined }}
    >
      <Portrait src={manifest ? portraitForCommanderClass(manifest, start.commander.class) : null} name={start.commander.class} style={{ width: 38, height: 38, borderRadius: 5, flex: "none" }} />
      <span className="chud-ability-info">
        <span className="chud-ability-name">{abilityLabel(a.abilityId, start.commander.class)}</span>
        <span className="chud-ability-sub" data-ready={v.label === "READY"}>
          {sub}
        </span>
      </span>
      <span className="chud-cost chud-ability-cost">{a.cost}</span>
      <span className="chud-ability-cd">
        <span className="chud-ability-cd-fill" style={{ width: `${(1 - v.cooldownFrac) * 100}%` }} />
      </span>
    </button>
  );
}

function DevPanel({ end, acks, start, frame, me }: { end: EndMessage | null; acks: Array<AckMessage & { label: string }>; start: StartMessage; frame: BattleFrame | null; me: number }) {
  const order = (s: { kind: string; x: number }) => (s.kind === "core" ? 1 : 0);
  return (
    <div className="chud-dev">
      <div className="chud-dev-towers">
        {(frame?.structures ?? [])
          .slice()
          .sort((a, b) => a.owner - b.owner || order(a) - order(b) || a.x - b.x)
          .map((s) => (
            <span key={s.id} className="chud-pill" data-owner={s.owner === me ? "you" : "foe"} data-dead={!s.alive}>
              {s.kind === "core" ? "Core" : "T"} {s.alive ? s.hp : "x"}
            </span>
          ))}
      </div>
      {end && (
        <div>
          replay {end.replayIdentical ? "identical" : "MISMATCH"} · {end.commands} commands · hash {end.stateHash.slice(0, 12)}
          {end.matchId ? ` · match ${end.matchId.slice(0, 8)}` : ""}
        </div>
      )}
      <div>
        commander card {start.commander.cardId} · {start.commander.kind}
        {start.commander.tokenId ? ` · token ${start.commander.tokenId}` : ""} · {start.commander.basis}
      </div>
      <div>patron token {start.patron.tokenId}</div>
      <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
        {acks.map((a) => (
          <li key={a.cid + a.tick} style={{ color: a.ok ? "#86efac" : "#fca5a5" }}>
            t{a.tick} {a.label} {a.ok ? "accepted" : `rejected: ${a.reason}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

const settlementText = (s: SettlementMessage | null) =>
  !s
    ? "Settlement status pending…"
    : s.status === "settled" || s.status === "already-settled"
      ? `Result recorded (${s.status})${s.matchId ? ` · ${s.matchId.slice(0, 8)}` : ""}`
      : s.status === "pending"
        ? "Result pending, retrying in background"
        : s.status === "disabled"
          ? "Settlement disabled on this server"
          : "Result refused by settlement verification";

const resultReasonText = (reason: string | null) => {
  switch (reason) {
    case "core":
      return "Core broken";
    case "crowns":
      return "Crown lead";
    case "overtime":
      return "Overtime tiebreak";
    case "timeout":
      return "Time expired";
    default:
      return reason || "Battle complete";
  }
};

export default function BattleHud(props: BattleHudProps) {
  const { start, frame, me, end, abort, settlement, presence, now, acks, selected, dragging, hint, feed, mapRef, onBoardTap, onBoardHover, send } = props;
  const manifest = useSpriteManifest();
  const [devOpen, setDevOpen] = useState(false);
  const [banner, setBanner] = useState<number | null>(null);
  const prevMult = useRef(0);
  const score = scoreView(frame, end, me as 0 | 1);
  const prevCrowns = useRef<[number, number]>([score.mine, score.theirs]);
  const [crownPulse, setCrownPulse] = useState<"mine" | "theirs" | null>(null);
  const tv = timerView(frame, end);

  // Short restrained pulse on the side whose crown count just increased.
  useEffect(() => {
    const [pm, pt] = prevCrowns.current;
    prevCrowns.current = [score.mine, score.theirs];
    if (score.mine <= pm && score.theirs <= pt) return;
    setCrownPulse(score.mine > pm ? "mine" : "theirs");
    const t = setTimeout(() => setCrownPulse(null), 900);
    return () => clearTimeout(t);
  }, [score.mine, score.theirs]);

  // 2s non-blocking banner when the energy phase steps up.
  useEffect(() => {
    if (!frame) return;
    const m = phaseMult(frame.tick + 1);
    if (prevMult.current !== 0 && m > prevMult.current) {
      setBanner(m);
      const t = setTimeout(() => setBanner(null), 2000);
      prevMult.current = m;
      return () => clearTimeout(t);
    }
    prevMult.current = m;
  }, [frame]);

  // The fixed HUD owns the viewport during a match; lock body scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const card = (id: string | null) => (id ? start.catalog[id] : undefined);
  const commanderCls = start.commander.class;
  const nextCard = frame?.next ?? null;
  const { previewRef, lastAim } = props;

  const handlersFor = (id: string) => ({
    onPointerDown: props.onCardPointerDown(id),
    onPointerMove: props.onCardPointerMove,
    onPointerUp: props.onCardPointerEnd(false),
    onPointerCancel: props.onCardPointerEnd(true),
    onLostPointerCapture: props.onCardPointerEnd(true),
    onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault(),
  });
  const select = (id: string | null) => {
    if (performance.now() >= props.suppressClickUntil.current) props.onSelectCard(id === selected ? null : id);
  };

  const chaosChips = (frame?.chaos ?? []).map((c) => (
    <div key={c.id} className={`chud-chaos ${c.state}`}>
      {c.state === "warning" ? `Chaos: ${c.name} in ${Math.max(0, Math.ceil((c.activationTick - frame!.tick) / 10))}s` : `${c.name} active`}
    </div>
  ));

  const dev = <DevPanel end={end} acks={acks} start={start} frame={frame} me={me} />;

  const commanderIdentity = (
    <div className="chud-identity">
      {start.commander.kind === "nft" && start.commander.imageOriginal ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={nftImageUrl(start.commander.imageOriginal)} alt={start.commander.name} width={56} height={56} style={{ borderRadius: 6, objectFit: "cover" }} />
      ) : (
        <Portrait src={manifest ? portraitForCommanderClass(manifest, commanderCls) : null} name={commanderCls} style={{ width: 56, height: 56, borderRadius: 6 }} />
      )}
      <div style={{ fontSize: 11 }}>
        <div>{start.commander.name}</div>
        <div className="chud-identity-meta">
          {commanderCls} · {start.commander.variant} · {start.commander.prestige}
          {start.commander.kind === "nft" ? ` · token ${start.commander.tokenId}` : ""}
          {!(start.commander.kind === "nft" && start.commander.imageOriginal) && " · class art"}
        </div>
      </div>
    </div>
  );

  const patronChip = (
    <span className="chud-pill" title={`Arena Patron token ${start.patron.tokenId}`}>
      Arena Patron · {start.patron.name ?? `CHOG #${start.patron.tokenId}`}
    </span>
  );

  const abilityControls = frame && (
    <>
      {frame.abilities.length === 0 && <span className="chud-ability-empty">Deploy your commander to use its ability.</span>}
      {frame.abilities.map((a) => (
        <AbilityButton key={a.abilityId} a={a} frame={frame} start={start} manifest={manifest} acks={acks} send={send} />
      ))}
    </>
  );

  return (
    <div className={`chud ${satoshi.variable} ${georama.variable} ${lilitaOne.variable}`} data-testid="battle-hud">
      <aside className="chud-side chud-side-left">
        <div className="chud-brand">CHOG <span>ROYALE</span><small>CHAOS CROSSING</small></div>
        <div className="chud-side-block">
          <div className="chud-side-title">Arena Patron</div>
          <div style={{ fontSize: 12 }}>
            {start.patron.name ?? `CHOG #${start.patron.tokenId}`}
            <div style={{ color: "#9ca3af" }}>
              {start.patron.tier ?? "Unranked"} · {start.patron.theme} · token {start.patron.tokenId}
            </div>
          </div>
        </div>
        <div className="chud-side-block">
          <div className="chud-side-title">Your commander</div>
          {commanderIdentity}
        </div>
        <div className="chud-side-block chud-battle-guide"><div className="chud-side-title">The arena</div><p>Play your hand. Break their towers.</p><span>Drag a card into the arena, or select a card and tap to place it.</span></div>
      </aside>
      <div className="chud-col">
        <header className="chud-top">
          <div className="chud-score">
            <span className="chud-side-tag" data-side="foe">
              <span className={`chud-crown-num${crownPulse === "theirs" ? " chud-pulse" : ""}`}>
                <CrownIcon color="#c084fc" /> {score.theirs}
              </span>
              <span className="chud-player">{start.opponent}</span>
            </span>
            <span className="chud-clock2">
              {tv.badge && <b className="chud-ot">{tv.badge} </b>}
              {tv.text}
              {tv.mult > 1 && <span className="chud-mult chud-clock-mult">{tv.mult}x</span>}
            </span>
            <span className="chud-side-tag" data-side="you">
              <span className="chud-player">You</span>
              <span className={`chud-crown-num${crownPulse === "mine" ? " chud-pulse" : ""}`}>
                {score.mine} <CrownIcon color="#67e8f9" />
              </span>
            </span>
            {props.showDevDiagnostics !== false && (
              <button className="chud-devbtn" onClick={() => setDevOpen(!devOpen)} aria-pressed={devOpen} title="Dev diagnostics">
                Dev
              </button>
            )}
          </div>
          {(props.connectionStatus || props.error || props.notice) && <div className="chud-status" aria-live="polite">
            <span>{props.connectionStatus}</span>
            {props.error && <span role="alert" className="chud-status-error">{props.error}</span>}
            {props.notice && <span className="chud-status-notice">{props.notice}</span>}
            {props.onGiveUp && <button className="chud-giveup" onClick={props.onGiveUp}>Give up</button>}
          </div>}
          <div className="chud-subrow">
            {patronChip}
            {presence && (
              <span className="chud-pill" style={{ color: presence.opponentConnected ? "#86efac" : "#fbbf24" }}>
                {presence.opponentConnected ? "Opponent back" : `Opp. offline ${Math.max(0, Math.ceil(((presence.reconnectDeadlineAt ?? 0) - now) / 1000))}s`}
              </span>
            )}
          </div>
        </header>
        {props.showDevDiagnostics !== false && devOpen && <div className="chud-dev-inline">{dev}</div>}
        <div className="chud-arena">
          <div className="chud-board">
            <BattleCanvas seat={me === 1 ? 1 : 0} feed={feed} mapRef={mapRef} onBoardTap={onBoardTap} onBoardHover={onBoardHover} hostStyle={{ width: "min(100cqw, 62.5cqh)", height: "auto", aspectRatio: "100 / 160", maxWidth: "none", margin: "auto" }} />
          </div>
          <div className="chud-chaos-stack">{chaosChips}</div>
          {banner !== null && (
            <div className="chud-phase-banner" key={banner}>
              {banner}x Energy
            </div>
          )}
          {(end || abort) && (
            <div className={`chud-result${end ? ` chud-result--${end.result}` : " chud-result--abort"}`} role="dialog" aria-label={end ? "Match result" : "Match interrupted"}>
              {end ? (
                <div className="chud-result-panel">
                  <div className="chud-result-kicker">Battle complete</div>
                  <div className="chud-result-title">{end.result === "win" ? "Victory" : end.result === "loss" ? "Defeat" : "Draw"}</div>
                  <div className="chud-result-identities" aria-label={`You versus ${start.opponent}`}>
                    <span className="chud-result-player chud-result-player--you">You</span>
                    <span className="chud-result-versus">vs</span>
                    <span className="chud-result-player chud-result-player--foe" title={start.opponent}>{start.opponent}</span>
                  </div>
                  <div className="chud-result-score" aria-label={`${end.crowns[me]} crowns for you, ${end.crowns[1 - me]} crowns for ${start.opponent}`}>
                    <div className="chud-result-score-side">
                      <strong>{end.crowns[me]}</strong>
                      <span>Your crowns</span>
                    </div>
                    <span className="chud-result-score-divider">:</span>
                    <div className="chud-result-score-side chud-result-score-side--foe">
                      <strong>{end.crowns[1 - me]}</strong>
                      <span>{start.opponent}&apos;s crowns</span>
                    </div>
                  </div>
                  <div className="chud-result-context">
                    <span>{resultReasonText(end.reason)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{secs(end.ticks)}</span>
                  </div>
                  <div className="chud-result-settlement">{settlementText(settlement)}</div>
                  {start.mode === "ranked" && (
                    <div className="chud-result-ranked" aria-live="polite">
                      {props.rankedAward
                        ? `Ranked award confirmed: ${props.rankedAward.delta > 0 ? "+" : ""}${props.rankedAward.delta} trophies · balance ${props.rankedAward.balanceAfter}`
                        : props.rankedAwardStatus === "checking" || props.rankedAwardStatus === "idle"
                          ? "Ranked award is being confirmed by the server"
                          : props.rankedAwardStatus === "timeout"
                            ? "Ranked award is still pending. Check Progress after the ledger catches up."
                            : "No ranked award was confirmed for this match."}
                    </div>
                  )}
                  {props.onExit && <button type="button" className="chud-result-action" onClick={props.onExit}>Back to lobby</button>}
                </div>
              ) : (
                <div className="chud-result-panel chud-result-panel--abort">
                  <div className="chud-result-kicker">Battle interrupted</div>
                  <div className="chud-result-title">Match ended early</div>
                  <div className="chud-result-context">{abort}</div>
                  {props.onExit && <button type="button" className="chud-result-action" onClick={props.onExit}>Back to lobby</button>}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="chud-tray">
          {frame && (
            <>
              <div className="chud-cards">
                <div className="chud-next" title="Next card">
                  <Portrait src={nextCard ? portraitSrc(manifest, nextCard, commanderCls) : null} name={card(nextCard)?.name ?? "-"} style={{ width: "100%", height: "100%" }} />
                  <span className="chud-next-tag">next</span>
                </div>
                {frame.hand.map((id) => (
                  <CardButton
                    key={id}
                    id={id}
                    card={card(id)}
                    manifest={manifest}
                    commanderCls={commanderCls}
                    energy={frame.energy}
                    energyProgress={frame.energyProgress}
                    selected={selected === id}
                    dragging={dragging === id}
                    handlers={handlersFor(id)}
                    onSelect={select}
                  />
                ))}
              </div>
              <EnergyMeter frame={frame} />
              <div className="chud-abilities chud-abilities-tray">{abilityControls}</div>
              <div className="chud-hint" data-testid="placement-hint">
                {hint ?? (selected ? `Tap the board to play ${card(selected)?.name}, or drag a card onto it.` : "Drag a card onto the board, or select it then tap the board.")}
              </div>
            </>
          )}
        </div>
      </div>
      <aside className="chud-side chud-side-right">
        <div className="chud-side-block"><div className="chud-side-title">Battle status</div><div className="chud-live-label">{end ? "Match complete" : abort ? "Match interrupted" : frame ? "In the arena" : "Entering arena"}</div><p className="chud-status-copy">{props.connectionStatus ?? "Connected"}</p></div>
        <div className="chud-side-block"><div className="chud-side-title">Commander ability</div><div className="chud-abilities">{abilityControls}</div><span className="chud-class-note">Commander class art</span></div>
        <div className="chud-side-block"><div className="chud-side-title">Chaos Pulse</div><p className="chud-status-copy">Watch the arena warnings. Each pulse changes the battle for both players.</p><div className="chud-side-chaos">{chaosChips.length ? chaosChips : <span className="chud-status-copy">No active pulse</span>}</div></div>
      </aside>
      {dragging && (
        <div
          ref={(el) => {
            previewRef.current = el;
            props.placePreview(el, lastAim.current.x, lastAim.current.y);
          }}
          className="chud-drag-preview"
        >
          <Portrait src={portraitSrc(manifest, dragging, commanderCls)} name={card(dragging)?.name ?? dragging} style={{ width: 44, height: 44, borderRadius: 4 }} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>{card(dragging)?.cost}e</span>
        </div>
      )}
    </div>
  );
}
