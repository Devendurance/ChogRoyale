"use client";

// Settings screen (A4.1).
//
// This file owns the session and the network. It reads the real player, the
// avatar catalog and the verified-wallet summary, then saves display name and
// avatar through the existing POST /api/players/onboard flow. The view stays
// free of tokens, fetch calls and Privy.
//
// Nothing here invents a preference or a second persistence path. A save is
// only reported as saved after the server confirms it, and no wallet address
// or Privy identifier ever reaches the view.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import SettingsView from "./SettingsView";
import { useMedia, useSaveData } from "@/components/site/use-media";
import { formatMemberSince } from "./profile-model";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import {
  avatarChoiceById,
  avatarsNote,
  checkDisplayName,
  isNameChanged,
  parseAvatarCatalog,
  readStateForError,
  saveErrorMessage,
  settingsNoticeFor,
  summarizeWallets,
  walletsNote,
  type ApiError,
} from "./settings-model";
import type { AvatarCatalog, SettingsPhase, SettingsSaveStatus, WalletSummary } from "./settings-types";
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
    return { ok: false, code: "NETWORK", message: "Settings could not reach the server." };
  }
}

async function postJson<T>(path: string, token: string, body: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
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
    return { ok: false, code: "NETWORK", message: "Settings could not reach the server." };
  }
}

/** The onboard route answers with the raw safe player plus reconciled onboarding. */
interface OnboardPayload {
  player: {
    displayName: string | null;
    avatarId: string | null;
    accountStatus?: string;
    onboardingStatus?: string;
  };
  onboarding?: ProfilePayload["onboarding"];
}

interface Reads {
  /** GET /api/players/me nests the profile under data.player. */
  profile: Result<{ player: ProfilePayload }>;
  avatars: Result<{ avatars: unknown }>;
  wallets: Result<{ wallets: unknown }>;
}

interface Draft {
  name: string;
  avatarId: string | null;
}

function SettingsShell() {
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [profileError, setProfileError] = useState<ApiError | null>(null);
  const [avatarCatalog, setAvatarCatalog] = useState<AvatarCatalog | null>(null);
  const [avatarsError, setAvatarsError] = useState<ApiError | null>(null);
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null);
  const [walletsError, setWalletsError] = useState<ApiError | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [save, setSave] = useState<SettingsSaveStatus>({ state: "idle", message: null });
  const [busy, setBusy] = useState(false);

  /** The Privy user the finished reads belong to. A stale profile never leaks
   *  into a new sign-in. */
  const sessionKey = user?.id ?? null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** The bootstrap call is idempotent, but it still runs at most once a session. */
  const bootstrapTried = useRef(false);
  /** Draft kept outside render state so a reload never depends on a keystroke. */
  const draftRef = useRef<Draft | null>(null);
  const draftOwner = useRef<string | null>(null);

  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const saveData = useSaveData();
  const calm = reducedMotion || saveData;

  const readAll = useCallback(async (token: string): Promise<Reads> => {
    const [profileResult, avatarsResult, walletsResult] = await Promise.all([
      getJson<{ player: ProfilePayload }>("/api/players/me", token),
      getJson<{ avatars: unknown }>("/api/players/avatars", token),
      getJson<{ wallets: unknown }>("/api/players/me/wallets", token),
    ]);
    return { profile: profileResult, avatars: avatarsResult, wallets: walletsResult };
  }, []);

  const apply = useCallback((reads: Reads) => {
    let loadedPlayer: ProfilePayload | null = null;

    if (reads.profile.ok) {
      loadedPlayer = reads.profile.data.player;
      setProfile(loadedPlayer);
      setProfileError(null);
    } else {
      setProfile(null);
      setProfileError({
        code: reads.profile.code,
        message: reads.profile.message,
        bootstrap: reads.profile.bootstrap,
      });
    }

    if (reads.avatars.ok) {
      setAvatarCatalog(parseAvatarCatalog(reads.avatars.data));
      setAvatarsError(null);
    } else {
      setAvatarCatalog(null);
      setAvatarsError({ code: reads.avatars.code, message: reads.avatars.message });
    }

    if (reads.wallets.ok) {
      setWalletSummary(summarizeWallets(reads.wallets.data));
      setWalletsError(null);
    } else {
      setWalletSummary(null);
      setWalletsError({ code: reads.wallets.code, message: reads.wallets.message });
    }

    // A draft only starts from a confirmed profile, and only when this session
    // does not already have one. A manual refresh therefore keeps live edits.
    if (loadedPlayer && draftRef.current === null) {
      const next: Draft = { name: loadedPlayer.displayName ?? "", avatarId: loadedPlayer.avatarId ?? null };
      draftRef.current = next;
      setDraft(next);
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
        setProfileError({ code: "UNAUTHORIZED", message: "Sign in to open settings." });
        return;
      }

      if (draftOwner.current !== sessionKey) {
        draftOwner.current = sessionKey;
        draftRef.current = null;
        setDraft(null);
        setSave({ state: "idle", message: null });
      }

      let reads = await readAll(token);

      // A verified identity with no player row yet: the bootstrap endpoint is
      // the documented first-login entry point, so provision and read again.
      if (!reads.profile.ok && reads.profile.code === "NOT_FOUND" && reads.profile.bootstrap) {
        if (!bootstrapTried.current) {
          bootstrapTried.current = true;
          const created = await postJson<unknown>("/api/auth/bootstrap", token, {});
          if (created.ok) {
            reads = await readAll(token);
          } else {
            setProfile(null);
            setProfileError({ code: "BOOTSTRAP_FAILED", message: created.message });
            setAvatarCatalog(null);
            setAvatarsError(null);
            setWalletSummary(null);
            setWalletsError(null);
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

  const avatarState = avatarsError ? readStateForError(avatarsError.code) : (avatarCatalog?.state ?? "unavailable");
  const avatarChoices = useMemo(() => avatarCatalog?.choices ?? [], [avatarCatalog]);

  const wallets = useMemo<WalletSummary>(() => {
    if (walletsError) {
      return { ...summarizeWallets(null), state: readStateForError(walletsError.code) };
    }
    return walletSummary ?? summarizeWallets(null);
  }, [walletSummary, walletsError]);

  const nameChanged = useMemo(
    () => (draft && profile ? isNameChanged(draft.name, profile.displayName) : false),
    [draft, profile]
  );
  const avatarChanged = useMemo(
    () => (draft && profile ? draft.avatarId !== (profile.avatarId ?? null) : false),
    [draft, profile]
  );

  const nameCheck = useMemo(
    () => (draft ? checkDisplayName(draft.name) : { ok: true as const, value: "" }),
    [draft]
  );
  const nameError = nameChanged && !nameCheck.ok ? nameCheck.message : null;

  const dirty = nameChanged || avatarChanged;
  const canSave =
    dirty &&
    !busy &&
    save.state !== "saving" &&
    (!nameChanged || nameCheck.ok) &&
    (!avatarChanged || avatarState === "ready");

  const notices = useMemo(() => {
    const list: LobbyNotice[] = [];
    if (profileError) list.push(settingsNoticeFor(profileError));
    if (avatarsError?.code === "UNAUTHORIZED" || walletsError?.code === "UNAUTHORIZED") {
      if (!profileError) {
        list.push({ tone: "error", text: "Your session is no longer valid. Sign in again to open settings." });
      }
    }
    if (profile && !profile.onboarding.complete) {
      list.push({
        tone: "info",
        text: "Your profile setup is not finished, so your avatar and wallet details stay locked until it is.",
        action: { label: "Finish profile setup", href: "/dev/onboarding" },
      });
    }
    return list;
  }, [profileError, avatarsError, walletsError, profile]);

  const loaded = authenticated && sessionKey !== null && loadedFor === sessionKey;

  const phase: SettingsPhase = !ready
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
    const parts: string[] = ["Settings loaded."];
    if (wallets.state === "ready") {
      parts.push(`${wallets.verified} of ${wallets.total} linked wallets verified.`);
    }
    if (busy) parts.push("Refreshing settings.");
    return parts.join(" ");
  }, [phase, wallets, busy]);

  const onNameChange = useCallback((value: string) => {
    const current = draftRef.current ?? { name: "", avatarId: null };
    const next: Draft = { name: value, avatarId: current.avatarId };
    draftRef.current = next;
    setDraft(next);
    setSave((state) => (state.state === "saving" ? state : { state: "idle", message: null }));
  }, []);

  const onAvatarSelect = useCallback((id: string) => {
    const current = draftRef.current ?? { name: "", avatarId: null };
    const next: Draft = { name: current.name, avatarId: id };
    draftRef.current = next;
    setDraft(next);
    setSave((state) => (state.state === "saving" ? state : { state: "idle", message: null }));
  }, []);

  const onSave = useCallback(async () => {
    if (!draft || !profile || save.state === "saving") return;

    const nameCheckNow = checkDisplayName(draft.name);
    const nameIsChanged = isNameChanged(draft.name, profile.displayName);
    const avatarIsChanged = draft.avatarId !== (profile.avatarId ?? null);
    if (!nameIsChanged && !avatarIsChanged) return;

    if (nameIsChanged && !nameCheckNow.ok) {
      setSave({ state: "error", message: nameCheckNow.message });
      return;
    }
    if (avatarIsChanged && !draft.avatarId) {
      setSave({ state: "error", message: "Choose an avatar before saving." });
      return;
    }
    if (avatarIsChanged && !avatarChoiceById(avatarChoices, draft.avatarId)) {
      setSave({ state: "error", message: "That avatar is not in the current catalog." });
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setSave({
        state: "error",
        message: "Your session is no longer valid, so nothing was saved. Sign in again and retry.",
      });
      return;
    }

    const body: { displayName?: string; avatarId?: string } = {};
    if (nameIsChanged && nameCheckNow.ok) body.displayName = nameCheckNow.value;
    if (avatarIsChanged && draft.avatarId) body.avatarId = draft.avatarId;

    setSave({ state: "saving", message: null });
    const result = await postJson<OnboardPayload>("/api/players/onboard", token, body);

    if (!result.ok) {
      setSave({ state: "error", message: saveErrorMessage(result.code, result.message) });
      return;
    }

    const saved = result.data?.player;
    if (!saved || typeof saved !== "object") {
      // A confirmation without the saved player is not enough to claim a save.
      setSave({
        state: "error",
        message: "The server accepted the request without returning your profile, so nothing is claimed as saved.",
      });
      return;
    }

    // The POST confirms the write, but GET /api/players/me stays authoritative
    // for the enriched avatar and the wallet summary. Reconcile from that read
    // instead of assuming the write response carries those fields.
    const refreshed = await readAll(token);
    let confirmed: Draft;
    if (refreshed.profile.ok) {
      const authoritative = refreshed.profile.data.player;
      confirmed = {
        name: authoritative.displayName ?? "",
        avatarId: authoritative.avatarId ?? null,
      };
      // Let apply() take the loaded player, then keep the draft on the same
      // authoritative values it just read.
      draftRef.current = null;
      apply(refreshed);
    } else {
      confirmed = { name: saved.displayName ?? "", avatarId: saved.avatarId ?? null };
      setProfile((prev) => {
        if (!prev) return prev;
        const chosen = avatarChoiceById(avatarChoices, confirmed.avatarId);
        return {
          ...prev,
          displayName: confirmed.name.length > 0 ? confirmed.name : null,
          avatarId: confirmed.avatarId,
          accountStatus: saved.accountStatus ?? prev.accountStatus,
          onboardingStatus: saved.onboardingStatus ?? prev.onboardingStatus,
          avatar: chosen ? { id: chosen.id, name: chosen.name, assetUrl: chosen.assetUrl } : prev.avatar,
          onboarding: result.data.onboarding ?? prev.onboarding,
        };
      });
    }

    draftRef.current = confirmed;
    setDraft(confirmed);
    setSave({ state: "saved", message: null });
  }, [draft, profile, save.state, avatarChoices, getAccessToken, apply, readAll]);

  const onSignIn = useCallback(() => {
    void login();
  }, [login]);

  const onSignOut = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <SettingsView
      phase={phase}
      player={player}
      memberSince={memberSince}
      avatarCatalog={{ state: avatarState, choices: avatarChoices }}
      avatarsNote={avatarsNote(avatarState)}
      wallets={wallets}
      walletsNote={walletsNote(wallets.state)}
      draftName={draft?.name ?? ""}
      draftAvatarId={draft?.avatarId ?? null}
      nameError={nameError}
      save={save}
      dirty={dirty}
      canSave={canSave}
      notices={notices}
      busy={busy}
      calm={calm}
      status={status}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
      onRefresh={() => void load()}
      onNameChange={onNameChange}
      onAvatarSelect={onAvatarSelect}
      onSave={() => void onSave()}
    />
  );
}

export default function SettingsScreen() {
  return <SettingsShell />;
}
