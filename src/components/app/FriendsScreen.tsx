"use client";

// The friends screen (B4.1).
//
// This file owns the session and the network. It reads the real friendship
// lists and username search from the existing /api/players/me/friends routes,
// and every mutation re-reads the server state before the view updates, so a
// reload can never disagree with what is shown. The view stays free of
// tokens, fetch calls and Privy.
//
// Nothing here invents a relationship. A friend, request or search hit only
// appears after the server confirms it, and no wallet address, player id or
// Privy identifier ever reaches the view.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import FriendsView from "./FriendsView";
import { useMedia, useSaveData } from "@/components/site/use-media";
import { feedbackNoticeFor, sessionNotice } from "./feedback-model";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import type { BlockedEntry, FriendLists, FriendSearchHit, FriendsApiError } from "./friends-types";
import type { LobbyNotice, LobbyPlayer } from "./lobby-types";

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; bootstrap?: boolean };

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
      bootstrap: body.error?.details?.bootstrap === true,
    };
  } catch {
    return { ok: false, code: "NETWORK", message: "Friends could not reach the server." };
  }
}

async function sendJson<T>(path: string, token: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await res.json()) as {
      success: boolean;
      data?: T;
      error?: { code?: string; message?: string; details?: { bootstrap?: boolean } };
    };
    if (payload.success && payload.data !== undefined) return { ok: true, data: payload.data };
    return {
      ok: false,
      code: payload.error?.code ?? "REQUEST_FAILED",
      message: payload.error?.message ?? `The server answered ${res.status}.`,
      bootstrap: payload.error?.details?.bootstrap === true,
    };
  } catch {
    return { ok: false, code: "NETWORK", message: "Friends could not reach the server." };
  }
}

const EMPTY_LISTS: FriendLists = { friends: [], incoming: [], outgoing: [] };

function FriendsShell() {
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [profileError, setProfileError] = useState<FriendsApiError | null>(null);
  const [lists, setLists] = useState<FriendLists>(EMPTY_LISTS);
  const [listsOk, setListsOk] = useState(false);
  const [listsError, setListsError] = useState<FriendsApiError | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<FriendSearchHit[] | null>(null);
  const [searchOk, setSearchOk] = useState(true);
  const [searchError, setSearchError] = useState<FriendsApiError | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<FriendsApiError | null>(null);
  const [blocked, setBlocked] = useState<BlockedEntry[]>([]);
  const [blockedOk, setBlockedOk] = useState(false);
  const [blockedError, setBlockedError] = useState<FriendsApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const sessionKey = user?.id ?? null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loadedForRef = useRef<string | null>(null);
  useEffect(() => {
    loadedForRef.current = loadedFor;
  }, [loadedFor]);

  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const saveData = useSaveData();
  const calm = reducedMotion || saveData;

  const readLists = useCallback(async (token: string): Promise<boolean> => {
    const res = await getJson<FriendLists>("/api/players/me/friends", token);
    if (res.ok) {
      setLists(res.data);
      setListsOk(true);
      setListsError(null);
      return true;
    }
    setListsOk(false);
    setListsError({ code: res.code, message: res.message });
    return false;
  }, []);

  const readBlocked = useCallback(async (token: string): Promise<boolean> => {
    const res = await getJson<{ blocked: BlockedEntry[] }>("/api/players/me/blocks", token);
    if (res.ok) {
      setBlocked(res.data.blocked);
      setBlockedOk(true);
      setBlockedError(null);
      return true;
    }
    setBlockedOk(false);
    setBlockedError({ code: res.code, message: res.message });
    return false;
  }, []);

  const load = useCallback(
    async (token: string | null) => {
      setBusy(true);
      try {
        if (!token) {
          setProfile(null);
          setProfileError({ code: "UNAUTHORIZED", message: "Sign in to open friends." });
          return;
        }
        const [profileRes] = await Promise.all([
          getJson<{ player: ProfilePayload }>("/api/players/me", token),
        ]);
        if (!profileRes.ok) {
          setProfile(null);
          setProfileError({ code: profileRes.code, message: profileRes.message });
          await readLists(token);
          await readBlocked(token);
          return;
        }
        setProfile(profileRes.data.player);
        setProfileError(null);
        await readLists(token);
        await readBlocked(token);
      } finally {
        setBusy(false);
        setLoadedFor(sessionKey);
      }
    },
    [readLists, readBlocked, sessionKey]
  );

  useEffect(() => {
    if (!ready || !authenticated) return;
    const timer = setTimeout(() => {
      void (async () => {
        if (loadedForRef.current === sessionKey) return;
        const token = await getAccessToken();
        await load(token);
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [ready, authenticated, sessionKey, getAccessToken, load]);

  const mutate = useCallback(
    async (id: string, run: (token: string) => Promise<Result<unknown>>) => {
      const token = await getAccessToken();
      if (!token) {
        setActionError({ code: "UNAUTHORIZED", message: "Your session expired. Sign in again." });
        return;
      }
      setActionId(id);
      setActionError(null);
      try {
        const res = await run(token);
        if (!res.ok) {
          setActionError({ code: res.code, message: res.message });
          return;
        }
        await readLists(token);
        await readBlocked(token);
        if (searchHits !== null && searchQuery.trim().length > 0) {
          const again = await getJson<{ results: FriendSearchHit[] }>(
            `/api/players/me/friends/search?q=${encodeURIComponent(searchQuery.trim())}`,
            token
          );
          if (again.ok) {
            setSearchHits(again.data.results);
            setSearchOk(true);
            setSearchError(null);
          }
        }
      } finally {
        setActionId(null);
      }
    },
    [getAccessToken, readLists, readBlocked, searchHits, searchQuery]
  );

  const onSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (q.length === 0) return;
    const token = await getAccessToken();
    if (!token) {
      setSearchError({ code: "UNAUTHORIZED", message: "Your session expired. Sign in again." });
      return;
    }
    setBusy(true);
    try {
      const res = await getJson<{ results: FriendSearchHit[] }>(
        `/api/players/me/friends/search?q=${encodeURIComponent(q)}`,
        token
      );
      if (res.ok) {
        setSearchHits(res.data.results);
        setSearchOk(true);
        setSearchError(null);
      } else {
        setSearchOk(false);
        setSearchError({ code: res.code, message: res.message });
      }
    } finally {
      setBusy(false);
    }
  }, [getAccessToken, searchQuery]);

  const player: LobbyPlayer | null = useMemo(() => (profile ? resolvePlayer(profile) : null), [profile]);

  const notices = useMemo(() => {
    const list: LobbyNotice[] = [];
    if (profileError) {
      list.push(
        feedbackNoticeFor(
          { code: profileError.code, message: profileError.message },
          "open friends"
        )
      );
    }
    if (listsError) {
      list.push(
        feedbackNoticeFor(
          { code: listsError.code, message: listsError.message },
          "load your friends"
        )
      );
    }
    if (searchError) {
      list.push(
        feedbackNoticeFor({ code: searchError.code, message: searchError.message }, "search players")
      );
    }
    if (blockedError) {
      list.push(
        feedbackNoticeFor(
          { code: blockedError.code, message: blockedError.message },
          "load your blocked players"
        )
      );
    }
    if (actionError) {
      if (actionError.code === "NOT_FOUND") {
        list.push({
          tone: "error",
          text: "That request is no longer there. Refresh to see the current list.",
          action: { label: "Try again", kind: "retry" },
        });
      } else if (actionError.code === "FORBIDDEN") {
        list.push({
          tone: "error",
          text: "That player is unavailable. Refresh to see the current list.",
          action: { label: "Try again", kind: "retry" },
        });
      } else {
        list.push(
          feedbackNoticeFor({ code: actionError.code, message: actionError.message }, "update that friendship")
        );
      }
    }
    if (!profileError && listsError?.code === "UNAUTHORIZED") {
      list.push(sessionNotice("open friends"));
    }
    return list;
  }, [profileError, listsError, searchError, blockedError, actionError]);

  const loaded = authenticated && sessionKey !== null && loadedFor === sessionKey;
  const phase = !ready
    ? "booting"
    : !authenticated
      ? "login"
      : !loaded
        ? "booting"
        : profileError || !profile
          ? "profile"
          : "ready";

  const listsState = phase !== "ready" ? "unavailable" : !listsOk ? "unavailable" : "ready";
  const blockedState = phase !== "ready" ? "unavailable" : !blockedOk ? "unavailable" : "ready";
  const searchState =
    !searchOk ? "unavailable" : searchHits === null ? "idle" : searchHits.length === 0 ? "empty" : "ready";

  const status = useMemo(() => {
    if (phase !== "ready") return "";
    const parts = ["Friends loaded."];
    if (listsOk) {
      parts.push(
        `${lists.friends.length} friends, ${lists.incoming.length} incoming, ${lists.outgoing.length} sent.`
      );
    } else {
      parts.push("The list is unavailable.");
    }
    if (busy) parts.push("Refreshing friends.");
    return parts.join(" ");
  }, [phase, listsOk, lists, busy]);

  return (
    <FriendsView
      phase={phase}
      player={player}
      lists={lists}
      listsState={listsState}
      searchQuery={searchQuery}
      searchHits={searchHits}
      searchState={searchState}
      actionId={actionId}
      busy={busy}
      notices={notices}
      calm={calm}
      status={status}
      onSignIn={() => void login()}
      onSignOut={() => void logout()}
      onRefresh={() => void getAccessToken().then((t) => load(t))}
      onSearchChange={setSearchQuery}
      onSearch={() => void onSearch()}
      onSend={(playerId) => void mutate(playerId, (t) => sendJson("/api/players/me/friends", t, "POST", { playerId })) }
      onAccept={(fid) => void mutate(fid, (t) => sendJson(`/api/players/me/friends/${fid}/accept`, t, "POST"))}
      onDecline={(fid) => void mutate(fid, (t) => sendJson(`/api/players/me/friends/${fid}/decline`, t, "POST"))}
      onRemove={(fid) => void mutate(fid, (t) => sendJson(`/api/players/me/friends/${fid}`, t, "DELETE"))}
      blocked={blocked}
      blockedState={blockedState}
      onBlock={(playerId) =>
        void mutate(`block:${playerId}`, (t) => sendJson("/api/players/me/blocks", t, "POST", { playerId }))
      }
      onUnblock={(playerId) =>
        void mutate(`unblock:${playerId}`, (t) => sendJson(`/api/players/me/blocks/${playerId}`, t, "DELETE"))
      }
    />
  );
}

export default function FriendsScreen() {
  return <FriendsShell />;
}
