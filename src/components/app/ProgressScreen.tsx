"use client";

// Progress container (A3.2a).
//
// This file owns the session and the network. It reads the real player, stats,
// saved matches and casual leaderboard endpoints, turns them into plain props
// and hands them to ProgressView. The view stays free of tokens, fetch calls
// and Privy, so it can also be rendered from a presentation fixture.
//
// No progression is computed here. Stats, eligibility, ordering and pagination
// all come from the existing endpoints. A failed read keeps its failure state,
// so HTTP 500 can never become a zero-match record.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import ProgressView from "./ProgressView";
import { useLobbyCatalog } from "./catalog-context";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import type { LobbyNotice, LobbyPlayer } from "./lobby-types";
import {
  appendHistoryPage,
  failureBoard,
  failureHistory,
  failureStats,
  panelStateForCode,
  resolveBoard,
  resolveHistory,
  resolveStats,
  type BoardPayloadLike,
  type MatchLookup,
  type MatchesPayloadLike,
  type StatsPayloadLike,
} from "./progress-model";
import type { LeaderboardSummary, MatchHistory, ProgressPhase, StatsSummary } from "./progress-types";
import { useMedia, useSaveData } from "@/components/site/use-media";

const MATCH_PAGE_SIZE = 6;
const BOARD_PAGE_SIZE = 10;

interface ApiError {
  code: string;
  message: string;
  status: number;
  /** Present on a 404 that means the verified identity has no player row. */
  bootstrap?: boolean;
}

interface ReadFailure {
  ok: false;
  code: string;
  message: string;
  status: number;
  bootstrap?: boolean;
}

type Result<T> = { ok: true; data: T } | ReadFailure;

async function getJson<T>(path: string, token: string): Promise<Result<T>> {
  try {
    const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as {
      success: boolean;
      data?: T;
      error?: { code?: string; message?: string; details?: { bootstrap?: boolean } };
    };
    if (body.success && body.data !== undefined) return { ok: true, data: body.data };
    return {
      ok: false,
      code: body.error?.code ?? "REQUEST_FAILED",
      message: body.error?.message ?? `The server answered ${res.status}.`,
      status: res.status,
      bootstrap: body.error?.details?.bootstrap === true,
    };
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      message: "The progress screen could not reach the server.",
      status: 0,
    };
  }
}

/** Idempotent first-login entry point: it provisions the player row. */
async function postJson<T>(path: string, token: string): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    const body = (await res.json()) as {
      success: boolean;
      data?: T;
      error?: { code?: string; message?: string; details?: { bootstrap?: boolean } };
    };
    if (body.success && body.data !== undefined) return { ok: true, data: body.data };
    return {
      ok: false,
      code: body.error?.code ?? "REQUEST_FAILED",
      message: body.error?.message ?? `The server answered ${res.status}.`,
      status: res.status,
      bootstrap: body.error?.details?.bootstrap === true,
    };
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      message: "The progress screen could not reach the server.",
      status: 0,
    };
  }
}

function toApiError(failure: ReadFailure): ApiError {
  return {
    code: failure.code,
    message: failure.message,
    status: failure.status,
    bootstrap: failure.bootstrap,
  };
}

function profileNotice(error: ApiError): LobbyNotice {
  if (error.code === "NOT_FOUND") {
    return {
      tone: "warn",
      text: "This sign-in has no player profile yet, so the progress screen cannot open it.",
      action: { label: "Finish profile setup", href: "/dev/onboarding" },
    };
  }
  if (error.code === "BOOTSTRAP_FAILED") {
    return {
      tone: "error",
      text: `Your player profile could not be created. ${error.message}`,
      action: { label: "Open the setup tools", href: "/dev/onboarding" },
    };
  }
  if (error.code === "UNAUTHORIZED") {
    return { tone: "error", text: "Your session is no longer valid. Sign in again to open your progress." };
  }
  if (error.code === "FORBIDDEN") {
    return { tone: "error", text: error.message };
  }
  return { tone: "error", text: `Your progress could not be read. ${error.message}` };
}

interface Reads {
  /** GET /api/players/me nests the profile under data.player. */
  profile: Result<{ player: ProfilePayload }>;
  stats: Result<StatsPayloadLike>;
  matches: Result<MatchesPayloadLike>;
  board: Result<BoardPayloadLike>;
}

/** A verified stats payload as the identity fallback when the profile read fails. */
function statsPlayer(payload: StatsPayloadLike | null): LobbyPlayer | null {
  if (!payload) return null;
  const username = typeof payload.username === "string" ? payload.username : "";
  if (!username) return null;
  const avatar = payload.avatar;
  return {
    username,
    displayName: typeof payload.displayName === "string" ? payload.displayName : null,
    avatarUrl: avatar && typeof avatar.assetUrl === "string" ? avatar.assetUrl : null,
    avatarName: avatar && typeof avatar.name === "string" ? avatar.name : null,
    // The stats route does not report wallet linkage. False keeps the HUD chip
    // hidden rather than claiming a link that was not verified here.
    walletLinked: false,
    accountStatus: "",
    onboardingComplete: true,
    onboardingNextStep: "complete",
  };
}

export default function ProgressScreen() {
  const catalog = useLobbyCatalog();
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [profileError, setProfileError] = useState<ApiError | null>(null);
  const [statsData, setStatsData] = useState<StatsPayloadLike | null>(null);
  const [statsError, setStatsError] = useState<ApiError | null>(null);
  const [historyData, setHistoryData] = useState<MatchHistory | null>(null);
  const [historyError, setHistoryError] = useState<ApiError | null>(null);
  const [historyPageError, setHistoryPageError] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [boardData, setBoardData] = useState<LeaderboardSummary | null>(null);
  const [boardError, setBoardError] = useState<ApiError | null>(null);
  const [boardPageError, setBoardPageError] = useState<string | null>(null);
  const [boardBusy, setBoardBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The Privy user the current reads belong to. */
  const sessionKey = user?.id ?? null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const bootstrapTried = useRef(false);

  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const saveData = useSaveData();
  const calm = reducedMotion || saveData;

  const lookup = useMemo<MatchLookup>(() => {
    const classNames: Record<string, string> = {};
    for (const commander of catalog.commanders) classNames[commander.classId] = commander.className;
    const cardNames: Record<string, string> = {};
    for (const card of Object.values(catalog.cards)) cardNames[card.id] = card.name;
    return { classNames, cardNames };
  }, [catalog]);

  const readAll = useCallback(async (token: string): Promise<Reads> => {
    const [profileResult, statsResult, matchesResult, boardResult] = await Promise.all([
      getJson<{ player: ProfilePayload }>("/api/players/me", token),
      getJson<StatsPayloadLike>("/api/players/me/stats", token),
      getJson<MatchesPayloadLike>(`/api/players/me/matches?limit=${MATCH_PAGE_SIZE}`, token),
      getJson<BoardPayloadLike>(`/api/leaderboard/casual?limit=${BOARD_PAGE_SIZE}&offset=0`, token),
    ]);
    return {
      profile: profileResult,
      stats: statsResult,
      matches: matchesResult,
      board: boardResult,
    };
  }, []);

  const apply = useCallback(
    (reads: Reads) => {
      if (reads.profile.ok) {
        setProfile(reads.profile.data.player);
        setProfileError(null);
      } else {
        setProfile(null);
        setProfileError(toApiError(reads.profile));
      }

      if (reads.stats.ok) {
        setStatsData(reads.stats.data);
        setStatsError(null);
      } else {
        setStatsData(null);
        setStatsError(toApiError(reads.stats));
      }

      if (reads.matches.ok) {
        setHistoryData(resolveHistory(reads.matches.data, lookup));
        setHistoryError(null);
      } else {
        setHistoryData(null);
        setHistoryError(toApiError(reads.matches));
      }

      if (reads.board.ok) {
        setBoardData(resolveBoard(reads.board.data));
        setBoardError(null);
      } else {
        setBoardData(null);
        setBoardError(toApiError(reads.board));
      }
    },
    [lookup]
  );

  const load = useCallback(async () => {
    // The first await keeps every state update out of the synchronous part of
    // the call, so the loader can be started straight from an effect.
    const token = await getAccessToken();
    setBusy(true);
    setHistoryPageError(null);
    setBoardPageError(null);
    try {
      if (!token) {
        setProfile(null);
        setProfileError({ code: "UNAUTHORIZED", message: "Sign in to open your progress.", status: 401 });
        return;
      }

      let reads = await readAll(token);

      // A verified identity with no player row yet: the bootstrap endpoint is
      // the documented first-login entry point, so provision and read again.
      if (!reads.profile.ok && reads.profile.code === "NOT_FOUND" && reads.profile.bootstrap) {
        if (!bootstrapTried.current) {
          bootstrapTried.current = true;
          const created = await postJson<unknown>("/api/auth/bootstrap", token);
          if (created.ok) {
            reads = await readAll(token);
          } else {
            setProfile(null);
            setProfileError({ code: "BOOTSTRAP_FAILED", message: created.message, status: created.status });
            setStatsData(null);
            setStatsError(null);
            setHistoryData(null);
            setHistoryError(null);
            setBoardData(null);
            setBoardError(null);
            return;
          }
        }
      }

      apply(reads);
    } finally {
      setBusy(false);
      setLoadedFor(sessionKey);
    }
  }, [getAccessToken, readAll, apply, sessionKey]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    // Start the reads on the next tick so the effect body never sets state.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [ready, authenticated, load]);

  const loadMoreMatches = useCallback(async () => {
    if (busy || historyBusy || !historyData?.nextCursor) return;
    const token = await getAccessToken();
    if (!token) {
      setHistoryPageError("Your session is no longer valid. Sign out and sign back in to load more matches.");
      return;
    }
    setHistoryBusy(true);
    setHistoryPageError(null);
    try {
      const result = await getJson<MatchesPayloadLike>(
        `/api/players/me/matches?limit=${MATCH_PAGE_SIZE}&cursor=${encodeURIComponent(historyData.nextCursor)}`,
        token
      );
      if (!result.ok) {
        setHistoryPageError("More matches could not be loaded. The saved results above are unchanged.");
        return;
      }
      const page = resolveHistory(result.data, lookup);
      if (page.state !== "ready" && page.state !== "empty") {
        setHistoryPageError("More matches could not be loaded. The saved results above are unchanged.");
        return;
      }
      setHistoryData((previous) => (previous ? appendHistoryPage(previous, page) : page));
    } finally {
      setHistoryBusy(false);
    }
  }, [busy, historyBusy, historyData, getAccessToken, lookup]);

  const loadBoardPage = useCallback(
    async (offset: number) => {
      if (busy || boardBusy) return;
      const token = await getAccessToken();
      if (!token) {
        setBoardPageError("Your session is no longer valid. Sign out and sign back in to load another page.");
        return;
      }
      setBoardBusy(true);
      setBoardPageError(null);
      try {
        const result = await getJson<BoardPayloadLike>(
          `/api/leaderboard/casual?limit=${BOARD_PAGE_SIZE}&offset=${offset}`,
          token
        );
        if (!result.ok) {
          setBoardPageError("The next page of standings could not be loaded. The current page is unchanged.");
          return;
        }
        const next = resolveBoard(result.data);
        if (next.state !== "ready" && next.state !== "empty") {
          setBoardPageError("The next page of standings could not be loaded. The current page is unchanged.");
          return;
        }
        // An empty page past the first one is not proof that the board is
        // empty. Keep the current page and state the failure instead.
        if (next.state === "empty" && offset > 0 && next.total > 0) {
          setBoardPageError("That page of standings is no longer there. The current page is unchanged.");
          return;
        }
        setBoardData(next);
      } finally {
        setBoardBusy(false);
      }
    },
    [busy, boardBusy, getAccessToken]
  );

  const player: LobbyPlayer | null = useMemo(() => {
    if (profile) return resolvePlayer(profile);
    return statsPlayer(statsData);
  }, [profile, statsData]);

  const stats: StatsSummary = useMemo(() => {
    if (statsData) return resolveStats(statsData);
    return failureStats(statsError ? panelStateForCode(statsError.code) : "unavailable");
  }, [statsData, statsError]);

  const history: MatchHistory = useMemo(() => {
    if (historyData) return historyData;
    return failureHistory(historyError ? panelStateForCode(historyError.code) : "unavailable");
  }, [historyData, historyError]);

  const board: LeaderboardSummary = useMemo(() => {
    if (boardData) return boardData;
    return failureBoard(boardError ? panelStateForCode(boardError.code) : "unavailable");
  }, [boardData, boardError]);

  const notices = useMemo(() => {
    const list: LobbyNotice[] = [];
    if (profileError && !player) list.push(profileNotice(profileError));

    const sessionFailed =
      profileError?.code === "UNAUTHORIZED" ||
      statsError?.code === "UNAUTHORIZED" ||
      historyError?.code === "UNAUTHORIZED" ||
      boardError?.code === "UNAUTHORIZED";
    if (sessionFailed && !(profileError && !player)) {
      list.push({
        tone: "error",
        text: "Your session is no longer valid. Sign out and sign back in to load your progress.",
      });
    }

    const onboardingIncomplete = profile ? !profile.onboarding.complete : false;
    if (onboardingIncomplete) {
      list.push({
        tone: "info",
        text: "Your profile setup is not finished, so your verified record, match history and casual standings stay locked.",
        action: { label: "Finish profile setup", href: "/dev/onboarding" },
      });
    } else if ([statsError, historyError, boardError].some((error) => error?.code === "FORBIDDEN")) {
      list.push({
        tone: "warn",
        text: "Your match records are locked until your profile setup is complete.",
        action: { label: "Finish profile setup", href: "/dev/onboarding" },
      });
    }

    return list;
  }, [profileError, statsError, historyError, boardError, profile, player]);

  const loaded = authenticated && sessionKey !== null && loadedFor === sessionKey;

  const phase: ProgressPhase = !ready
    ? "booting"
    : !authenticated
      ? "login"
      : !loaded
        ? "booting"
        : !player
          ? "profile"
          : "ready";

  const status = useMemo(() => {
    const parts: string[] = [];
    if (phase === "ready") {
      if (stats.state === "ready") {
        parts.push(
          `${stats.total} verified matches, ${stats.wins} wins, ${stats.losses} losses, ${stats.draws} draws.`
        );
      } else if (stats.state === "empty") {
        parts.push("No verified matches yet.");
      } else if (stats.state === "locked") {
        parts.push("The verified record is locked.");
      } else if (stats.state === "auth") {
        parts.push("The session expired before the record could be read.");
      } else {
        parts.push("The verified record is unavailable.");
      }

      if (history.state === "ready") {
        parts.push(`${history.rows.length} saved match${history.rows.length === 1 ? "" : "es"} loaded.`);
      } else if (history.state === "empty") {
        parts.push("No saved matches yet.");
      } else {
        parts.push("Match history is unavailable.");
      }

      if (board.state === "ready") {
        parts.push(`${board.entries.length} of ${board.total} casual standings shown.`);
      } else if (board.state === "empty") {
        parts.push("No casual qualifiers yet.");
      } else {
        parts.push("The casual leaderboard is unavailable.");
      }
    }
    if (busy) parts.push("Refreshing your progress.");
    if (historyBusy) parts.push("Loading more matches.");
    if (boardBusy) parts.push("Loading another page of standings.");
    return parts.join(" ");
  }, [phase, stats, history, board, busy, historyBusy, boardBusy]);

  const onSignIn = useCallback(() => {
    void login();
  }, [login]);

  const onSignOut = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <ProgressView
      phase={phase}
      player={player}
      stats={stats}
      history={history}
      board={board}
      notices={notices}
      busy={busy}
      historyBusy={historyBusy}
      boardBusy={boardBusy}
      historyPageError={historyPageError}
      boardPageError={boardPageError}
      calm={calm}
      status={status}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
      onRefresh={() => void load()}
      onLoadMoreMatches={() => void loadMoreMatches()}
      onBoardPage={(offset) => void loadBoardPage(offset)}
    />
  );
}
