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
import type { BoardMapper, CanvasFeed } from "./BattleCanvas";

// Phaser must stay client-only, same as page.tsx's original dynamic import.
const BattleCanvas = dynamic(() => import("./BattleCanvas"), { ssr: false });
import { Portrait } from "./portrait";
import { useSpriteManifest } from "./use-sprite-manifest";
import { portraitForCard, portraitForCommanderClass, type SpriteManifest } from "./sprite-registry";

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
  start: StartMessage;
  frame: BattleFrame | null;
  me: number;
  end: EndMessage | null;
  abort: string | null;
  settlement: SettlementMessage | null;
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
      style={{
        borderColor: selected ? "#fbbf24" : "#4b5563",
        transform: selected ? "translateY(-4px)" : "none",
        boxShadow: selected ? "0 0 0 2px #fbbf24" : "none",
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
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          background: afford ? "#7c3aed" : "#dc2626",
          color: "#fff",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1,
          padding: "3px 6px",
        }}
      >
        {card?.cost ?? "?"}
      </span>
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

function TowerPills({ frame, owner, me }: { frame: BattleFrame | null; owner: number; me: number }) {
  const list = (frame?.structures ?? []).filter((s) => s.owner === owner);
  const order = (s: { kind: string; x: number }) => (s.kind === "core" ? 1 : 0);
  return (
    <span className="chud-towers">
      {list
        .sort((a, b) => order(a) - order(b) || a.x - b.x)
        .map((s) => (
          <span key={s.id} className="chud-pill" data-owner={owner === me ? "you" : "foe"} data-dead={!s.alive}>
            {s.kind === "core" ? "Core" : "T"} {s.alive ? s.hp : "x"}
          </span>
        ))}
    </span>
  );
}

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
  const cd = Math.max(0, Math.ceil((a.readyAt - frame.tick) / 10));
  return (
    <button
      className="chud-ability"
      disabled={!a.ready}
      title={`${a.abilityId} · ${a.blockedBy ?? "ready"}`}
      onClick={() => send({ type: "ability", abilityId: a.abilityId }, `ability ${a.abilityId}`)}
      style={{ boxShadow: flash ? "0 0 0 2px #4ade80" : "none" }}
    >
      <Portrait src={manifest ? portraitForCommanderClass(manifest, start.commander.class) : null} name={start.commander.class} style={{ width: 34, height: 34, borderRadius: 4 }} />
      <span className="chud-ability-info">
        <span>{abilityLabel(a.abilityId, start.commander.class)}</span>
        <span style={{ fontSize: 10, color: "#a5b4fc" }}>
          {a.cost}e {a.ready ? (a.blockedBy ? `· ${a.blockedBy}` : "· READY") : `· ${cd}s`}
        </span>
      </span>
    </button>
  );
}

function DevPanel({ end, acks, start }: { end: EndMessage | null; acks: Array<AckMessage & { label: string }>; start: StartMessage }) {
  return (
    <div className="chud-dev">
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

export default function BattleHud(props: BattleHudProps) {
  const { start, frame, me, end, abort, settlement, presence, now, acks, selected, dragging, hint, feed, mapRef, onBoardTap, onBoardHover, send } = props;
  const manifest = useSpriteManifest();
  const [devOpen, setDevOpen] = useState(false);
  const [banner, setBanner] = useState<number | null>(null);
  const prevMult = useRef(0);

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

  const dev = <DevPanel end={end} acks={acks} start={start} />;

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
        <div style={{ color: "#9ca3af" }}>
          {commanderCls} · {start.commander.variant} · {start.commander.prestige}
          {start.commander.kind === "nft" ? ` · token ${start.commander.tokenId}` : " · class template"}
        </div>
      </div>
    </div>
  );

  const patronChip = (
    <span className="chud-pill" title={`Arena Patron token ${start.patron.tokenId}`}>
      Patron {start.patron.name ?? `CHOG #${start.patron.tokenId}`} · {start.patron.tier ?? "Unranked"} · {start.patron.theme}
    </span>
  );

  return (
    <div className="chud" data-testid="battle-hud">
      <style>{HUD_CSS}</style>
      <div className="chud-col">
        <header className="chud-top">
          <span className="chud-pill chud-opp">vs {start.opponent}</span>
          <TowerPills frame={frame} owner={1 - me} me={me} />
          <span className="chud-pill chud-clock">
            {frame?.phase === "overtime" && <b className="chud-ot">OT </b>}
            {frame ? secs(frame.clockTicks) : "--"}
          </span>
          <span className="chud-pill chud-crowns">
            {frame?.crowns[me] ?? 0}–{frame?.crowns[1 - me] ?? 0}
          </span>
          {patronChip}
          {presence && (
            <span className="chud-pill" style={{ color: presence.opponentConnected ? "#86efac" : "#fbbf24" }}>
              {presence.opponentConnected ? "Opponent back" : `Opp. offline ${Math.max(0, Math.ceil(((presence.reconnectDeadlineAt ?? 0) - now) / 1000))}s`}
            </span>
          )}
          <button className="chud-devbtn" onClick={() => setDevOpen(!devOpen)} aria-pressed={devOpen}>
            Dev
          </button>
        </header>
        {devOpen && <div className="chud-dev-inline">{dev}</div>}
        <div className="chud-arena">
          <div className="chud-board">
            <BattleCanvas feed={feed} mapRef={mapRef} onBoardTap={onBoardTap} onBoardHover={onBoardHover} hostStyle={{ width: "min(100cqw, 62.5cqh)", height: "auto", aspectRatio: "100 / 160", maxWidth: "none", margin: "auto" }} />
          </div>
          <div className="chud-chaos-stack">{chaosChips}</div>
          {banner !== null && (
            <div className="chud-phase-banner" key={banner}>
              {banner}x Energy
            </div>
          )}
          {(end || abort) && (
            <div className="chud-result">
              {end ? (
                <>
                  <div style={{ fontSize: 30, fontWeight: 800 }}>{end.result === "win" ? "Victory" : end.result === "loss" ? "Defeat" : "Draw"}</div>
                  <div>
                    crowns {end.crowns[me]} - {end.crowns[1 - me]} · {end.reason} · {secs(end.ticks)}
                  </div>
                  <div style={{ fontSize: 11 }}>{settlementText(settlement)}</div>
                </>
              ) : (
                <div>{abort}</div>
              )}
            </div>
          )}
        </div>
        <div className="chud-tray">
          <div className="chud-tray-top">
            <TowerPills frame={frame} owner={me} me={me} />
          </div>
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
                <div className="chud-abilities">
                  {frame.abilities.length === 0 && <span style={{ fontSize: 11, color: "#9ca3af" }}>Commander ability: deploy your commander first.</span>}
                  {frame.abilities.map((a) => (
                    <AbilityButton key={a.abilityId} a={a} frame={frame} start={start} manifest={manifest} acks={acks} send={send} />
                  ))}
                </div>
              </div>
              <EnergyMeter frame={frame} />
              <div className="chud-hint" data-testid="placement-hint">
                {hint ?? (selected ? `Tap the board to play ${card(selected)?.name}, or drag a card onto it.` : "Drag a card onto the board, or select it then tap the board.")}
              </div>
            </>
          )}
        </div>
      </div>
      <aside className="chud-side">
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
        <div className="chud-side-block chud-side-dev">
          <div className="chud-side-title">Dev</div>
          {dev}
        </div>
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

const HUD_CSS = `
.chud{position:fixed;inset:0;height:100dvh;display:flex;justify-content:center;gap:12px;overflow:hidden;
  padding:calc(6px + env(safe-area-inset-top)) calc(8px + env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) calc(8px + env(safe-area-inset-left));
  background:#0b1210;color:#e5e7eb;font-size:13px;z-index:10}
.chud-col{display:flex;flex-direction:column;width:100%;max-width:560px;min-height:0;height:100%}
.chud-top{display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:2px 0;min-height:26px}
.chud-pill{background:#1f2937;border:1px solid #374151;border-radius:999px;padding:2px 8px;font-size:11px;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}
.chud-pill[data-dead="true"]{opacity:.55;text-decoration:line-through}
.chud-pill[data-owner="you"]{border-color:#3b82f6}
.chud-pill[data-owner="foe"]{border-color:#ef4444}
.chud-towers{display:flex;gap:3px}
.chud-opp{font-weight:600}
.chud-clock{font-variant-numeric:tabular-nums}
.chud-ot{color:#fbbf24}
.chud-crowns{font-weight:700}
.chud-devbtn{margin-left:auto;flex:none;font-size:11px;padding:2px 8px;background:#1f2937;border:1px solid #4b5563;border-radius:4px;color:#e5e7eb}
.chud-dev-inline{font-size:11px;background:#111827;border:1px solid #374151;border-radius:6px;padding:4px 8px;margin-bottom:4px;max-height:120px;overflow-y:auto}
.chud-dev{font-size:11px;color:#9ca3af}
.chud-arena{position:relative;flex:1;min-height:0;display:flex;container-type:size}
.chud-board{display:contents}
.chud-chaos-stack{position:absolute;top:4px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:3px;align-items:center;pointer-events:none;z-index:3}
.chud-chaos{font-size:11px;background:#000a;padding:2px 8px;border-radius:999px}
.chud-chaos.warning{color:#fbbf24}
.chud-chaos.active{color:#fda4af}
.chud-phase-banner{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%);font-size:30px;font-weight:800;color:#e9d5ff;
  text-shadow:0 0 14px #7c3aed;pointer-events:none;z-index:4;animation:chud-banner 2s ease-out forwards}
@keyframes chud-banner{0%{opacity:0;transform:translate(-50%,-30%) scale(.9)}15%{opacity:1;transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0}}
@media(prefers-reduced-motion:reduce){.chud-phase-banner{animation:none;opacity:.95}}
.chud-result{position:absolute;inset:0;background:#000c;display:grid;place-content:center;text-align:center;gap:6px;z-index:5}
.chud-tray{display:flex;flex-direction:column;gap:4px;padding-top:4px}
.chud-tray-top{display:flex;justify-content:center}
.chud-cards{display:grid;grid-template-columns:auto repeat(4,1fr) auto;gap:6px;align-items:stretch}
@media(max-width:640px){.chud-cards{grid-template-columns:auto repeat(4,1fr)}.chud-abilities{grid-column:1/-1;flex-direction:row;flex-wrap:wrap;min-width:0;max-width:none}}
.chud-next{position:relative;width:46px;aspect-ratio:3/4;align-self:center;border:1px dashed #4b5563;border-radius:6px;overflow:hidden;opacity:.85}
.chud-next-tag{position:absolute;bottom:0;left:0;right:0;font-size:8px;text-align:center;background:#000a;color:#9ca3af}
.chud-card{position:relative;aspect-ratio:3/4;min-width:0;border-radius:8px;overflow:hidden;border:1px solid #4b5563;
  background:#1f2937;padding:0;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;transition:transform .12s}
.chud-card:active{transform:translateY(0)}
.chud-name{position:absolute;bottom:0;left:0;right:0;font-size:9px;line-height:1.2;padding:2px 3px;background:linear-gradient(transparent,#000e 40%);color:#f3f4f6;text-align:center}
.chud-abilities{display:flex;flex-direction:column;gap:4px;min-width:96px;max-width:150px;justify-content:center}
.chud-ability{display:flex;gap:5px;align-items:center;font-size:10px;padding:3px 5px;background:#1f2937;border:1px solid #4b5563;border-radius:6px;color:#e5e7eb;text-align:left}
.chud-ability:disabled{opacity:.55}
.chud-ability-info{display:flex;flex-direction:column;min-width:0}
.chud-energy{display:flex;align-items:center;gap:6px}
.chud-energy-cells{flex:1;display:grid;grid-template-columns:repeat(10,1fr);gap:2px;height:12px}
.chud-cell{background:#1f2937;border:1px solid #374151;border-radius:2px;overflow:hidden}
.chud-cell-fill{height:100%;background:#d946ef;transition:width .15s linear}
.chud-energy-num{font-size:11px;font-variant-numeric:tabular-nums}
.chud-mult{font-size:10px;font-weight:700;background:#7c3aed;border-radius:999px;padding:2px 7px}
.chud-chaos-mod{background:#0e7490}
.chud-hint{font-size:11px;min-height:15px;color:#cbd5e1;text-align:center}
.chud-side{display:none;flex-direction:column;gap:10px;width:260px;flex:none;padding-top:2px;overflow-y:auto}
.chud-side-block{background:#111827;border:1px solid #374151;border-radius:8px;padding:8px}
.chud-side-title{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:4px}
.chud-identity{display:flex;gap:8px;align-items:center}
.chud-drag-preview{position:fixed;left:0;top:0;pointer-events:none;z-index:50;display:flex;gap:6px;align-items:center;
  padding:4px 8px;background:#111827e6;border:2px solid #fbbf24;border-radius:6px}
@media(min-width:1100px){.chud-side{display:flex}.chud-col{max-width:520px}}
@media(max-height:520px) and (orientation:landscape){
  .chud-col{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto 1fr;max-width:none}
  .chud-top{grid-column:2;grid-row:1;flex-direction:row;flex-wrap:wrap;width:auto;min-width:0;padding-left:6px}
  .chud-arena{grid-column:1;grid-row:1/3;flex:none;height:100%;aspect-ratio:100/160}
  .chud-tray{grid-column:2;grid-row:2;overflow-y:auto;padding-top:0;padding-left:6px;justify-content:center}
  .chud-cards{grid-template-columns:auto repeat(4,1fr)}
  .chud-abilities{grid-column:1/-1;flex-direction:row;flex-wrap:wrap;min-width:0;max-width:none}
  .chud-dev-inline{position:absolute;top:30px;left:8px;z-index:6;max-width:300px}
}
`;
