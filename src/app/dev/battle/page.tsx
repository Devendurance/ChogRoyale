"use client";

// B3.1 dev battle surface. Real Privy login, authoritative Colyseus server,
// Phaser view. Gated to development unless explicitly enabled.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { PrivyProvider, usePrivy, useLogin } from "@privy-io/react-auth";
import { Client, type Room } from "@colyseus/sdk";
import { BATTLE_ROOM, type AckMessage, type BattleFrame, type CardInfo, type EndMessage, type LobbyMessage, type StartMessage } from "@/lib/battle-protocol";
import type { CanvasFeed } from "./BattleCanvas";

const BattleCanvas = dynamic(() => import("./BattleCanvas"), { ssr: false });
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const SERVER = process.env.NEXT_PUBLIC_BATTLE_SERVER_URL ?? "http://127.0.0.1:2567";
const ENABLED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_BATTLE === "1";

type Stage = "idle" | "connecting" | "lobby" | "active" | "ended" | "aborted" | "closed";

function BattlePanel() {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [lobby, setLobby] = useState<LobbyMessage | null>(null);
  const [deck, setDeck] = useState("swarm");
  const [start, setStart] = useState<StartMessage | null>(null);
  const [frame, setFrame] = useState<BattleFrame | null>(null);
  const [acks, setAcks] = useState<AckMessage[]>([]);
  const [end, setEnd] = useState<EndMessage | null>(null);
  const [abort, setAbort] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const feed = useRef<CanvasFeed | null>(null);
  const cidN = useRef(0);

  const connect = useCallback(
    async (mode: "create" | "join") => {
      setError(null);
      setStage("connecting");
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("No Privy access token. Log in first.");
        // Token goes only in the matchmaking request header, never the URL.
        const client = new Client(SERVER, { headers: { authorization: `Bearer ${token}` } });
        const r = mode === "create" ? await client.create(BATTLE_ROOM) : await client.joinById(code.trim());
        r.onMessage("lobby", (m: LobbyMessage) => (setLobby(m), setStage((s) => (s === "connecting" ? "lobby" : s))));
        r.onMessage("start", (m: StartMessage) => {
          feed.current = { start: m, frame: null, prev: null, receivedAt: performance.now(), selected: null };
          setStart(m);
          setStage("active");
        });
        r.onMessage("frame", (f: BattleFrame) => {
          const cur = feed.current;
          if (!cur || (cur.frame && f.tick <= cur.frame.tick)) return; // never apply older snapshots
          feed.current = { ...cur, prev: cur.frame, frame: f, receivedAt: performance.now() };
          setFrame(f);
        });
        r.onMessage("ack", (a: AckMessage) => setAcks((xs) => [a, ...xs].slice(0, 5)));
        r.onMessage("end", (e: EndMessage) => (setEnd(e), setStage("ended")));
        r.onMessage("aborted", (a: { reason: string }) => (setAbort(a.reason), setStage("aborted")));
        r.onMessage("error", (e: { reason: string }) => setError(e.reason));
        r.onLeave(() => setStage((s) => (s === "ended" || s === "aborted" ? s : "closed")));
        setRoom(r);
        setStage("lobby");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage("idle");
      }
    },
    [code, getAccessToken]
  );

  useEffect(() => () => void room?.leave(), [room]);
  useEffect(() => {
    if (feed.current && start) feed.current = { ...feed.current, selected: selected ? start.catalog[selected] ?? null : null };
  }, [selected, start]);

  const send = useCallback((cmd: Record<string, unknown>) => room?.send("cmd", { ...cmd, cid: `c${Date.now().toString(36)}${cidN.current++}` }), [room]);
  const onBoardClick = useCallback(
    (x: number, y: number) => {
      if (!selected || stage !== "active") return;
      send({ type: "deploy", cardId: selected, x, y });
      setSelected(null);
    },
    [selected, send, stage]
  );

  if (!ENABLED) return <p>Dev battle is disabled in this build.</p>;
  if (!APP_ID) return <p>Missing NEXT_PUBLIC_PRIVY_APP_ID.</p>;
  if (!ready) return <p>Loading Privy…</p>;
  if (!authenticated) return <button onClick={() => login()}>Log in with Privy</button>;

  const card = (id: string): CardInfo | undefined => start?.catalog[id];
  const secs = (ticks: number) => `${Math.floor(ticks / 600)}:${String(Math.floor((ticks % 600) / 10)).padStart(2, "0")}`;
  const me = start?.seat ?? 0;
  const towers = (owner: number) => frame?.structures.filter((s) => s.owner === owner).map((s) => `${s.kind === "core" ? "Core" : "T"} ${s.alive ? s.hp : "x"}`).join(" · ");

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <span>stage: {stage}</span>
        {room && <span>room code: <b>{room.roomId}</b></span>}
        {error && <span style={{ color: "#f87171" }}>{error}</span>}
        <button onClick={() => void logout()}>Log out</button>
      </div>

      {stage === "idle" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => void connect("create")}>Create battle</button>
          <input placeholder="room code" value={code} onChange={(e) => setCode(e.target.value)} style={{ color: "#000" }} />
          <button disabled={!code.trim()} onClick={() => void connect("join")}>Join battle</button>
        </div>
      )}

      {stage === "lobby" && lobby && (
        <section style={{ display: "grid", gap: 6 }}>
          <div>Share the room code with your opponent. Seats, seed and Chaos patron are chosen by the server.</div>
          {lobby.players.map((p, i) => (
            <div key={i}>
              Slot {i + 1}: {p.username || "(empty)"} {p.ready ? `ready (${p.deck})` : ""} {i === lobby.you ? "(you)" : ""}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <select value={deck} onChange={(e) => setDeck(e.target.value)} style={{ color: "#000" }}>
              {Object.keys(lobby.decks).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <button onClick={() => room?.send("ready", { deck })}>Ready</button>
          </div>
          <div style={{ fontSize: 12 }}>{lobby.decks[deck]?.join(", ")}</div>
        </section>
      )}

      {start && (stage === "active" || stage === "ended" || stage === "aborted") && (
        <section style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>vs {start.opponent}</span>
            <span>
              {frame ? `${frame.phase === "overtime" ? "OT " : ""}${secs(frame.clockTicks)}` : "--"} · crowns you {frame?.crowns[me] ?? 0} - {frame?.crowns[1 - me] ?? 0} them
            </span>
          </div>
          <div style={{ fontSize: 11 }}>them: {towers(1 - me)}</div>
          <div style={{ position: "relative" }}>
            <BattleCanvas feed={feed} onBoardClick={onBoardClick} />
            {frame?.chaos.map((c) => (
              <div key={c.id} style={{ position: "absolute", top: 4, left: 4, fontSize: 12, background: "#000a", padding: "2px 6px" }}>
                {c.state === "warning" ? `Chaos incoming: ${c.name} in ${Math.max(0, Math.ceil((c.activationTick - frame.tick) / 10))}s` : `${c.name} active`}
              </div>
            ))}
            {(end || abort) && (
              <div style={{ position: "absolute", inset: 0, background: "#000c", display: "grid", placeContent: "center", textAlign: "center", gap: 6 }}>
                {end ? (
                  <>
                    <div style={{ fontSize: 28 }}>{end.result === "win" ? "Victory" : end.result === "loss" ? "Defeat" : "Draw"}</div>
                    <div>
                      crowns {end.crowns[me]} - {end.crowns[1 - me]} · {end.reason} · {secs(end.ticks)}
                    </div>
                    <div style={{ fontSize: 11 }}>
                      server replay {end.replayIdentical ? "identical" : "MISMATCH"} · {end.commands} commands · {end.stateHash.slice(0, 12)}
                    </div>
                    <div style={{ fontSize: 11 }}>Dev alpha: no settlement, legacy or leaderboard update.</div>
                  </>
                ) : (
                  <div>{abort}</div>
                )}
              </div>
            )}
          </div>
          <div style={{ fontSize: 11 }}>you: {towers(me)}</div>
          {frame && (
            <>
              <div>
                <div style={{ height: 14, background: "#1f2937", position: "relative" }}>
                  <div style={{ width: `${((frame.energy + frame.energyProgress) / 10) * 100}%`, height: "100%", background: "#d946ef" }} />
                </div>
                <div style={{ fontSize: 12 }}>
                  energy {frame.energy}/10 · regen x{frame.regenMult.toFixed(2)} · next: {card(frame.next ?? "")?.name ?? "-"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {frame.hand.map((id) => {
                  const c = card(id);
                  const afford = (c?.cost ?? 99) <= frame.energy;
                  return (
                    <button key={id} onClick={() => setSelected(selected === id ? null : id)} style={{ padding: 6, border: selected === id ? "2px solid #fbbf24" : "1px solid #4b5563", opacity: afford ? 1 : 0.5, fontSize: 12 }}>
                      <div>{c?.name ?? id}</div>
                      <div>
                        {c?.cost}e {c?.kind}
                        {c?.air ? " (air)" : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 12 }}>{selected ? `Tap the board to play ${card(selected)?.name}.` : "Select a card, then tap the board."}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {frame.abilities.length === 0 && <span style={{ fontSize: 12 }}>Commander ability: deploy your commander first.</span>}
                {frame.abilities.map((a) => (
                  <button key={a.abilityId} disabled={!a.ready} title={a.blockedBy ?? "ready"} onClick={() => send({ type: "ability", abilityId: a.abilityId })} style={{ padding: 6, fontSize: 12 }}>
                    {a.abilityId} ({a.cost}e) {a.ready ? (a.blockedBy ? `· ${a.blockedBy}` : "· READY") : `· ${Math.ceil((a.readyAt - frame.tick) / 10)}s`}
                  </button>
                ))}
              </div>
              <ul style={{ fontSize: 11, margin: 0 }}>
                {acks.map((a) => (
                  <li key={a.cid + a.tick} style={{ color: a.ok ? "#86efac" : "#fca5a5" }}>
                    t{a.tick} {a.ok ? "accepted" : `rejected: ${a.reason}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {stage === "closed" && <div>Disconnected from the battle server. Reconnect is not supported in B3.1.</div>}
    </div>
  );
}

export default function DevBattlePage() {
  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Chog Royale dev battle (B3.1 alpha)</h1>
      <PrivyProvider appId={APP_ID} config={{ embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } } }}>
        <BattlePanel />
      </PrivyProvider>
    </main>
  );
}
