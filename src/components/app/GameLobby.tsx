"use client";

// Authenticated lobby container (A1).
//
// This file owns the session and the network. It never renders game panels
// itself: it reads the real player, loadout and commander endpoints, turns
// them into plain props and hands them to LobbyView. The view stays free of
// tokens, fetch calls and Privy, so it can also be rendered from a preview.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import LobbyView from "./LobbyView";
import { sessionNotice } from "./feedback-model";
import { isPublicBattleAvailable } from "./battle-availability";
import { useLobbyCatalog } from "./catalog-context";
import {
  resolveCommander,
  resolveDeck,
  resolvePlayer,
  toEligibility,
  type CommandersPayload,
  type LoadoutPayload,
  type ProfilePayload,
} from "./lobby-model";
import type { LobbyCommander, LobbyDeck, LobbyNotice, LobbyPlayer, LobbyPhase } from "./lobby-types";
import { useMedia, useSaveData } from "@/components/site/use-media";

const ENABLED = isPublicBattleAvailable();

interface ApiError {
  code: string;
  message: string;
  /** Present on a 404 that means the verified identity has no player row. */
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
    return { ok: false, code: "NETWORK", message: "The lobby could not reach the server." };
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
      bootstrap: body.error?.details?.bootstrap === true,
    };
  } catch {
    return { ok: false, code: "NETWORK", message: "The lobby could not reach the server." };
  }
}

function profileNotice(error: ApiError): LobbyNotice {
  if (error.code === "NOT_FOUND") {
    return {
      tone: "warn",
      text: "This sign-in has no player profile yet, so the lobby cannot open it.",
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
    return sessionNotice("open the lobby");
  }
  if (error.code === "FORBIDDEN") {
    return { tone: "error", text: error.message };
  }
  return { tone: "error", text: `Your profile could not be read. ${error.message}` };
}

function loadoutNotice(error: ApiError): LobbyNotice {
  if (error.code === "FORBIDDEN") {
    return {
      tone: "warn",
      text: "Your saved deck unlocks once your profile setup is complete.",
      action: { label: "Finish profile setup", href: "/dev/onboarding" },
    };
  }
  if (error.code === "INTERNAL_ERROR") {
    return {
      tone: "warn",
      text: "The deck service is not available right now, so no saved deck can be shown here.",
    };
  }
  if (error.code === "UNAUTHORIZED") {
    return sessionNotice("open the lobby");
  }
  return { tone: "error", text: `Your saved deck could not be read. ${error.message}` };
}

interface Reads {
  /** GET /api/players/me nests the profile under data.player. */
  profile: Result<{ player: ProfilePayload }>;
  loadout: Result<LoadoutPayload>;
  commanders: Result<CommandersPayload>;
}

function LobbyShell() {
  const catalog = useLobbyCatalog();
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [profileError, setProfileError] = useState<ApiError | null>(null);
  const [loadout, setLoadout] = useState<LoadoutPayload | null>(null);
  const [loadoutError, setLoadoutError] = useState<ApiError | null>(null);
  const [commanders, setCommanders] = useState<CommandersPayload | null>(null);
  const [commandersError, setCommandersError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  /** The Privy user the current reads belong to. The lobby is only "loaded"
   *  when the finished reads belong to the session that is on screen, so a
   *  stale profile never leaks into a new sign-in. */
  const sessionKey = user?.id ?? null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** The bootstrap call is idempotent, but it still runs at most once a session. */
  const bootstrapTried = useRef(false);

  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const saveData = useSaveData();
  const calm = reducedMotion || saveData;

  const readAll = useCallback(async (token: string): Promise<Reads> => {
    const [profileResult, loadoutResult, commandersResult] = await Promise.all([
      // GET /api/players/me nests the profile under data.player, unlike the
      // loadout and commander reads which answer with their payload directly.
      getJson<{ player: ProfilePayload }>("/api/players/me", token),
      getJson<LoadoutPayload>("/api/players/me/loadout", token),
      getJson<CommandersPayload>("/api/players/me/commanders", token),
    ]);
    return { profile: profileResult, loadout: loadoutResult, commanders: commandersResult };
  }, []);

  const apply = useCallback((reads: Reads) => {
    if (reads.profile.ok) {
      setProfile(reads.profile.data.player);
      setProfileError(null);
    } else {
      setProfile(null);
      setProfileError({ code: reads.profile.code, message: reads.profile.message, bootstrap: reads.profile.bootstrap });
    }

    if (reads.loadout.ok) {
      setLoadout(reads.loadout.data);
      setLoadoutError(null);
    } else {
      setLoadout(null);
      setLoadoutError({ code: reads.loadout.code, message: reads.loadout.message });
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
    // The first await keeps every state update out of the synchronous part of
    // the call, so the loader can be started straight from an effect.
    const token = await getAccessToken();
    setBusy(true);
    try {
      if (!token) {
        setProfile(null);
        setProfileError({ code: "UNAUTHORIZED", message: "Sign in to open the lobby." });
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
            setProfileError({ code: "BOOTSTRAP_FAILED", message: created.message });
            setLoadout(null);
            setLoadoutError(null);
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
    // The reads start on the next tick, so the effect body itself never sets
    // state and the first render of a new session stays on the loading gate.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [ready, authenticated, load]);

  const player: LobbyPlayer | null = useMemo(() => (profile ? resolvePlayer(profile) : null), [profile]);

  const commander: LobbyCommander | null = useMemo(
    () => resolveCommander(catalog, loadout?.loadout?.commander ?? null, toEligibility(commanders)),
    [catalog, loadout, commanders]
  );

  const deckResult = useMemo(
    () => resolveDeck(catalog, loadout?.loadout?.cards ?? null, commander),
    [catalog, loadout, commander]
  );
  const deck: LobbyDeck | null = useMemo(
    () =>
      deckResult.deck
        ? {
            ...deckResult.deck,
            revision: loadout?.loadout?.revision ?? null,
            updatedAt: loadout?.loadout?.updatedAt ?? null,
          }
        : null,
    [deckResult.deck, loadout?.loadout?.revision, loadout?.loadout?.updatedAt]
  );

  const notices = useMemo(() => {
    const list: LobbyNotice[] = [];
    if (profileError) list.push(profileNotice(profileError));
    if (loadoutError) list.push(loadoutNotice(loadoutError));
    if (!loadoutError && loadout && !loadout.loadout && !loadout.invalidSaved) {
      list.push({ tone: "info", text: "No deck is saved to your account yet." });
    }
    if (loadout?.invalidSaved) {
      list.push({
        tone: "warn",
        text: `The saved deck is no longer valid and cannot be used: ${loadout.invalidSaved.reason}.`,
      });
    }
    if (deckResult.notice) list.push(deckResult.notice);
    if (commandersError) {
      list.push({ tone: "warn", text: `Commander eligibility could not be read. ${commandersError.message}` });
    }
    if (profile && !profile.onboarding.complete) {
      list.push({
        tone: "info",
        text: "Your profile setup is not finished, so the saved deck and some commander features stay locked.",
        action: { label: "Finish profile setup", href: "/dev/onboarding" },
      });
    }
    return list;
  }, [profileError, loadoutError, loadout, deckResult.notice, commandersError, profile]);

  const loaded = authenticated && sessionKey !== null && loadedFor === sessionKey;

  const deckEmpty = useMemo(() => {
    if (loadoutError) {
      if (loadoutError.code === "INTERNAL_ERROR") {
        return {
          title: "Deck unavailable",
          body: "The deck service is not available in this build yet, so the lobby cannot read a saved deck. Nothing is shown in its place.",
        };
      }
      if (loadoutError.code === "FORBIDDEN") {
        return {
          title: "Deck locked",
          body: "Your saved deck unlocks once your profile setup is complete.",
        };
      }
      return {
        title: "Deck unavailable",
        body: `Your saved deck could not be read. ${loadoutError.message}`,
      };
    }
    if (loadout?.invalidSaved) {
      return {
        title: "Saved deck is out of date",
        body: "The deck that was saved no longer matches the current ruleset, so it cannot be shown. Pick a new deck to play.",
      };
    }
    return undefined;
  }, [loadoutError, loadout?.invalidSaved]);

  const phase: LobbyPhase = !ready
    ? "booting"
    : !authenticated
      ? "login"
      : !loaded
        ? "booting"
        : profileError || !profile
          ? "profile"
          : "ready";

  const status = useMemo(() => {
    const parts: string[] = [];
    parts.push(ENABLED ? "Battle entry is open." : "Battle entry is closed in this build.");
    if (phase === "ready") {
      parts.push(
        deck && deck.cards.length > 0
          ? `Deck loaded with ${deck.cards.length} cards.`
          : "No deck is saved yet."
      );
      parts.push(
        commander?.resolved
          ? `Commander class: ${commander.className}.`
          : "Commander class unresolved, no class art is shown."
      );
    }
    if (busy) parts.push("Refreshing the lobby.");
    return parts.join(" ");
  }, [phase, deck, commander, busy]);

  const onSignIn = useCallback(() => {
    void login();
  }, [login]);

  const onSignOut = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <LobbyView
      phase={phase}
      player={player}
      commander={commander}
      deck={deck}
      deckEmpty={deckEmpty}
      notices={notices}
      battleEnabled={ENABLED}
      busy={busy}
      calm={calm}
      status={status}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
      onRefresh={() => void load()}
    />
  );
}

export default function GameLobby() {
  return <LobbyShell />;
}
