"use client";

// Commanders gallery screen (A4.2).
//
// This file owns the session and the network. It reads the real player and the
// authenticated commander eligibility route, then hands plain props to
// CommandersView. The five free classes come from the live ruleset catalog in
// the app shell.
//
// Browsing is read-only. This screen never reads, writes or drafts a loadout,
// so focusing a commander here cannot change the deck saved to the account.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import CommandersView from "./CommandersView";
import { useLobbyCatalog } from "./catalog-context";
import { resolveCommander, resolvePlayer, type CommandersPayload, type ProfilePayload } from "./lobby-model";
import { useMedia, useSaveData } from "@/components/site/use-media";
import {
  buildGalleryClasses,
  defaultSelectionKey,
  eligibilityNotice,
  galleryEligibility,
  galleryProfileNotice,
  genesisFromError,
  parseGenesisCatalog,
  resolveGallerySelection,
  selectionChoice,
} from "./commanders-model";
import type { CommandersPhase } from "./commanders-types";
import type { LobbyNotice, LobbyPlayer } from "./lobby-types";

interface ApiError {
  code: string;
  message: string;
  bootstrap?: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string; bootstrap?: boolean };

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
    return { ok: false, code: "NETWORK", message: "The commanders gallery could not reach the server." };
  }
}

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
      bootstrap: body.error?.details?.bootstrap === true,
    };
  } catch {
    return { ok: false, code: "NETWORK", message: "The commanders gallery could not reach the server." };
  }
}

interface Reads {
  /** GET /api/players/me nests the profile under data.player. */
  profile: Result<{ player: ProfilePayload }>;
  commanders: Result<CommandersPayload>;
}

function CommandersShell() {
  const catalog = useLobbyCatalog();
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [profileError, setProfileError] = useState<ApiError | null>(null);
  const [commanders, setCommanders] = useState<CommandersPayload | null>(null);
  const [commandersError, setCommandersError] = useState<ApiError | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The Privy user the finished reads belong to. */
  const sessionKey = user?.id ?? null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const bootstrapTried = useRef(false);

  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const saveData = useSaveData();
  const calm = reducedMotion || saveData;

  const readAll = useCallback(async (token: string): Promise<Reads> => {
    const [profileResult, commandersResult] = await Promise.all([
      getJson<{ player: ProfilePayload }>("/api/players/me", token),
      getJson<CommandersPayload>("/api/players/me/commanders", token),
    ]);
    return { profile: profileResult, commanders: commandersResult };
  }, []);

  const apply = useCallback((reads: Reads) => {
    if (reads.profile.ok) {
      setProfile(reads.profile.data.player);
      setProfileError(null);
    } else {
      setProfile(null);
      setProfileError({ code: reads.profile.code, message: reads.profile.message, bootstrap: reads.profile.bootstrap });
    }

    if (reads.commanders.ok) {
      setCommanders(reads.commanders.data);
      setCommandersError(null);
    } else {
      setCommanders(null);
      setCommandersError({ code: reads.commanders.code, message: reads.commanders.message });
    }
  }, []);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    setBusy(true);
    try {
      if (!token) {
        setProfile(null);
        setProfileError({ code: "UNAUTHORIZED", message: "Sign in to open the commanders gallery." });
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
            setProfileError({ code: "BOOTSTRAP_FAILED", message: created.message });
            setCommanders(null);
            setCommandersError(null);
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
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [ready, authenticated, load]);

  const classes = useMemo(() => buildGalleryClasses(catalog), [catalog]);
  const genesis = useMemo(() => {
    if (commandersError) return genesisFromError(commandersError.code);
    if (!commanders) return genesisFromError("REQUEST_FAILED");
    return parseGenesisCatalog(commanders, catalog);
  }, [commanders, commandersError, catalog]);

  const selected = useMemo(() => {
    const chosen = resolveGallerySelection(selectedKey, classes, genesis);
    if (chosen) return chosen;
    return resolveGallerySelection(defaultSelectionKey(classes), classes, genesis);
  }, [selectedKey, classes, genesis]);

  const featured = useMemo(() => {
    const choice = selectionChoice(selected);
    if (!choice) return null;
    return resolveCommander(catalog, choice, galleryEligibility(classes, genesis));
  }, [catalog, selected, classes, genesis]);

  const player: LobbyPlayer | null = useMemo(() => (profile ? resolvePlayer(profile) : null), [profile]);

  const notices = useMemo(() => {
    const list: LobbyNotice[] = [];
    if (profileError) list.push(galleryProfileNotice(profileError));
    if (commandersError) {
      const notice = eligibilityNotice(commandersError);
      if (notice && !profileError) list.push(notice);
    }
    return list;
  }, [profileError, commandersError]);

  const loaded = authenticated && sessionKey !== null && loadedFor === sessionKey;

  const phase: CommandersPhase = !ready
    ? "booting"
    : !authenticated
      ? "login"
      : !loaded
        ? "booting"
        : profileError || !profile
          ? "profile"
          : "ready";

  const status = useMemo(() => {
    if (phase !== "ready") return "";
    const viewed = selected?.classItem?.className ?? selected?.genesis?.className ?? "a commander";
    return `Commanders gallery loaded. Viewing ${viewed}.`;
  }, [phase, selected]);

  const onSignIn = useCallback(() => {
    void login();
  }, [login]);

  const onSignOut = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <CommandersView
      phase={phase}
      player={player}
      classes={classes}
      genesis={genesis}
      selected={selected}
      featured={featured}
      notices={notices}
      busy={busy}
      calm={calm}
      status={status}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
      onRefresh={() => void load()}
      onSelect={setSelectedKey}
    />
  );
}

export default function CommandersScreen() {
  return <CommandersShell />;
}
