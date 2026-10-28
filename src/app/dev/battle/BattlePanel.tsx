"use client";

// B3.1 dev battle surface. Real Privy login, authoritative Colyseus server,
// Phaser view. Gated to development unless explicitly enabled.

import { hasMatchingInviteResume, roomJoinError, validRoomCode } from "@/lib/battle-invite";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { Client, type Room } from "@colyseus/sdk";
import {
  BATTLE_PRACTICE_ROOM,
  BATTLE_QUEUE_ROOM,
  BATTLE_RANKED_QUEUE_ROOM,
  BATTLE_ROOM,
  PRACTICE_DIFFICULTIES,
  type AckMessage,
  type BattleFrame,
  type CommanderChoice,
  type EndMessage,
  type LobbyMessage,
  type MatchFoundMessage,
  type MatchMode,
  type PresenceMessage,
  type PracticeDifficulty,
  type QueueStatusMessage,
  type SettlementMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { aimPoint, endGesture, moveGesture, placementHint, startGesture, type ArenaPoint, type Gesture } from "@/lib/battle-input";
import { awardForMatch, resolveRankedSummary } from "@/components/app/ranked-model";
import type { RankedAwardView, MyRankedResponse } from "@/lib/ranked";
import type { BoardMapper, CanvasFeed } from "./BattleCanvas";
import BattleLobby from "./BattleLobby";
import BattleEntry from "@/components/app/BattleEntry";
import BattleHud from "./BattleHud";
import { battleIdentity } from "./battle-identity";
import { useAppAudio } from "@/components/audio/AppAudioProvider";
import type { BattlePhase } from "@/lib/audio/audio-core";
import {
  BattleAudio,
  DEFAULT_BATTLE_AUDIO_PREFERENCES,
  cueForAck,
  cueForResult,
  cuesForBattleFrame,
  readBattleAudioPreferences,
  takeUnseenBattleAudioCues,
  writeBattleAudioPreferences,
  type BattleCue,
  type BattleAudioPreferences,
} from "./battle-audio";
import { battleServerUrl, isPublicBattleAvailable } from "@/components/app/battle-availability";
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const SERVER = battleServerUrl() ?? "http://127.0.0.1:2567";
const DEV_ENABLED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_BATTLE === "1";

type Stage = "idle" | "connecting" | "searching" | "lobby" | "active" | "reconnecting" | "ended" | "aborted" | "failed" | "closed";
type RankedAwardStatus = "idle" | "checking" | "awarded" | "unavailable" | "timeout";
export type BattleEntryMode = "unranked" | "ranked" | "private" | "practice";
const RESUME_KEY = "b3.resume";
const PRACTICE_RESUME_KEY = "b3.practice.resume";
const UNRANKED_FALLBACK_RESUME_KEY = "b3.unranked-fallback.resume";
export type ResumeOrigin = "practice" | "unranked-fallback" | "pvp";
type ResumeInfo = { mode: MatchMode; origin: ResumeOrigin; roomId: string; resumeToken: string; graceMs: number };

/** The server's Practice room is also used by an Unranked AI fallback. The
 * entry origin, rather than the room mode alone, decides which resume slot is
 * safe to read and write. */
export const resumeOriginForEntryMode = (mode: BattleEntryMode): ResumeOrigin => mode === "practice" ? "practice" : "pvp";
export const resumeKeyForOrigin = (origin: ResumeOrigin) => origin === "practice" ? PRACTICE_RESUME_KEY : origin === "unranked-fallback" ? UNRANKED_FALLBACK_RESUME_KEY : RESUME_KEY;

const inferredResumeOrigin = (mode: MatchMode): ResumeOrigin => mode === "practice" ? "practice" : "pvp";
const storedResumeOrigin = (value: Partial<ResumeInfo>): ResumeOrigin | null => {
  if (value.origin === "practice" || value.origin === "unranked-fallback" || value.origin === "pvp") return value.origin;
  return value.mode ? inferredResumeOrigin(value.mode) : null;
};

export const readResume = (mode: BattleEntryMode): ResumeInfo | null => {
  try {
    const origins: ResumeOrigin[] = mode === "practice" ? ["practice"] : mode === "unranked" ? ["unranked-fallback", "pvp"] : ["pvp"];
    for (const expectedOrigin of origins) {
      const value = JSON.parse(sessionStorage.getItem(resumeKeyForOrigin(expectedOrigin)) ?? "null") as Partial<ResumeInfo> | null;
      if (!value?.roomId || !value.resumeToken) continue;
      const origin = storedResumeOrigin(value);
      if (origin !== expectedOrigin) continue;
      if (value.mode !== "practice" && value.mode !== "matchmaking" && value.mode !== "ranked" && value.mode !== "private") continue;
      if (origin === "practice" && value.mode !== "practice") continue;
      if (origin === "unranked-fallback" && value.mode !== "practice") continue;
      if (origin === "pvp" && value.mode !== (mode === "unranked" ? "matchmaking" : mode)) continue;
      return { mode: value.mode, origin, roomId: value.roomId, resumeToken: value.resumeToken, graceMs: typeof value.graceMs === "number" ? value.graceMs : 30_000 };
    }
    return null;
  } catch {
    return null;
  }
};
const writeResume = (info: ResumeInfo) => {
  try { sessionStorage.setItem(resumeKeyForOrigin(info.origin), JSON.stringify(info)); } catch { /* session storage is optional */ }
};
const clearResume = (origin: ResumeOrigin) => {
  try { sessionStorage.removeItem(resumeKeyForOrigin(origin)); } catch { /* session storage is optional */ }
};

export function queueFallbackRemainingSeconds(status: QueueStatusMessage | null | undefined, at: number): number | null {
  const scheduled = status?.fallback?.scheduledInMs;
  const since = status?.since;
  if (typeof scheduled !== "number" || !Number.isFinite(scheduled) || scheduled < 0 || typeof since !== "number" || !Number.isFinite(since)) return null;
  return Math.max(0, Math.ceil((since + scheduled - at) / 1000));
}

export function resumeOriginForStart(start: Pick<StartMessage, "mode" | "practiceOpponent">, requested: ResumeOrigin): ResumeOrigin | null {
  const source = start.practiceOpponent?.source;
  if (start.mode === "practice") {
    if (source === "unranked-fallback") return requested === "unranked-fallback" ? "unranked-fallback" : null;
    if (source === "practice") return requested === "practice" ? "practice" : null;
    return null;
  }
  return requested === "pvp" && !start.practiceOpponent ? "pvp" : null;
}

type MatchFoundValidation = { ok: true; message: MatchFoundMessage; origin: ResumeOrigin } | { ok: false; reason: string };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Validate the queue handoff before consuming its one-shot seat capability. */
export function validateMatchFoundMessage(value: unknown, queue: "unranked" | "ranked"): MatchFoundValidation {
  if (!isRecord(value) || value.mode !== queue || typeof value.opponent !== "string" || !value.opponent) return { ok: false, reason: "The matchmaking service returned an invalid match." };
  const reservation = value.reservation;
  if (!isRecord(reservation) || typeof reservation.name !== "string" || typeof reservation.sessionId !== "string" || typeof reservation.roomId !== "string" || !reservation.name || !reservation.sessionId || !reservation.roomId) {
    return { ok: false, reason: "The matchmaking service returned an invalid seat." };
  }
  const fallback = value.fallback;
  if (fallback === undefined) {
    if (value.opponent === "AI Opponent") return { ok: false, reason: "The matchmaking service returned an invalid AI handoff." };
    return { ok: true, message: value as unknown as MatchFoundMessage, origin: "pvp" };
  }
  if (queue !== "unranked" || !isRecord(fallback) || fallback.source !== "unranked-fallback" || value.opponent !== "AI Opponent" || (fallback.difficulty !== "medium" && fallback.difficulty !== "hard") || fallback.botId !== `practice-${fallback.difficulty}-v1`) {
    return { ok: false, reason: "The matchmaking service returned an invalid AI handoff." };
  }
  return { ok: true, message: value as unknown as MatchFoundMessage, origin: "unranked-fallback" };
}

/** The room name is the server-side mode authority. Practice never joins PvP. */
export function battleRoomForMode(mode: BattleEntryMode): typeof BATTLE_ROOM | typeof BATTLE_PRACTICE_ROOM {
  return mode === "practice" ? BATTLE_PRACTICE_ROOM : BATTLE_ROOM;
}

export function BattlePanel({
  publicMode = false,
  initialMode = "unranked",
  initialRoom = null,
  invalidInvite = false,
  setupReady = true,
}: {
  /** Public app routes reuse this panel without the development diagnostics. */
  publicMode?: boolean;
  initialRoom?: string | null;
  invalidInvite?: boolean;
  setupReady?: boolean;
  /** The hub can send the player here with an intended queue or room flow. */
  initialMode?: BattleEntryMode;
}) {
  const router = useRouter();
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();
  const appAudio = useAppAudio();
  const appAudioController = appAudio?.audio ?? null;
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(invalidInvite ? "This invitation has an invalid room code. Ask your friend for a new link." : null);
  const [code, setCode] = useState(initialRoom ?? "");
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
  const [selectedPracticeDifficulty, setSelectedPracticeDifficulty] = useState<PracticeDifficulty>("medium");
  const selectedPracticeDifficultyRef = useRef<PracticeDifficulty>("medium");
  const feed = useRef<CanvasFeed | null>(null);
  const [queueRoom, setQueueRoom] = useState<Room | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatusMessage | null>(null);
  const [presence, setPresence] = useState<PresenceMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  /** Latest {roomId, resumeToken} for the active seat; cleared on end/abort/leave. */
  const resumeInfo = useRef<ResumeInfo | null>(null);
  const resumeDeadline = useRef(0);
  const [resumeDeadlineAt, setResumeDeadlineAt] = useState(0);
  /** Bump to cancel any in-flight reconnect loop. */
  const reconnectGen = useRef(0);
  /** Bump to cancel a queue join or handoff that is still awaiting the SDK. */
  const queueGen = useRef(0);
  const cidN = useRef(0);
  const mapRef = useRef<BoardMapper | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClickUntil = useRef(0);
  const preview = useRef<HTMLDivElement>(null);
  const sentLabels = useRef(new Map<string, string>());
  const audioSeen = useRef(new Set<string>());
  const audioPriming = useRef(false);
  const audioResultSeen = useRef<string | null>(null);
  const [localAudioPreferences, setLocalAudioPreferences] = useState<BattleAudioPreferences>(() => ({ ...DEFAULT_BATTLE_AUDIO_PREFERENCES }));
  const [audio] = useState(() => new BattleAudio(DEFAULT_BATTLE_AUDIO_PREFERENCES, appAudio?.audio.getBattleOutput() ?? null));
  const audioPreferences: BattleAudioPreferences = useMemo(() => appAudio
    ? {
      muted: appAudio.preferences.masterMuted || appAudio.preferences.battleMuted,
      volume: appAudio.preferences.battleVolume,
    }
    : localAudioPreferences, [
    appAudio,
    localAudioPreferences,
  ]);
  const audioReady = useSyncExternalStore(audio.subscribe, audio.getReady, () => false);

  const setAudioPhase = useCallback((phase: BattlePhase) => {
    appAudioController?.setBattlePhase(phase);
  }, [appAudioController]);

  const unlockAudio = useCallback(() => {
    void audio.unlock();
  }, [audio]);

  const playAudioCue = useCallback((cue: BattleCue) => {
    audio.play(cue);
  }, [audio]);

  const updateAudio = useCallback((next: BattleAudioPreferences) => {
    if (appAudio) {
      appAudio.setPreferences({
        battleMuted: next.muted,
        battleVolume: next.volume,
        // This path is only reached from the explicit battle Sound control.
        // It is therefore a valid user gesture to clear a migrated global
        // silence flag, while ordinary route changes never do so.
        ...(next.muted ? {} : { masterMuted: false }),
      });
      return;
    }
    setLocalAudioPreferences(next);
    audio.setPreferences(next);
    try { writeBattleAudioPreferences(next, window.localStorage); } catch { /* optional storage */ }
  }, [appAudio, audio]);

  const toggleAudio = useCallback(() => {
    const next = audio.getReady()
      ? { ...audioPreferences, muted: true }
      : { ...audioPreferences, muted: false, volume: audioPreferences.volume || DEFAULT_BATTLE_AUDIO_PREFERENCES.volume };
    updateAudio(next);
    if (!next.muted) void audio.unlock().then((ready) => { if (ready) audio.play("select"); });
  }, [audio, audioPreferences, updateAudio]);

  const setAudioVolume = useCallback(
    (volume: number) => updateAudio({ ...audioPreferences, volume }),
    [audioPreferences, updateAudio]
  );

  // The room is authoritative after creation. Reconnects receive the same
  // practice opponent descriptor in lobby/start, so the picker and Battle
  // Again continue to use the server-confirmed difficulty.
  const adoptPracticeDifficulty = useCallback((difficulty: PracticeDifficulty | undefined) => {
    if (!difficulty || !PRACTICE_DIFFICULTIES.includes(difficulty)) return;
    selectedPracticeDifficultyRef.current = difficulty;
    setSelectedPracticeDifficulty(difficulty);
  }, []);

  useEffect(() => {
    if (!appAudio) audio.setPreferences(audioPreferences);
  }, [appAudio, audio, audioPreferences]);

  useEffect(() => {
    if (appAudio) return;
    const timer = setTimeout(() => {
      try {
        const saved = readBattleAudioPreferences(window.localStorage);
        audio.setPreferences(saved);
        setLocalAudioPreferences(saved);
      } catch {
        /* Storage is optional. The deterministic default remains active. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [appAudio, audio]);

  useEffect(() => () => audio.dispose(), [audio]);

  useEffect(() => {
    if (appAudio) return;
    const syncVisibility = () => audio.setPageHidden(document.hidden);
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, [appAudio, audio]);

  // One handler set shared by room-code create/join, matched reservations
  // and resume re-joins. SDK auto-reconnect is disabled: our resume flow owns
  // recovery, and the built-in retry would delay onLeave past the grace window.
  const attachRoom = useCallback((r: Room, origin: ResumeOrigin = resumeOriginForEntryMode(initialMode)) => {
    r.reconnection.enabled = false;
    let originRejected = false;
    const rejectOrigin = (reason: string) => {
      if (originRejected) return;
      originRejected = true;
      setError(reason);
      setStage("failed");
      void r.leave().catch(() => {});
    };
    r.onMessage("lobby", (m: LobbyMessage) => {
      const serverSource = m.practice?.opponent.source;
      if (origin === "unranked-fallback" && serverSource !== "unranked-fallback") {
        rejectOrigin("The AI handoff could not be verified. Search again.");
        return;
      }
      if (origin === "practice" && serverSource !== "practice") {
        rejectOrigin("The Practice opponent could not be verified. Try again.");
        return;
      }
      if (origin === "pvp" && serverSource === "unranked-fallback") {
        rejectOrigin("The matchmaking handoff could not be verified. Search again.");
        return;
      }
      if (m.practice) adoptPracticeDifficulty(m.practice.opponent.difficulty);
      setLobby(m);
      setAudioPhase("lobby");
      setStage((s) => (s === "connecting" || s === "searching" ? "lobby" : s));
    });
    r.onMessage("start", (m: StartMessage) => {
      const serverSource = m.practiceOpponent?.source;
      const authoritativeOrigin = resumeOriginForStart(m, origin);
      if (!authoritativeOrigin) {
        const reason = origin === "unranked-fallback"
          ? "The AI handoff could not be verified. Search again."
          : origin === "practice"
            ? "The Practice opponent could not be verified. Try again."
            : "The matchmaking handoff could not be verified. Search again.";
        rejectOrigin(reason);
        return;
      }
      if (origin === "pvp" && (serverSource === "unranked-fallback" || serverSource === "practice")) {
        rejectOrigin("The matchmaking handoff could not be verified. Search again.");
        return;
      }
      if (m.mode === "practice") adoptPracticeDifficulty(m.practiceOpponent?.difficulty);
      feed.current = { start: m, frame: null, prev: null, receivedAt: performance.now(), selected: null, ghost: null };
      audioSeen.current.clear();
      audioResultSeen.current = null;
      audioPriming.current = m.resumed;
      if (!m.resumed) audio.play("start");
      setAudioPhase("active");
      setSelected(null);
      setDragging(null);
      gesture.current = null;
      resumeInfo.current = { mode: m.mode, origin: authoritativeOrigin, roomId: r.roomId, resumeToken: m.resumeToken, graceMs: m.reconnectGraceMs };
      writeResume(resumeInfo.current);
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
      const previous = cur.frame;
      feed.current = { ...cur, prev: cur.frame, frame: f, receivedAt: performance.now() };
      const cues = cuesForBattleFrame(f, previous);
      if (audioPriming.current) {
        for (const cue of cues) audioSeen.current.add(cue.key);
        audioPriming.current = false;
      } else {
        for (const cue of takeUnseenBattleAudioCues(cues, audioSeen.current)) audio.play(cue.cue);
      }
      setFrame(f);
    });
    r.onMessage("ack", (a: AckMessage) => {
      const label = sentLabels.current.get(a.cid) ?? a.cid;
      sentLabels.current.delete(a.cid);
      const cue = cueForAck(a, label);
      if (cue) for (const next of takeUnseenBattleAudioCues([cue], audioSeen.current)) audio.play(next.cue);
      setAcks((xs) => [{ ...a, label }, ...xs].slice(0, 5));
    });
    r.onMessage("end", (e: EndMessage) => {
      const resumeOrigin = resumeInfo.current?.origin ?? resumeOriginForEntryMode(initialMode);
      resumeInfo.current = null;
      clearResume(resumeOrigin);
      const cue = cueForResult(e.result);
      if (audioResultSeen.current !== cue.key) {
        audioResultSeen.current = cue.key;
        audio.play(cue.cue);
      }
      setEnd(e);
      setAudioPhase("result");
      setStage("ended");
    });
    r.onMessage("settlement", (m: SettlementMessage) => setSettlement(m));
    r.onMessage("aborted", (a: { reason: string }) => {
      const resumeOrigin = resumeInfo.current?.origin ?? resumeOriginForEntryMode(initialMode);
      resumeInfo.current = null;
      clearResume(resumeOrigin);
      setAbort(a.reason);
      setAudioPhase("lobby");
      setStage("aborted");
    });
    r.onMessage("presence", (m: PresenceMessage) => setPresence(m));
    r.onMessage("error", (e: { reason: string }) => setError(e.reason));
    r.onLeave((code: number) => {
      setStage((s) => {
        if (originRejected) return "failed";
        // Unconsented drop during a live match: try to resume the seat.
        if (s === "active" && code !== 4000 && resumeInfo.current) {
          resumeDeadline.current = Date.now() + resumeInfo.current.graceMs;
          setResumeDeadlineAt(resumeDeadline.current);
          setAudioPhase("reconnecting");
          return "reconnecting";
        }
        const resumeOrigin = resumeInfo.current?.origin ?? resumeOriginForEntryMode(initialMode);
        resumeInfo.current = null;
        clearResume(resumeOrigin);
        setAudioPhase(s === "ended" ? "result" : "lobby");
        return s === "ended" || s === "aborted" ? s : "closed";
      });
    });
    setRoom(r);
  }, [adoptPracticeDifficulty, audio, initialMode, setAudioPhase]);

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

  const connecting = useRef(false);
  const connect = useCallback(
    async (mode: "create" | "join" | "practice", inviteCode?: string, requestedPracticeDifficulty?: PracticeDifficulty) => {
      const joinCode = inviteCode ?? code;
      if (mode === "join" && !validRoomCode(joinCode)) {
        setError("Enter the complete 9-character room code. Codes are case-sensitive.");
        return;
      }
      if (connecting.current) return;
      connecting.current = true;
      setError(null);
      setStage("connecting");
      try {
        if (mode === "practice" && requestedPracticeDifficulty && PRACTICE_DIFFICULTIES.includes(requestedPracticeDifficulty)) {
          selectedPracticeDifficultyRef.current = requestedPracticeDifficulty;
          setSelectedPracticeDifficulty(requestedPracticeDifficulty);
        }
        const token = await getAccessToken();
        if (!token) throw new Error("No Privy access token. Log in first.");
        // Token goes only in the matchmaking request header, never the URL.
        const client = new Client(SERVER, { headers: { authorization: `Bearer ${token}` } });
        const r = mode === "join"
          ? await client.joinById(joinCode.trim())
          : mode === "practice"
            ? await client.create(BATTLE_PRACTICE_ROOM, { difficulty: requestedPracticeDifficulty ?? selectedPracticeDifficultyRef.current })
            : await client.create(BATTLE_ROOM);
        const origin: ResumeOrigin = mode === "practice" ? "practice" : "pvp";
        attachRoom(r, origin);
        if (mode === "create") appAudioController?.playUi("invite");
        if (mode === "practice") appAudioController?.playUi("ready");
        setStage((current) => current === "connecting" ? "lobby" : current);
      } catch (e) {
        setError(mode === "join"
          ? roomJoinError(e)
          : mode === "practice"
            ? "Couldn't start practice. Check your connection and try again."
            : "Couldn't create a room. Check your connection and try again.");
        setStage("idle");
      } finally {
        connecting.current = false;
      }
    },
    [appAudioController, attachRoom, code, getAccessToken, initialMode]
  );

  const inviteTried = useRef(false);
  useEffect(() => {
    if (!publicMode || !initialRoom || !setupReady || !ready || !authenticated || stage !== "idle" || inviteTried.current) return;
    const stored = readResume(initialMode);
    if (stored && hasMatchingInviteResume(initialRoom, stored)) return;
    // Mark inside the task so Strict Mode's cancelled first effect doesn't consume it.
    const timer = setTimeout(() => {
      if (inviteTried.current) return;
      inviteTried.current = true;
      void connect("join", initialRoom);
    }, 0);
    return () => clearTimeout(timer);
  }, [publicMode, initialMode, initialRoom, setupReady, ready, authenticated, stage, connect]);

  /** Join one queue. The room name is the server-side mode authority: the
   * ranked room only ever pairs ranked tickets, and the client label below
   * never decides settlement. Ranked stays hub-gated until trophies land. */
  const findMatch = useCallback(async (queue: "unranked" | "ranked" = "unranked") => {
    const gen = ++queueGen.current;
    setError(null);
    setStage("searching");
    setQueueStatus(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("No Privy access token. Log in first.");
      const client = new Client(SERVER, { headers: { authorization: `Bearer ${token}` } });
      const q = await client.joinOrCreate(queue === "ranked" ? BATTLE_RANKED_QUEUE_ROOM : BATTLE_QUEUE_ROOM);
      if (gen !== queueGen.current) {
        await q.leave().catch(() => {});
        return;
      }
      q.onMessage("queue_status", (m: QueueStatusMessage) => {
        if (gen !== queueGen.current) return;
        setQueueStatus(m);
        setNow(Date.now());
      });
      q.onMessage("queue_timeout", (m: { reason: string }) => {
        if (gen !== queueGen.current) return;
        setQueueStatus(null);
        setQueueRoom(null);
        setError(m.reason);
        setStage("idle");
      });
      let handoffStarted = false;
      q.onMessage("match_found", (raw: unknown) => {
        if (gen !== queueGen.current) {
          void q.leave().catch(() => {});
          return;
        }
        if (handoffStarted) return;
        const handoff = validateMatchFoundMessage(raw, queue);
        if (!handoff.ok) {
          handoffStarted = true;
          setQueueStatus(null);
          void q.leave().catch(() => {});
          setError(handoff.reason);
          setStage("idle");
          return;
        }
        handoffStarted = true;
        setQueueStatus(null);
        setStage("connecting");
        void (async () => {
          try {
            const nextRoom = await client.consumeSeatReservation(handoff.message.reservation);
            if (gen !== queueGen.current) {
              await nextRoom.leave().catch(() => {});
              return;
            }
            await q.leave().catch(() => {});
            if (gen !== queueGen.current) {
              await nextRoom.leave().catch(() => {});
              return;
            }
            attachRoom(nextRoom, handoff.origin);
            appAudioController?.playUi("ready");
            setStage((current) => current === "connecting" ? "lobby" : current);
          } catch (e) {
            await q.leave().catch(() => {});
            setError(e instanceof Error ? e.message : String(e));
            setStage("idle");
          }
        })();
      });
      q.onLeave(() => {
        if (gen !== queueGen.current) return;
        setQueueRoom(null);
        setQueueStatus(null);
        setStage((s) => (s === "searching" ? "idle" : s));
      });
      setQueueRoom(q);
    } catch (e) {
      if (gen !== queueGen.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStage("idle");
    }
  }, [getAccessToken, attachRoom, appAudioController]);

  const cancelSearch = useCallback(() => {
    queueGen.current += 1;
    setQueueStatus(null);
    setQueueRoom(null);
    setStage("idle");
    void queueRoom?.leave().catch(() => {});
  }, [queueRoom]);

  const reset = useCallback(() => {
    reconnectGen.current += 1;
    queueGen.current += 1;
    const resumeOrigin = resumeInfo.current?.origin ?? resumeOriginForEntryMode(initialMode);
    resumeInfo.current = null;
    clearResume(resumeOrigin);
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
    audio.dispose();
    setAudioPhase("lobby");
    audioSeen.current.clear();
    audioResultSeen.current = null;
    audioPriming.current = false;
    setStage("idle");
  }, [audio, initialMode, room, queueRoom, setAudioPhase]);

  const battleAgainPending = useRef(false);
  const battleAgain = useCallback(() => {
    if (initialMode !== "practice" || connecting.current || battleAgainPending.current) return;
    battleAgainPending.current = true;
    reset();
    setTimeout(() => {
      battleAgainPending.current = false;
      void connect("practice");
    }, 0);
  }, [connect, initialMode, reset]);
  const findOpponentAgain = useCallback(() => {
    if (initialMode !== "unranked" || start?.practiceOpponent?.source !== "unranked-fallback" || connecting.current || battleAgainPending.current) return;
    battleAgainPending.current = true;
    reset();
    setTimeout(() => {
      battleAgainPending.current = false;
      void findMatch("unranked");
    }, 0);
  }, [findMatch, initialMode, reset, start?.practiceOpponent?.source]);
  const exitBattle = useCallback(() => {
    reset();
    if (publicMode && initialMode === "practice") router.push("/app/play");
  }, [initialMode, publicMode, reset, router]);

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
        clearResume(info.origin);
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
        attachRoom(r, info.origin); // the resumed start message flips stage back to active
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/over|authorized|not found|already started|expired|seat already connected/i.test(msg)) {
          resumeInfo.current = null;
          clearResume(info.origin);
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
    if (invalidInvite || !setupReady || !ready || !authenticated || stage !== "idle" || autoResumeTried.current) return;
    const stored = readResume(initialMode);
    if (!stored?.roomId || !stored.resumeToken) return;
    if (initialRoom && !hasMatchingInviteResume(initialRoom, stored)) return;
    const info = stored;
    const t = setTimeout(() => {
      if (autoResumeTried.current) return;
      autoResumeTried.current = true;
      resumeInfo.current = info;
      resumeDeadline.current = Date.now() + info.graceMs;
      setResumeDeadlineAt(resumeDeadline.current);
      setStage("reconnecting");
    }, 0);
    return () => clearTimeout(t);
  }, [ready, authenticated, stage, initialMode, initialRoom, invalidInvite, setupReady]);

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
  const fallbackSeconds = initialMode === "unranked" && stage === "searching" ? queueFallbackRemainingSeconds(queueStatus, now) : null;
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
      unlockAudio();
      deploy(selected, at);
      showGhost(null, null);
    },
    [selected, deploy, showGhost, unlockAudio]
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
    unlockAudio();
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

  const ENABLED = publicMode ? isPublicBattleAvailable() : DEV_ENABLED;
  if (!ENABLED) {
    return publicMode ? (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate">
            <h1 className="app-gate__title">Battle unavailable</h1>
            <p className="app-gate__lead">The battle server address is not configured for this deployment. Return to the lobby and try again later.</p>
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

  const identity = start ? battleIdentity(start, lobby) : null;
  const me = identity?.selfSeat ?? 0;

  return (
    <div className={publicMode ? "app-play-battle-shell" : undefined} data-mode={publicMode ? initialMode : undefined} data-stage={publicMode ? stage : undefined}>
      {!publicMode && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <span>stage: {stage}</span>
        {room && <span>room code: <b>{room.roomId}</b></span>}
        {error && <span style={{ color: "#f87171" }}>{error}</span>}
        {notice && <span style={{ color: "#86efac" }}>{notice}</span>}
        <button onClick={() => void logout()}>Log out</button>
      </div>}

      {publicMode && stage === "idle" && (
        <BattleEntry mode={initialMode} code={code} error={error} setupReady={setupReady} practiceDifficulty={selectedPracticeDifficulty} onCodeChange={setCode}
          onFind={() => { unlockAudio(); void findMatch(initialMode === "ranked" ? "ranked" : "unranked"); }}
          onStartPractice={(difficulty) => { unlockAudio(); void connect("practice", undefined, difficulty); }}
          onCreate={() => { unlockAudio(); void connect("create"); }} onJoin={() => { unlockAudio(); void connect("join"); }} />
      )}

      {stage === "connecting" && (
        <section className={publicMode ? "app-play-battle-controls" : undefined} style={publicMode ? undefined : { display: "grid", gap: 6 }}>
          <div role="status">{initialMode === "practice" ? "Starting practice against AI Opponent…" : "Connecting to the battle server…"}</div>
        </section>
      )}

      {publicMode && stage !== "idle" && error && <div className="app-play-battle-error" role="alert">{error}</div>}

      {!publicMode && stage === "idle" && (
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
            {fallbackSeconds !== null && <span> · Human opponent first · AI fallback in {fallbackSeconds}s</span>}
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
            <button className={publicMode ? "app-btn app-btn--ghost" : undefined} onClick={() => reset()}>Give up</button>
          </div>
        </section>
      )}

      {stage === "lobby" && lobby && (
        <BattleLobby lobby={lobby} roomCode={room?.roomId} now={now}
          getAccessToken={getAccessToken}
          onConfirm={(cards, commander: CommanderChoice) => room?.send("ready", { cards, commander })}
          onEdit={() => room?.send("unready")} />
      )}

      {start && (stage === "active" || stage === "reconnecting" || stage === "ended" || stage === "aborted") && (
        <BattleHud
          showDevDiagnostics={!publicMode}
          connectionStatus={stage === "reconnecting" ? `Reconnecting, ${Math.max(0, Math.ceil((resumeDeadlineAt - now) / 1000))}s left` : stage === "active" ? "Connected" : stage === "ended" ? "Match complete" : "Match interrupted"}
          error={error}
          notice={notice}
          onGiveUp={stage === "reconnecting" ? reset : undefined}
          onExit={initialMode === "practice" && publicMode ? exitBattle : reset}
          onBattleAgain={initialMode === "practice" ? battleAgain : start?.practiceOpponent?.source === "unranked-fallback" ? findOpponentAgain : undefined}
          start={start}
          playerName={identity?.self ?? undefined}
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
          audioMuted={audioPreferences.muted}
          audioReady={audioReady}
          audioVolume={audioPreferences.volume}
          onAudioUnlock={unlockAudio}
          onAudioCue={playAudioCue}
          onToggleAudio={toggleAudio}
          onAudioVolumeChange={setAudioVolume}
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
          <button className={publicMode ? "app-btn app-btn--ghost" : undefined} onClick={() => reset()}>Back to lobby</button>
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
