"use client";

// Genesis legacy vault container (A3.2b).
//
// This file owns the session and the network. It reads the real player, the
// verified-wallet Genesis holdings and the commander enrichment, then loads
// one token's legacy record and earned achievements through the existing
// token routes. The view stays free of tokens, fetch calls and Privy.
//
// No ownership is inferred from the commander eligibility flag. Current
// holdings are cached observations; a commander appearance carries its own
// match-start ownership proof, and an Arena Patron appearance is a separate
// server-selected relationship.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import LegacyView from "./LegacyView";
import { sessionNotice } from "./feedback-model";
import { useLobbyCatalog } from "./catalog-context";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import type { LobbyNotice, LobbyPlayer } from "./lobby-types";
import {
  appendLegacyPage,
  defaultTokenId,
  failureRecord,
  failureVault,
  resolveAchievements,
  resolveLegacyRecord,
  resolveVault,
  type AchievementsPayloadLike,
  type CommandersPayloadLike,
  type LegacyClassInfo,
  type LegacyLookup,
  type LegacyPayloadLike,
  type NftsPayloadLike,
} from "./legacy-model";
import type {
  LegacyPhase,
  LegacyRecordState,
  LegacyRecordView,
  VaultState,
  VaultSummary,
} from "./legacy-types";

const HISTORY_PAGE_SIZE = 10;

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
      message: "The legacy vault could not reach the server.",
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
      message: "The legacy vault could not reach the server.",
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
      text: "This sign-in has no player profile yet, so the legacy vault cannot open it.",
      action: { label: "Finish profile setup", href: "/app/onboarding" },
    };
  }
  if (error.code === "BOOTSTRAP_FAILED") {
    return {
      tone: "error",
      text: `Your player profile could not be created. ${error.message}`,
      action: { label: "Open the setup tools", href: "/app/onboarding" },
    };
  }
  if (error.code === "UNAUTHORIZED") {
    return sessionNotice("open your legacy vault");
  }
  if (error.code === "FORBIDDEN") {
    return { tone: "error", text: error.message };
  }
  return { tone: "error", text: `Your legacy vault could not be read. ${error.message}` };
}

function vaultStateForCode(code: string): VaultState {
  if (code === "UNAUTHORIZED") return "auth";
  if (code === "FORBIDDEN") return "locked";
  return "unavailable";
}

function recordStateForCode(code: string): LegacyRecordState {
  if (code === "NOT_FOUND") return "not-found";
  if (code === "UNAUTHORIZED") return "auth";
  if (code === "FORBIDDEN") return "locked";
  return "unavailable";
}

interface Reads {
  /** GET /api/players/me nests the profile under data.player. */
  profile: Result<{ player: ProfilePayload }>;
  nfts: Result<NftsPayloadLike>;
  commanders: Result<CommandersPayloadLike>;
}

export default function LegacyScreen() {
  const catalog = useLobbyCatalog();
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [profileError, setProfileError] = useState<ApiError | null>(null);
  const [vault, setVault] = useState<VaultSummary | null>(null);
  const [commandersError, setCommandersError] = useState<ApiError | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [record, setRecord] = useState<LegacyRecordView | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [achievementsData, setAchievementsData] = useState<AchievementsPayloadLike | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyPageError, setHistoryPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const sessionKey = user?.id ?? null;
  const bootstrapTried = useRef(false);
  const selectionSeq = useRef(0);

  const lookup = useMemo<LegacyLookup>(() => {
    const classes: Record<string, LegacyClassInfo> = {};
    for (const commander of catalog.commanders) {
      classes[commander.classId] = { className: commander.className, art: commander.art };
    }
    return { classes };
  }, [catalog]);

  const readAll = useCallback(async (token: string): Promise<Reads> => {
    const [profileResult, nftsResult, commandersResult] = await Promise.all([
      getJson<{ player: ProfilePayload }>("/api/players/me", token),
      getJson<NftsPayloadLike>("/api/players/me/nfts", token),
      getJson<CommandersPayloadLike>("/api/players/me/commanders", token),
    ]);
    return { profile: profileResult, nfts: nftsResult, commanders: commandersResult };
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

      if (reads.nfts.ok) {
        const nextVault = resolveVault(
          reads.nfts.data,
          reads.commanders.ok ? reads.commanders.data : null,
          lookup
        );
        setVault(nextVault);
        // A new vault read can change the selected token. Never paint the
        // previous token's record under the new selection while the detail
        // read is in flight.
        setRecord(null);
        setAchievementsData(null);
        setRecordLoading(true);
        setHistoryPageError(null);
        setSelectedTokenId((current) => {
          if (current && nextVault.tokens.some((token) => token.tokenId === current)) return current;
          return defaultTokenId(nextVault);
        });
      } else {
        setVault(failureVault(vaultStateForCode(reads.nfts.code)));
        setSelectedTokenId(null);
        setRecord(null);
        setAchievementsData(null);
        setRecordLoading(false);
      }

      setCommandersError(reads.commanders.ok ? null : toApiError(reads.commanders));
    },
    [lookup]
  );

  const load = useCallback(async () => {
    // The first await keeps state updates out of the synchronous part of the
    // call, so the loader can start straight from an effect.
    const token = await getAccessToken();
    setBusy(true);
    try {
      if (!token) {
        setProfile(null);
        setProfileError({ code: "UNAUTHORIZED", message: "Sign in to open your legacy vault.", status: 401 });
        return;
      }

      let reads = await readAll(token);

      if (!reads.profile.ok && reads.profile.code === "NOT_FOUND" && reads.profile.bootstrap) {
        if (!bootstrapTried.current) {
          bootstrapTried.current = true;
          const created = await postJson<unknown>("/api/auth/bootstrap", token);
          if (created.ok) {
            reads = await readAll(token);
          } else {
            setProfile(null);
            setProfileError({ code: "BOOTSTRAP_FAILED", message: created.message, status: created.status });
            setVault(null);
            setSelectedTokenId(null);
            setRecord(null);
            setAchievementsData(null);
            return;
          }
        }
      }

      apply(reads);
      setReloadKey((key) => key + 1);
    } finally {
      setBusy(false);
      setLoadedFor(sessionKey);
    }
  }, [getAccessToken, readAll, apply, sessionKey]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [ready, authenticated, load]);

  // A selection change invalidates any in-flight detail request.
  useEffect(() => {
    return () => {
      selectionSeq.current += 1;
    };
  }, [selectedTokenId]);

  const loadSelected = useCallback(
    async (tokenId: string) => {
      const seq = ++selectionSeq.current;
      const token = await getAccessToken();
      if (seq !== selectionSeq.current) return;
      if (!token) {
        setRecord(failureRecord("auth"));
        setRecordLoading(false);
        return;
      }

      setRecordLoading(true);
      setRecord(null);
      setAchievementsData(null);
      setHistoryPageError(null);
      setHistoryBusy(false);

      try {
        const [legacyResult, achievementsResult] = await Promise.all([
          getJson<LegacyPayloadLike>(
            `/api/nfts/${encodeURIComponent(tokenId)}/legacy?limit=${HISTORY_PAGE_SIZE}&offset=0`,
            token
          ),
          getJson<AchievementsPayloadLike>(`/api/nfts/${encodeURIComponent(tokenId)}/achievements`, token),
        ]);
        if (seq !== selectionSeq.current) return;

        if (legacyResult.ok) {
          setRecord(resolveLegacyRecord(legacyResult.data, 0, lookup));
        } else {
          setRecord(failureRecord(recordStateForCode(legacyResult.code)));
        }

        setAchievementsData(achievementsResult.ok ? achievementsResult.data : null);
      } finally {
        if (seq === selectionSeq.current) setRecordLoading(false);
      }
    },
    [getAccessToken, lookup]
  );

  useEffect(() => {
    if (!ready || !authenticated || !profile || !selectedTokenId) return;
    const timer = setTimeout(() => void loadSelected(selectedTokenId), 0);
    return () => clearTimeout(timer);
  }, [ready, authenticated, profile, selectedTokenId, reloadKey, loadSelected]);

  const loadMore = useCallback(async () => {
    if (busy || historyBusy || !record || record.nextOffset === null) return;
    const tokenId = record.tokenId ?? selectedTokenId;
    if (!tokenId) return;
    const seq = selectionSeq.current;
    const token = await getAccessToken();
    if (!token) {
      setHistoryPageError("Your session is no longer valid. Sign out and sign back in to load more events.");
      return;
    }
    setHistoryBusy(true);
    setHistoryPageError(null);
    try {
      const result = await getJson<LegacyPayloadLike>(
        `/api/nfts/${encodeURIComponent(tokenId)}/legacy?limit=${HISTORY_PAGE_SIZE}&offset=${record.nextOffset}`,
        token
      );
      if (seq !== selectionSeq.current) return;
      if (!result.ok) {
        setHistoryPageError("More recorded events could not be loaded. The trail above is unchanged.");
        return;
      }
      const page = resolveLegacyRecord(result.data, record.nextOffset, lookup);
      if (page.state !== "ready" && page.state !== "empty") {
        setHistoryPageError("More recorded events could not be loaded. The trail above is unchanged.");
        return;
      }
      setRecord((previous) => (previous ? appendLegacyPage(previous, page) : page));
    } finally {
      if (seq === selectionSeq.current) setHistoryBusy(false);
    }
  }, [busy, historyBusy, record, selectedTokenId, getAccessToken, lookup]);

  const player: LobbyPlayer | null = useMemo(() => (profile ? resolvePlayer(profile) : null), [profile]);

  const vaultView: VaultSummary = useMemo(() => vault ?? failureVault("unavailable"), [vault]);
  const recordView: LegacyRecordView = useMemo(() => record ?? failureRecord("unavailable"), [record]);

  const selectedToken = useMemo(
    () => vaultView.tokens.find((token) => token.tokenId === selectedTokenId) ?? null,
    [vaultView.tokens, selectedTokenId]
  );

  const achievements = useMemo(
    () => resolveAchievements(recordView, achievementsData),
    [recordView, achievementsData]
  );

  const notices = useMemo(() => {
    const list: LobbyNotice[] = [];
    if (profileError && !player) list.push(profileNotice(profileError));

    const authFailed = vaultView.state === "auth" || commandersError?.code === "UNAUTHORIZED";
    if (authFailed && !(profileError && !player)) {
      list.push(sessionNotice("load your legacy vault"));
    }

    if (profile && !profile.onboarding.complete && vaultView.state !== "no-wallet") {
      list.push({
        tone: "info",
        text: "Your profile setup is not finished. Your verified-wallet holdings are still shown.",
        action: { label: "Finish profile setup", href: "/app/onboarding" },
      });
    }

    if (commandersError && vaultView.state === "ready") {
      list.push({
        tone: "warn",
        text: "Commander class details could not be read, so token classes are not shown.",
      });
    }

    return list;
  }, [profileError, player, vaultView.state, commandersError, profile]);

  const loaded = authenticated && sessionKey !== null && loadedFor === sessionKey;

  const phase: LegacyPhase = !ready
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
      if (vaultView.state === "ready") {
        parts.push(`${vaultView.tokens.length} Genesis tokens in the vault.`);
      } else if (vaultView.state === "empty") {
        parts.push("The Genesis vault is empty.");
      } else if (vaultView.state === "no-wallet") {
        parts.push("No verified wallet is linked.");
      } else {
        parts.push("The Genesis vault is unavailable.");
      }

      if (selectedToken) {
        parts.push(`Selected ${selectedToken.name}, Genesis token ${selectedToken.tokenId}.`);
      }

      if (recordLoading) {
        parts.push("Reading the legacy record.");
      } else if (recordView.state === "ready") {
        parts.push(
          `${recordView.stats?.commanderAppearances ?? 0} commander appearances, ${
            recordView.stats?.patronAppearances ?? 0
          } Arena Patron appearances, ${achievements.earnedCount} achievements earned.`
        );
      } else if (recordView.state === "empty") {
        parts.push("No recorded legacy yet.");
      } else {
        parts.push("The legacy record is unavailable.");
      }
    }
    if (busy) parts.push("Refreshing the legacy vault.");
    if (historyBusy) parts.push("Loading more recorded events.");
    return parts.join(" ");
  }, [phase, vaultView.state, vaultView.tokens.length, selectedToken, recordLoading, recordView, achievements.earnedCount, busy, historyBusy]);

  const onSignIn = useCallback(() => {
    void login();
  }, [login]);

  const onSignOut = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <LegacyView
      phase={phase}
      player={player}
      vault={vaultView}
      selectedToken={selectedToken}
      record={recordView}
      recordLoading={recordLoading}
      achievements={achievements}
      notices={notices}
      busy={busy}
      historyBusy={historyBusy}
      historyPageError={historyPageError}
      status={status}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
      onRefresh={() => void load()}
      onSelectToken={(tokenId) => {
        if (tokenId === selectedTokenId) return;
        setSelectedTokenId(tokenId);
        setRecord(null);
        setAchievementsData(null);
        setRecordLoading(true);
        setHistoryPageError(null);
      }}
      onLoadMore={() => void loadMore()}
    />
  );
}
