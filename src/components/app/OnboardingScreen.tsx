// Player-facing onboarding flow (launch). One Privy provider only: the
// shared /app layout owns it, this screen only reads the session.
//
// Server is authoritative at every step: bootstrap on a genuinely missing
// player, onboard API for username/display/avatar, wallet sync for verified
// linkage. Entry to /app happens only when onboarding.complete === true.
"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import Icon from "./icons";
import type { LobbyPlayer } from "./lobby-types";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import { deriveStep, onboardErrorMessage, usernameHint, type OnboardingStep } from "./onboarding-model";

interface AvatarChoice {
  id: string;
  name: string;
  assetUrl: string;
}

type Phase = "booting" | "login" | "working" | "ready" | "failed";

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export default function OnboardingScreen() {
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const router = useRouter();
  const sessionKey = user?.id ?? null;

  const [phase, setPhase] = useState<Phase>("booting");
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [avatars, setAvatars] = useState<AvatarChoice[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftDisplay, setDraftDisplay] = useState("");
  const [draftAvatar, setDraftAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "warn" | "error" | "ok"; text: string } | null>(null);
  const loadedFor = useRef<string | null>(null);

  const readProfile = useCallback(async (token: string): Promise<ProfilePayload | null> => {
    const res = await fetch("/api/players/me", { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as {
      success: boolean;
      data?: { player: ProfilePayload };
      error?: { code?: string; message?: string; details?: { bootstrap?: boolean } };
    };
    if (body.success && body.data) return body.data.player;
    if (body.error?.code === "NOT_FOUND" && body.error?.details?.bootstrap === true) {
      const created = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      });
      const createdBody = (await created.json()) as { success: boolean };
      if (!createdBody.success) throw new Error("BOOTSTRAP_FAILED");
      const retry = await fetch("/api/players/me", { headers: { authorization: `Bearer ${token}` } });
      const retryBody = (await retry.json()) as { success: boolean; data?: { player: ProfilePayload } };
      if (retryBody.success && retryBody.data) return retryBody.data.player;
      throw new Error("BOOTSTRAP_FAILED");
    }
    const code = body.error?.code ?? "REQUEST_FAILED";
    throw new Error(code);
  }, []);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setPhase("login");
      return;
    }
    setPhase("working");
    try {
      const [player, catalog] = await Promise.all([
        readProfile(token),
        fetch("/api/players/avatars").then(async (r) => {
          const b = (await r.json()) as { success: boolean; data?: { avatars: AvatarChoice[] } };
          return b.success && b.data ? b.data.avatars : [];
        }),
      ]);
      setProfile(player);
      setAvatars(catalog);
      if (player && player.username && draftName === "") setDraftName(player.username);
      if (player && player.displayName && draftDisplay === "") setDraftDisplay(player.displayName);
      if (player && player.avatarId && draftAvatar === null) setDraftAvatar(player.avatarId);
      setNotice(null);
      setPhase("ready");
    } catch (e) {
      setNotice({
        tone: "error",
        text: onboardErrorMessage(e instanceof Error ? e.message : "REQUEST_FAILED", "Setup could not load. Try again."),
      });
      setPhase("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken, readProfile]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      if (!authenticated || !sessionKey) {
        if (cancelled) return;
        loadedFor.current = null;
        setProfile(null);
        setPhase("login");
        return;
      }
      if (loadedFor.current === sessionKey) return;
      loadedFor.current = sessionKey;
      if (cancelled) return;
      setDraftName("");
      setDraftDisplay("");
      setDraftAvatar(null);
      setNotice(null);
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, sessionKey, load]);

  const mutate = useCallback(
    async (label: string, body: Record<string, string>) => {
      const token = await getAccessToken();
      if (!token) {
        setNotice({ tone: "error", text: "Your session expired. Sign in again." });
        return;
      }
      setBusy(label);
      try {
        const res = await fetch("/api/players/onboard", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = (await res.json()) as { success: boolean; error?: { code?: string; message?: string } };
        if (!out.success) throw new Error(out.error?.code ?? "REQUEST_FAILED");
        const player = await readProfile(token);
        if (player) {
          setProfile(player);
          setNotice({ tone: "ok", text: "Saved." });
        } else {
          setNotice({ tone: "error", text: "Saving finished but the profile could not be read. Try again." });
        }
      } catch (e) {
        setNotice({
          tone: "error",
          text: onboardErrorMessage(e instanceof Error ? e.message : "REQUEST_FAILED", "Saving failed. Try again."),
        });
      } finally {
        setBusy(null);
      }
    },
    [getAccessToken, readProfile]
  );

  const syncWallets = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setNotice({ tone: "error", text: "Your session expired. Sign in again." });
      return;
    }
    setBusy("wallet");
    try {
      await fetch("/api/players/me/wallets/sync", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      });
      const player = await readProfile(token);
      if (!player) {
        setNotice({ tone: "error", text: "Wallet sync finished but the profile could not be read. Try again." });
        return;
      }
      setProfile(player);
      const count = Array.isArray(player.wallets) ? player.wallets.filter((w) => w.verifiedAt !== null).length : 0;
      setNotice(
        count > 0
          ? { tone: "ok", text: "Wallet verified." }
          : { tone: "warn", text: "No verified wallet yet. If you just linked one, wait a moment and try again." }
      );
    } catch {
      setNotice({ tone: "error", text: "Wallet verification could not reach the server. Try again." });
    } finally {
      setBusy(null);
    }
  }, [getAccessToken, readProfile]);

  const complete = profile?.onboarding.complete === true;

  useEffect(() => {
    if (phase === "ready" && complete) router.replace("/app");
  }, [phase, complete, router]);

  const player: LobbyPlayer | null = profile ? resolvePlayer(profile) : null;
  const verifiedWallets = Array.isArray(profile?.wallets) ? profile!.wallets.filter((w) => w.verifiedAt !== null) : [];
  const step: OnboardingStep = profile
    ? deriveStep(profile.onboarding.hasUsername, profile.onboarding.hasAvatar, verifiedWallets.length)
    : "username";
  const stepIndex = step === "username" ? 1 : step === "avatar" ? 2 : 3;
  const nameError = usernameHint(draftName);

  if (!ready || phase === "booting" || phase === "working" || (phase === "ready" && complete)) {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate"><span className="app-gate__pulse" aria-hidden="true" /><h1 className="app-gate__title">Opening setup</h1><p className="app-gate__lead">Reading your adventurer record.</p></div>
        </div>
      </main>
    );
  }

  if (!authenticated || phase === "login") {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate app-rise">
            <span className="app-gate__mark" aria-hidden="true"><Icon name="swords" size={34} /></span>
            <h1 className="app-gate__title">Create your adventurer</h1>
            <p className="app-gate__lead">Sign in to start your Chog Royale profile. No Chog NFT required.</p>
            <button type="button" className="app-btn app-btn--battle" onClick={() => login()}>Log in with Privy</button>
          </div>
        </div>
      </main>
    );
  }

  if (phase === "failed") {
    return (
      <>
        <AppHud player={player} onSignOut={() => void logout()} />
        <main className="app-stage app-stage--gate">
          <div className="app-column app-column--gate">
            <div className="app-panel app-gate">
              <h1 className="app-gate__title">Setup is unavailable</h1>
              <p className="app-gate__lead">{notice?.text ?? "Setup could not load."}</p>
              <button type="button" className="app-btn app-btn--battle" onClick={() => void load()} disabled={busy !== null}>Try again</button>
            </div>
          </div>
        </main>
        <AppNav activeId="lobby" />
      </>
    );
  }

  return (
    <>
      <AppHud player={player} onSignOut={() => void logout()} />
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate app-rise">
            <span className="app-gate__mark" aria-hidden="true"><Icon name="swords" size={34} /></span>
            <h1 className="app-gate__title">Create your adventurer</h1>
            <p className="app-gate__lead">Step {stepIndex} of 3: {step === "username" ? "choose a username" : step === "avatar" ? "choose an avatar" : "verify your wallet"}.</p>
          </div>

          {notice && (
            <div className={`app-panel app-notice app-notice--${notice.tone}`} role="status">
              <p className="app-notice__text">{notice.text}</p>
            </div>
          )}

          {step === "username" && (
            <div className="app-panel app-gate">
              <h2 className="app-gate__title">Choose your username</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (nameError) {
                    setNotice({ tone: "warn", text: nameError });
                    return;
                  }
                  const body: Record<string, string> = { username: draftName.trim() };
                  if (draftDisplay.trim().length > 0) body.displayName = draftDisplay.trim().slice(0, 32);
                  void mutate("username", body);
                }}
              >
                <div className="app-settings-field">
                  <label className="app-settings-field__label" htmlFor="app-onboard-username">Username</label>
                  <input
                    id="app-onboard-username"
                    className={`app-settings-input${nameError && draftName.trim().length > 0 ? " app-settings-input--error" : ""}`}
                    type="text"
                    value={draftName}
                    maxLength={20}
                    autoComplete="nickname"
                    placeholder="hero_01"
                    disabled={busy !== null}
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                  <p className="app-settings-field__hint">3-20 characters: lowercase letters, numbers, underscores. Permanent once claimed.</p>
                </div>
                <div className="app-settings-field">
                  <label className="app-settings-field__label" htmlFor="app-onboard-display">Display name (optional)</label>
                  <input
                    id="app-onboard-display"
                    className="app-settings-input"
                    type="text"
                    value={draftDisplay}
                    maxLength={32}
                    autoComplete="nickname"
                    placeholder="Hero"
                    disabled={busy !== null}
                    onChange={(event) => setDraftDisplay(event.target.value)}
                  />
                </div>
                <button type="submit" className="app-btn app-btn--battle" disabled={busy !== null}>
                  {busy ? "Saving" : "Claim username"}
                </button>
              </form>
            </div>
          )}

          {step === "avatar" && (
            <div className="app-panel app-gate">
              <h2 className="app-gate__title">Choose your avatar</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!draftAvatar) {
                    setNotice({ tone: "warn", text: "Pick an avatar to continue." });
                    return;
                  }
                  void mutate("avatar", { avatarId: draftAvatar });
                }}
              >
                <fieldset className="app-settings-avatars" disabled={busy !== null || avatars.length === 0}>
                  <legend className="app-settings-field__label">Avatar</legend>
                  {avatars.length > 0 ? (
                    <div className="app-avatar-grid">
                      {avatars.map((choice) => {
                        const selected = choice.id === (draftAvatar ?? profile?.avatarId ?? null);
                        return (
                          <button
                            key={choice.id}
                            type="button"
                            className={`app-avatar-choice${selected ? " app-avatar-choice--active" : ""}`}
                            aria-pressed={selected}
                            onClick={() => setDraftAvatar(choice.id)}
                          >
                            <Image src={choice.assetUrl} alt="" width={44} height={44} className="app-avatar-choice__img" unoptimized />
                            <span className="app-avatar-choice__name">{choice.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="app-profile-note">The avatar picker is not available right now.</p>
                  )}
                </fieldset>
                <button type="submit" className="app-btn app-btn--battle" disabled={busy !== null}>
                  {busy ? "Saving" : "Choose avatar"}
                </button>
              </form>
            </div>
          )}

          {step === "wallet" && (
            <div className="app-panel app-gate">
              <h2 className="app-gate__title">Verify your wallet</h2>
              <p className="app-gate__lead">
                {wallets.length > 0
                  ? `Session wallets: ${wallets.map((w) => shortAddress(w.address)).join(", ")}.`
                  : "No session wallet detected yet."}{" "}
                {verifiedWallets.length > 0
                  ? `${verifiedWallets.length} verified.`
                  : "Press verify so the server can confirm linkage. Embedded wallets count; no NFT required."}
              </p>
              <button type="button" className="app-btn app-btn--battle" disabled={busy !== null} onClick={() => void syncWallets()}>
                {busy === "wallet" ? "Verifying" : "Verify wallet connection"}
              </button>
            </div>
          )}
        </div>
      </main>
      <AppNav activeId="lobby" />
    </>
  );
}
