"use client";

// B3.1 dev battle surface. Real Privy login, authoritative Colyseus server,
// Phaser view. Gated to development unless explicitly enabled.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { Client, type Room } from "@colyseus/sdk";
import {
  BATTLE_QUEUE_ROOM,
  BATTLE_RANKED_QUEUE_ROOM,
  BATTLE_ROOM,
  type AckMessage,
  type BattleFrame,
  type CommanderChoice,
  type EndMessage,
  type LobbyMessage,
  type MatchFoundMessage,
  type PresenceMessage,
  type QueueStatusMessage,
  type SettlementMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { aimPoint, endGesture, moveGesture, placementHint, startGesture, type ArenaPoint, type Gesture } from "@/lib/battle-input";
import { awardForMatch, resolveRankedSummary } from "@/components/app/ranked-model";
import type { RankedAwardView, MyRankedResponse } from "@/lib/ranked";
import type { BoardMapper, CanvasFeed } from "./BattleCanvas";
import LoadoutPicker from "./LoadoutPicker";
import BattleHud from "./BattleHud";
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const SERVER = process.env.NEXT_PUBLIC_BATTLE_SERVER_URL ?? "http://127.0.0.1:2567";
const ENABLED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_BATTLE === "1";

type Stage = "idle" | "connecting" | "searching" | "lobby" | "active" | "reconnecting" | "ended" | "aborted" | "failed" | "closed";
type RankedAwardStatus = "idle" | "checking" | "awarded" | "unavailable" | "timeout";
const RESUME_KEY = "b3.resume";

export function BattlePanel({
  publicMode = false,
  initialMode = "unranked",
}: {
  /** Public app routes reuse this panel without the development diagnostics. */
  publicMode?: boolean;
  /** The hub can send the player here with an intended queue or room flow. */
  initialMode?: "unranked" | "ranked" | "private";
}) {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [lobby, setLobby] = useState<LobbyMessage | null>(null);
  const [start, setStart] = useState<StartMessage | null>(null);
  const [frame, setFrame] = useState<BattleFrame | null>(null);
  const [acks, setAcks] = useState<Array<AckMessage & { label: string }>>([]);
  const [end, setEnd] = useState<EndMessage | null>(null);
  const [settlement, setSettlement] = useState<SettlementMessage | null>(null);
  const [rankedAward, setRankedAward] = useState<RankedAwardView | null>(null);
  const [rankedAwardStatus, setRankedAwardStatus] = useState<RankedAwardStatus>("idle");
  const [abort, setAbort] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const feed = useRef<CanvasFeed | null>(null);
  const [queueRoom, setQueueRoom] = useState<Room | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatusMessage | null>(null);
  const [presence, setPresence] = useState<PresenceMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  /** Latest {roomId, resumeToken} for the active seat; cleared on end/abort/leave. */
  const resumeInfo = useRef<{ roomId: string; resumeToken: string; graceMs: number } | null>(null);
  const resumeDeadline = useRef(0);
  const [resumeDeadlineAt, setResumeDeadlineAt] = useState(0);
  /** Bump to cancel any in-flight reconnect loop. */
  const reconnectGen = useRef(0);
  const cidN = useRef(0);
  const mapRef = useRef<BoardMapper | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClickUntil = useRef(0);
  const preview = useRef<HTMLDivElement>(null);
  const sentLabels = useRef(new Map<string, string>());

  // One handler set shared by room-code create/join, matched reservations
  // and resume re-joins. SDK auto-reconnect is disabled: our resume flow owns
  // recovery, and the built-in retry would delay onLeave past the grace window.
  const attachRoom = useCallback((r: Room) => {
    r.reconnection.enabled = false;
    r.onMessage("lobby", (m: LobbyMessage) => (setLobby(m), setStage((s) => (s === "connecting" || s === "searching" ? "lobby" : s))));
    r.onMessage("start", (m: StartMessage) => {
      feed.current = { start: m, frame: null, prev: null, receivedAt: performance.now(), selected: null, ghost: null };
      setSelected(null);
      setDragging(null);
      gesture.current = null;
      resumeInfo.current = { roomId: r.roomId, resumeToken: m.resumeToken, graceMs: m.reconnectGraceMs };
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify(resumeInfo.current));
      } catch {
        /* storage may be unavailable */
      }
      if (m.resumed) setNotice("Match restored");
      setPresence(null);
      setRankedAward(null);
      setRankedAwardStatus("idle");
      setStart(m);
      setStage("active");
    });
    r.onMessage("frame", (f: BattleFrame) => {
      const cur = feed.current;
      if (!cur || (cur.frame && f.tick <= cur.frame.tick)) return; // never apply older snapshots
      feed.current = { ...cur, prev: cur.frame, frame: f, receivedAt: performance.now() };
      setFrame(f);
    });
    r.onMessage("ack", (a: AckMessage) => {
      const label = sentLabels.current.get(a.cid) ?? a.cid;
      sentLabels.current.delete(a.cid);
      setAcks((xs) => [{ ...a, label }, ...xs].slice(0, 5));
    });
    r.onMessage("end", (e: EndMessage) => (resumeInfo.current = null, sessionStorage.removeItem(RESUME_KEY), setEnd(e), setStage("ended")));
    r.onMessage("settlement", (m: SettlementMessage) => setSettlement(m));
    r.onMessage("aborted", (a: { reason: string }) => (resumeInfo.current = null, sessionStorage.removeItem(RESUME_KEY), setAbort(a.reason), setStage("aborted")));
    r.onMessage("presence", (m: PresenceMessage) => setPresence(m));
    r.onMessage("error", (e: { reason: string }) => setError(e.reason));
    r.onLeave((code: number) => {
      setStage((s) => {
        // Unconsented drop during a live match: try to resume the seat.
        if (s === "active" && code !== 4000 && resumeInfo.current) {
          resumeDeadline.current = Date.now() + resumeInfo.current.graceMs;
          setResumeDeadlineAt(resumeDeadline.current);
          return "reconnecting";
        }
        resumeInfo.current = null;
        sessionStorage.removeItem(RESUME_KEY);
        return s === "ended" || s === "aborted" ? s : "closed";
      });
    });
    setRoom(r);
  }, []);

  // Ranked awards are read back only after the server confirms settlement.
  // This bounded read never infers a trophy delta from the battle result.
  useEffect(() => {
    if (start?.mode !== "ranked" || !end?.matchId) return;
    if (!settlement || settlement.status === "pending") return;
    if (settlement.status !== "settled" && settlement.status !== "already-settled") return;

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      attempts += 1;
      const token = await getAccessToken();
      if (!token || cancelled) {
        if (!cancelled) setRankedAwardStatus("unavailable");
        return;
      }
      setRankedAwardStatus("checking");
      try {
        const response = await fetch("/api/players/me/ranked", { headers: { authorization: `Bearer ${token}` } });
        const body = (await response.json()) as { success?: boolean; data?: { ranked?: MyRankedResponse } };
        const recent = body.success && body.data?.ranked ? resolveRankedSummary(body.data.ranked).recent : [];
        const award = awardForMatch(recent, end.matchId);
        if (award) {
          if (!cancelled) {
            setRankedAward(award);
            setRankedAwardStatus("awarded");
          }
          return;
        }
        if (attempts >= 4) {
          if (!cancelled) setRankedAwardStatus("timeout");
          return;
        }
      } catch {
        if (attempts >= 4) {
          if (!cancelled) setRankedAwardStatus("unavailable");
          return;
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1500);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [end?.matchId, getAccessToken, settlement, start?.mode]);

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
        attachRoom(r);
        setStage("lobby");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage("idle");
      }
    },
    [code, getAccessToken, attachRoom]
  );

  /** Join one queue. The room name is the server-side mode authority: the
   * ranked room only ever pairs ranked tickets, and the client label below
   * never decides settlement. Ranked stays hub-gated until trophies land. */
  const findMatch = useCallback(async (queue: "unranked" | "ranked" = "unranked") => {
    setError(null);
    setStage("searching");
    setQueueStatus(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("No Privy access token. Log in first.");
      const client = new Client(SERVER, { headers: { authorization: `Bearer ${token}` } });
      const q = await client.joinOrCreate(queue === "ranked" ? BATTLE_RANKED_QUEUE_ROOM : BATTLE_QUEUE_ROOM);
      q.onMessage("queue_status", (m: QueueStatusMessage) => setQueueStatus(m));
      q.onMessage("queue_timeout", (m: { reason: string }) => (setError(m.reason), setStage("idle")));
      q.onMessage("match_found", (m: MatchFoundMessage) => {
        setQueueStatus(null);
        setStage("connecting");
        void (async () => {
          try {
            await q.leave().catch(() => {});
            attachRoom(await client.consumeSeatReservation(m.reservation));
            setStage("lobby");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setStage("idle");
          }
        })();
      });
      q.onLeave(() => setStage((s) => (s === "searching" ? "idle" : s)));
      setQueueRoom(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("idle");
    }
  }, [getAccessToken, attachRoom]);

  const cancelSearch = useCallback(() => void queueRoom?.leave().catch(() => {}), [queueRoom]);

  const reset = useCallback(() => {
    reconnectGen.current += 1;
    resumeInfo.current = null;
    sessionStorage.removeItem(RESUME_KEY);
    void room?.leave().catch(() => {});
    void queueRoom?.leave().catch(() => {});
    setRoom(null);
    setQueueRoom(null);
    setLobby(null);
    setStart(null);
    setFrame(null);
    setEnd(null);
    setSettlement(null);
    setAbort(null);
    setPresence(null);
    setNotice(null);
    setQueueStatus(null);
    feed.current = null;
    setStage("idle");
  }, [room, queueRoom]);

  useEffect(() => () => void room?.leave(), [room]);
  useEffect(() => () => void queueRoom?.leave(), [queueRoom]);

  // Reconnect loop: retry joinById with the resume token until the grace
  // deadline or a definitive rejection.
  useEffect(() => {
    if (stage !== "reconnecting") return;
    const gen = ++reconnectGen.current;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = async () => {
      if (gen !== reconnectGen.current) return;
      const info = resumeInfo.current;
      if (!info) {
        setStage("failed");
        return;
      }
      if (Date.now() >= resumeDeadline.current) {
        resumeInfo.current = null;
        sessionStorage.removeItem(RESUME_KEY);
        setError("Reconnect window expired");
        setStage("failed");
        return;
      }
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("No Privy access token. Log in first.");
        const client = new Client(SERVER, { headers: { authorization: `Bearer ${token}` } });
        const r = await client.joinById(info.roomId, { resume: info.resumeToken });
        if (gen !== reconnectGen.current) {
          void r.leave().catch(() => {});
          return;
        }
        attachRoom(r); // the resumed start message flips stage back to active
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/over|authorized|not found|already started|expired|seat already connected/i.test(msg)) {
          resumeInfo.current = null;
          sessionStorage.removeItem(RESUME_KEY);
          setError(`Recovery failed: ${msg}`);
          setStage("failed");
          return;
        }
        if (gen === reconnectGen.current) timer = setTimeout(() => void attempt(), 2000);
      }
    };
    timer = setTimeout(() => void attempt(), 800);
    return () => clearTimeout(timer);
  }, [stage, getAccessToken, attachRoom]);

  // After a refresh, offer the stored seat one automatic resume attempt.
  const autoResumeTried = useRef(false);
  useEffect(() => {
    if (!ready || !authenticated || stage !== "idle" || autoResumeTried.current) return;
    let stored: { roomId: string; resumeToken: string; graceMs: number } | null = null;
    try {
      stored = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null");
    } catch {
      stored = null;
    }
    if (!stored?.roomId || !stored.resumeToken) return;
    autoResumeTried.current = true;
    const info = stored;
    const t = setTimeout(() => {
      resumeInfo.current = info;
      resumeDeadline.current = Date.now() + info.graceMs;
      setResumeDeadlineAt(resumeDeadline.current);
      setStage("reconnecting");
    }, 0);
    return () => clearTimeout(t);
  }, [ready, authenticated, stage]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // Ticker for search elapsed, matched-lobby countdown, reconnect countdown
  // and the opponent-presence countdown.
  useEffect(() => {
    const wants = stage === "searching" || stage === "reconnecting" || (stage === "lobby" && !!lobby?.match) || (stage === "active" && !!presence?.reconnectDeadlineAt);
    if (!wants) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [stage, lobby?.match, presence?.reconnectDeadlineAt]);
  useEffect(() => {
    if (feed.current && start) feed.current = { ...feed.current, selected: selected ? start.catalog[selected] ?? null : null };
  }, [selected, start]);

  const send = useCallback(
    (cmd: Record<string, unknown>, label: string) => {
      if (!room) return;
      const cid = `c${Date.now().toString(36)}${cidN.current++}`;
      sentLabels.current.set(cid, label);
      room.send("cmd", { ...cmd, cid });
    },
    [room]
  );
  // Every deploy, tap or drag, goes through this one call. The server decides.
  const deploy = useCallback(
    (cardId: string, at: ArenaPoint) => {
      if (stage !== "active") return;
      send({ type: "deploy", cardId, x: at.x, y: at.y }, `${start?.catalog[cardId]?.name ?? cardId} @${at.x},${at.y}`);
      setSelected(null);
    },
    [send, stage, start]
  );
  // Advisory ghost + hint text. Returns nothing authoritative.
  const showGhost = useCallback((cardId: string | null, at: ArenaPoint | null) => {
    const f = feed.current;
    if (!f) return;
    if (!cardId || !at || !f.frame) {
      f.ghost = null;
      setHint(cardId ? "Release off the board to cancel" : null);
      return;
    }
    const h = placementHint(f.start.catalog[cardId], at, f.start, f.frame);
    f.ghost = { cardId, x: at.x, y: at.y, ok: h.ok };
    setHint(h.ok ? `Release to play at ${at.x},${at.y}` : h.reason);
  }, []);
  const onBoardTap = useCallback(
    (at: ArenaPoint) => {
      if (!selected) return;
      deploy(selected, at);
      showGhost(null, null);
    },
    [selected, deploy, showGhost]
  );
  const onBoardHover = useCallback(
    (at: ArenaPoint | null) => {
      if (!gesture.current?.dragging) showGhost(selected, selected ? at : null);
    },
    [selected, showGhost]
  );
  const placePreview = (el: HTMLDivElement | null, clientX: number, clientY: number) => {
    if (el) el.style.transform = `translate(${clientX}px, ${clientY}px) translate(-50%, -50%)`;
  };
  const lastAim = useRef({ x: 0, y: 0 });

  const onCardPointerDown = (id: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || stage !== "active") return;
    // A new press always replaces a stale gesture (e.g. one whose button unmounted).
    if (gesture.current?.dragging) {
      setDragging(null);
      showGhost(null, null);
    }
    gesture.current = startGesture(id, e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onCardPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = moveGesture(gesture.current, e);
    if (!g) return;
    if (g.dragging && !gesture.current?.dragging) setDragging(g.cardId);
    gesture.current = g;
    if (!g.dragging) return;
    const aim = aimPoint({ clientX: e.clientX, clientY: e.clientY, pointerType: g.pointerType });
    lastAim.current = { x: aim.clientX, y: aim.clientY };
    placePreview(preview.current, aim.clientX, aim.clientY);
    showGhost(g.cardId, mapRef.current?.(aim.clientX, aim.clientY) ?? null);
  };
  const onCardPointerEnd = (cancelled: boolean) => (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    const r = endGesture(g, e, cancelled, (cx, cy) => mapRef.current?.(cx, cy) ?? null);
    if (r.kind === "ignore") return;
    gesture.current = null; // cleared before sending so pointerup + lostpointercapture can't double-deploy
    if (g?.dragging) {
      suppressClickUntil.current = performance.now() + 500; // the click that follows a drag must not toggle selection
      setDragging(null);
      showGhost(null, null);
    }
    if (r.kind === "deploy") deploy(r.cardId, { x: r.x, y: r.y });
    else if (r.kind === "cancel" && g?.dragging) setHint("Cancelled, nothing sent");
  };

  if (!ENABLED) {
    return publicMode ? (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate">
            <h1 className="app-gate__title">Battle unavailable</h1>
            <p className="app-gate__lead">The battle server is not enabled in this build. Return to the lobby and try again later.</p>
            <a className="app-btn app-btn--ghost" href="/app/play">Back to battle hall</a>
          </div>
        </div>
      </main>
    ) : <p>Dev battle is disabled in this build.</p>;
  }
  if (!publicMode && !APP_ID) return <p>Missing NEXT_PUBLIC_PRIVY_APP_ID.</p>;
  if (!ready) return <p>Loading Privy…</p>;
  if (!authenticated) {
    return publicMode ? (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate app-rise">
            <span className="app-gate__mark" aria-hidden="true">⚔</span>
            <h1 className="app-gate__title">Sign in to battle</h1>
            <p className="app-gate__lead">Your verified session is required before a room or queue can open.</p>
            <button type="button" className="app-btn app-btn--battle" onClick={() => login()}>Log in with Privy</button>
          </div>
        </div>
      </main>
    ) : <button onClick={() => login()}>Log in with Privy</button>;
  }

  const me = start?.seat ?? 0;

  return (
    <div className={publicMode ? "app-play-battle-shell" : undefined} data-mode={publicMode ? initialMode : undefined}>
      {!publicMode && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <span>stage: {stage}</span>
        {room && <span>room code: <b>{room.roomId}</b></span>}
        {error && <span style={{ color: "#f87171" }}>{error}</span>}
        {notice && <span style={{ color: "#86efac" }}>{notice}</span>}
        <button onClick={() => void logout()}>Log out</button>
      </div>}

      {publicMode && stage === "idle" && (
        <div className="app-play-battle-head">
          <div>
            <p className="app-play-kicker">{initialMode === "private" ? "Private room" : initialMode === "ranked" ? "Ranked queue" : "Unranked battle"}</p>
            <h1>Enter the arena</h1>
            <p>{initialMode === "private" ? "Create a room for a friend, or join with their code." : initialMode === "ranked" ? "Ranked matchmaking stays unavailable until the rating and trophy pipeline lands." : "Find a casual opponent through the live battle queue."}</p>
          </div>
          <a className="app-btn app-btn--ghost" href="/app/play">Change mode</a>
        </div>
      )}

      {publicMode && stage !== "idle" && error && <div className="app-play-battle-error" role="alert">{error}</div>}

      {stage === "idle" && (
        <section className={publicMode ? "app-play-battle-controls" : undefined} style={publicMode ? undefined : { display: "grid", gap: 8 }}>
          <div className={publicMode ? "app-play-battle-actions" : undefined} style={publicMode ? undefined : { display: "flex", gap: 8, flexWrap: "wrap" }}>
            {publicMode && initialMode === "ranked" ? (
              <p className="app-play-battle-error" role="note">Ranked queue is unavailable in this build. No rating or trophies are awarded.</p>
            ) : (
              <button className={publicMode ? "app-btn app-btn--battle" : undefined} onClick={() => void findMatch(initialMode === "ranked" ? "ranked" : "unranked")}>Find match</button>
            )}
            <button className={publicMode ? "app-btn app-btn--ghost" : undefined} onClick={() => void connect("create")}>Create battle</button>
            <label className={publicMode ? "app-play-code" : undefined}>
              <span className={publicMode ? "app-sr" : undefined}>Room code</span>
              <input aria-label="Room code" placeholder="room code" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button className={publicMode ? "app-btn app-btn--ghost" : undefined} disabled={!code.trim()} onClick={() => void connect("join")}>Join battle</button>
          </div>
          {!publicMode && <RecentMatches getAccessToken={getAccessToken} />}
          {!publicMode && <div style={{ fontSize: 12 }}><a href="/dev/progress">Stats and casual leaderboard</a></div>}
        </section>
      )}

      {stage === "searching" && (
        <section className={publicMode ? "app-play-battle-controls" : undefined} style={publicMode ? undefined : { display: "grid", gap: 6 }}>
          <div>
            Searching for an opponent{queueStatus ? ` · ${queueStatus.waiting} in queue` : ""} · {queueStatus ? Math.max(0, Math.floor((now - queueStatus.since) / 1000)) : 0}s
          </div>
          <div>
            <button className={publicMode ? "app-btn app-btn--ghost" : undefined} onClick={cancelSearch}>Cancel search</button>
          </div>
        </section>
      )}

      {stage === "reconnecting" && (
        <section className={publicMode ? "app-play-battle-controls" : undefined} style={publicMode ? undefined : { display: "grid", gap: 6 }}>
          <div>Connection lost, reconnecting… {Math.max(0, Math.ceil((resumeDeadlineAt - now) / 1000))}s left</div>
          <div>
            <button className={publicMode ? "app-btn app-btn--ghost" : undefined} onClick={reset}>Give up</button>
          </div>
        </section>
      )}

      {stage === "lobby" && lobby && (
        <section className={publicMode ? "app-play-battle-controls" : undefined} style={publicMode ? undefined : { display: "grid", gap: 6 }}>
          {lobby.match ? (
            <div>
              Matched vs {lobby.match.opponent ?? "opponent"} · ready within {Math.max(0, Math.ceil((lobby.match.deadlineAt - now) / 1000))}s
            </div>
          ) : (
            <>
              <div>Share the room code with your opponent. Seats, seed and Chaos patron are chosen by the server.</div>
              {publicMode && room && <div className="app-play-room-code" aria-live="polite"><span>Room code</span><strong>{room.roomId}</strong></div>}
            </>
          )}
          {lobby.players.map((p, i) => (
            <div key={i}>
              Slot {i + 1}: {p.username || "(empty)"} {p.ready ? "ready" : ""} {i === lobby.you ? "(you)" : ""}
            </div>
          ))}
          <LoadoutPicker
            lobby={lobby}
            mine={lobby.mine}
            getAccessToken={getAccessToken}
            onConfirm={(cards, commander: CommanderChoice) => room?.send("ready", { cards, commander })}
            onEdit={() => room?.send("unready")}
          />
        </section>
      )}

      {start && (stage === "active" || stage === "reconnecting" || stage === "ended" || stage === "aborted") && (
        <BattleHud
          showDevDiagnostics={!publicMode}
          connectionStatus={stage === "reconnecting" ? `Reconnecting, ${Math.max(0, Math.ceil((resumeDeadlineAt - now) / 1000))}s left` : stage === "active" ? "Connected" : stage === "ended" ? "Match complete" : "Match interrupted"}
          error={error}
          notice={notice}
          onGiveUp={stage === "reconnecting" ? reset : undefined}
          onExit={reset}
          start={start}
          frame={frame}
          me={me}
          end={end}
          abort={abort}
          settlement={settlement}
          rankedAward={rankedAward}
          rankedAwardStatus={rankedAwardStatus}
          presence={presence}
          now={now}
          acks={acks}
          selected={selected}
          dragging={dragging}
          hint={hint}
          feed={feed}
          mapRef={mapRef}
          onBoardTap={onBoardTap}
          onBoardHover={onBoardHover}
          onCardPointerDown={onCardPointerDown}
          onCardPointerMove={onCardPointerMove}
          onCardPointerEnd={onCardPointerEnd}
          suppressClickUntil={suppressClickUntil}
          onSelectCard={setSelected}
          send={send}
          previewRef={preview}
          lastAim={lastAim}
          placePreview={placePreview}
        />
      )}
      {stage === "closed" && <div className={publicMode ? "app-play-battle-state" : undefined}>Disconnected from the battle server.</div>}
      {stage === "failed" && <div className={publicMode ? "app-play-battle-state" : undefined}>Could not restore the match.</div>}
      {(stage === "closed" || stage === "failed") && (
        <div>
          <button className={publicMode ? "app-btn app-btn--ghost" : undefined} onClick={reset}>Back to lobby</button>
        </div>
      )}
    </div>
  );
}

interface MatchItem {
  matchId: string;
  matchType: string;
  settledAt: string;
  result: "win" | "loss" | "draw";
  crowns: { mine: number; opponent: number };
  endReason: string;
  opponent: { username: string };
}

/** B3.3a account match history. Read-only; only the caller's own rows. */
function RecentMatches({ getAccessToken }: { getAccessToken: () => Promise<string | null> }) {
  const [items, setItems] = useState<MatchItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(
    async (cur: string | null) => {
      setLoading(true);
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch(`/api/players/me/matches?limit=5${cur ? `&cursor=${encodeURIComponent(cur)}` : ""}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const j = (await res.json()) as { success: boolean; data?: { items: MatchItem[]; nextCursor: string | null } };
        const data = j.data;
        if (!j.success || !data) return;
        setItems((prev) => (cur ? [...(prev ?? []), ...data.items] : data.items));
        setCursor(data.nextCursor);
      } catch {
        /* history is advisory */
      } finally {
        setLoading(false);
      }
    },
    [getAccessToken]
  );
  useEffect(() => {
    const t = setTimeout(() => void load(null), 0);
    return () => clearTimeout(t);
  }, [load]);
  if (items === null) return null;
  return (
    <section style={{ display: "grid", gap: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>Recent matches</div>
      {items.length === 0 && <div style={{ color: "#9ca3af" }}>No recorded matches yet.</div>}
      {items.map((m) => (
        <div key={m.matchId}>
          {m.result === "win" ? "Won" : m.result === "loss" ? "Lost" : "Drew"} {m.crowns.mine}-{m.crowns.opponent} vs {m.opponent.username} · {m.matchType} · {new Date(m.settledAt).toLocaleString()}
        </div>
      ))}
      {cursor && (
        <div>
          <button disabled={loading} onClick={() => void load(cursor)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}
