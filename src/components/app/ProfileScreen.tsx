"use client";

// Player profile screen (A3.1).
//
// This file owns the session and the network. It reads the real player,
// loadout, commander and stats endpoints, turns them into plain props and
// hands them to ProfileView. The view stays free of tokens, fetch calls and
// Privy, so it can also be rendered from a preview.
//
// Nothing here claims NFT ownership or a completed save. The commander stage
// carries the class-art caveat and the deck panel only reports what the
// account endpoints returned.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import ProfileView from "./ProfileView";
import { sessionNotice } from "./feedback-model";
import { useLobbyCatalog } from "./catalog-context";
import { formatMemberSince, resolveRecord, type StatsPayloadLike } from "./profile-model";
import {
  resolveCommander,
  resolveDeck,
  resolvePlayer,
  toEligibility,
  type CommandersPayload,
  type LoadoutPayload,
  type ProfilePayload,
} from "./lobby-model";
import type { LobbyCommander, LobbyDeck, LobbyNotice, LobbyPlayer } from "./lobby-types";
import type { ProfileDeckState, ProfilePhase } from "./profile-types";
import { useMedia, useSaveData } from "@/components/site/use-media";

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
    return { ok: false, code: "NETWORK", message: "The profile could not reach the server." };
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
    return { ok: false, code: "NETWORK", message: "The profile could not reach the server." };
  }
}

function profileNotice(error: ApiError): LobbyNotice {
  if (error.code === "NOT_FOUND") {
    return {
      tone: "warn",
      text: "This sign-in has no player profile yet, so the profile screen cannot open it.",
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
    return sessionNotice("open your profile");
  }
  if (error.code === "FORBIDDEN") {
    return { tone: "error", text: error.message };
  }
  return { tone: "error", text: `Your profile could not be read. ${error.message}` };
}

interface Reads {
  /** GET /api/players/me nests the profile under data.player. */
  profile: Result<{ player: ProfilePayload }>;
  loadout: Result<LoadoutPayload>;
  commanders: Result<CommandersPayload>;
  stats: Result<StatsPayloadLike>;
}

/** Why the deck panel has no deck, in the order the reads can fail. */
function deckStateOf(loadout: LoadoutPayload | null, error: ApiError | null): ProfileDeckState {
  if (error) return error.code === "FORBIDDEN" ? "locked" : "unavailable";
  // No payload at all only happens before the reads land or after a failure,
  // so it is reported as unavailable rather than as an empty account.
  if (!loadout) return "unavailable";
  if (loadout.invalidSaved) return "invalid";
  if (loadout.loadout) return "ready";
  return "none";
}

/** Panel copy per state. The notices carry the reason, this states the fact. */
function deckNoteFor(state: ProfileDeckState): string | null {
  switch (state) {
    case "ready":
      return null;
    case "none":
      return "No deck is saved to your account yet.";
    case "locked":
      return "Your deck is locked until your profile setup is complete.";
    case "invalid":
      return "The saved deck is out of date and is not shown.";
    default:
      return "The deck service could not be read, so no saved deck is shown.";
  }
}

function ProfileShell() {
  const catalog = useLobbyCatalog();
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [profileError, setProfileError] = useState<ApiError | null>(null);
  const [loadout, setLoadout] = useState<LoadoutPayload | null>(null);
  const [loadoutError, setLoadoutError] = useState<ApiError | null>(null);
  const [commanders, setCommanders] = useState<CommandersPayload | null>(null);
  const [commandersError, setCommandersError] = useState<ApiError | null>(null);
  const [stats, setStats] = useState<StatsPayloadLike | null>(null);
  const [statsError, setStatsError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  /** The Privy user the current reads belong to. The screen is only "loaded"
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
    const [profileResult, loadoutResult, commandersResult, statsResult] = await Promise.all([
      // GET /api/players/me nests the profile under data.player, unlike the
      // loadout, commander and stats reads which answer with their payload
      // directly.
      getJson<{ player: ProfilePayload }>("/api/players/me", token),
      getJson<LoadoutPayload>("/api/players/me/loadout", token),
      getJson<CommandersPayload>("/api/players/me/commanders", token),
      getJson<StatsPayloadLike>("/api/players/me/stats", token),
    ]);
    return {
      profile: profileResult,
      loadout: loadoutResult,
      commanders: commandersResult,
      stats: statsResult,
    };
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

    if (reads.stats.ok) {
      setStats(reads.stats.data);
      setStatsError(null);
    } else {
      setStats(null);
      setStatsError({ code: reads.stats.code, message: reads.stats.message });
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
        setProfileError({ code: "UNAUTHORIZED", message: "Sign in to open your profile." });
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
            setStats(null);
            setStatsError(null);
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

  const memberSince = useMemo(() => {
    const payload = profile as (ProfilePayload & { createdAt?: string | null }) | null;
    return formatMemberSince(payload?.createdAt ?? null);
  }, [profile]);

  const verifiedWallets = useMemo(() => {
    const wallets = Array.isArray(profile?.wallets) ? profile.wallets : [];
    // A wallet only counts once its verification timestamp is present. The
    // address itself is never read here and never reaches the view.
    return wallets.filter((w) => w?.verifiedAt != null).length;
  }, [profile]);

  const commander: LobbyCommander | null = useMemo(
    () => resolveCommander(catalog, loadout?.loadout?.commander ?? null, toEligibility(commanders)),
    [catalog, loadout, commanders]
  );

  const commanderStats = useMemo(
    () =>
      commander
        ? (catalog.commanders.find((c) => c.classId === commander.classId)?.stats ?? [])
        : [],
    [catalog, commander]
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

  const deckState = useMemo(() => deckStateOf(loadout, loadoutError), [loadout, loadoutError]);
  const deckNote = useMemo(() => {
    // The invalid case carries its reason here, so the panel states the whole
    // fact and no second notice repeats it.
    if (deckState === "invalid" && loadout?.invalidSaved) {
      return `The saved deck is no longer valid: ${loadout.invalidSaved.reason}.`;
    }
    return deckNoteFor(deckState);
  }, [deckState, loadout]);

  const record = useMemo(() => resolveRecord(stats), [stats]);
  const recordNote = useMemo(() => {
    if (!statsError) return null;
    // The setup notice already explains the locked case, so the record panel
    // only states the lock; every other failure is a plain unavailable read.
    return statsError.code === "FORBIDDEN"
      ? "Not available until profile setup is complete."
      : "The match record is not available right now.";
  }, [statsError]);

  const notices = useMemo(() => {
    const list: LobbyNotice[] = [];
    if (profileError) list.push(profileNotice(profileError));
    if (loadoutError?.code === "UNAUTHORIZED") {
      // A session problem is wider than the deck panel, so it is stated here.
      // Every other deck read failure and the setup lock are stated once, in
      // the deck panel itself.
      list.push(sessionNotice("open your profile"));
    }
    // A failed stats read is stated once, in the record panel. It is not
    // repeated here as a second service notice.
    if (commandersError) {
      list.push({ tone: "warn", text: `Commander eligibility could not be read. ${commandersError.message}` });
    }
    // Cards the current ruleset no longer knows are dropped from the deck
    // panel, so the drop is reported instead of passing silently.
    if (deckResult.notice) list.push(deckResult.notice);
    if (profile && !profile.onboarding.complete) {
      list.push({
        tone: "info",
        text: "Your profile setup is not finished, so your saved deck and some account details stay locked.",
        action: { label: "Finish profile setup", href: "/app/onboarding" },
      });
    }
    return list;
  }, [profileError, loadoutError, commandersError, deckResult.notice, profile]);

  const loaded = authenticated && sessionKey !== null && loadedFor === sessionKey;

  const phase: ProfilePhase = !ready
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
    if (phase === "ready") {
      parts.push(
        deck && deckState === "ready" ? `Deck loaded with ${deck.cards.length} cards.` : "No saved deck is on screen."
      );
      parts.push(
        commander?.resolved
          ? `Commander class: ${commander.className}.`
          : "Commander class unresolved, no class art is shown."
      );
      parts.push(
        record.state === "ready"
          ? `Verified record: ${record.total} matches.`
          : record.state === "empty"
            ? "No verified matches yet."
            : "The match record is not available."
      );
    }
    if (busy) parts.push("Refreshing your profile.");
    return parts.join(" ");
  }, [phase, deck, deckState, commander, record, busy]);

  const onSignIn = useCallback(() => {
    void login();
  }, [login]);

  const onSignOut = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <ProfileView
      phase={phase}
      player={player}
      memberSince={memberSince}
      verifiedWallets={verifiedWallets}
      commander={commander}
      commanderStats={commanderStats}
      deck={deck}
      deckState={deckState}
      deckNote={deckNote}
      record={record}
      recordNote={recordNote}
      notices={notices}
      busy={busy}
      calm={calm}
      status={status}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
      onRefresh={() => void load()}
    />
  );
}

export default function ProfileScreen() {
  return <ProfileShell />;
}
