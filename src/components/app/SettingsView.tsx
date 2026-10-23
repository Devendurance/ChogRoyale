"use client";

// The settings view (A4.1). Pure presentation: every value arrives as a plain
// prop, so this renders the same way from the authenticated container and from
// a static preview with sample data.
//
// The screen shows the real account only. It has no invented preferences, no
// extra toggles, and it never renders a wallet address or a Privy identifier.

import Image from "next/image";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import AppNotice from "./AppNotice";
import Icon from "./icons";
import { accountStatusLabel, onboardingLabel } from "./profile-model";
import { dedupeNotices } from "./feedback-model";
import { DISPLAY_NAME_MAX, saveStatusText } from "./settings-model";
import type { SettingsViewProps } from "./settings-types";

export default function SettingsView({
  phase,
  player,
  memberSince,
  avatarCatalog,
  avatarsNote,
  wallets,
  walletsNote,
  draftName,
  draftAvatarId,
  nameError,
  save,
  dirty,
  canSave,
  notices,
  busy,
  calm,
  status,
  onSignIn,
  onSignOut,
  onRefresh,
  onNameChange,
  onAvatarSelect,
  onSave,
}: SettingsViewProps) {
  const noticeList = dedupeNotices(notices).map((n, i) => (
    <AppNotice
      key={`${n.tone}-${i}`}
      tone={n.tone}
      text={n.text}
      action={n.action}
      onSignIn={onSignIn}
      onRetry={onRefresh}
    />
  ));

  if (phase === "booting") {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate">
            <span className="app-gate__pulse" aria-hidden="true" />
            <h1 className="app-gate__title">Opening your settings</h1>
            <p className="app-gate__lead">Connecting to your Chog Royale account.</p>
          </div>
        </div>
      </main>
    );
  }

  if (phase === "login") {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate app-rise">
            <span className="app-gate__mark" aria-hidden="true">
              <Icon name="settings" size={36} />
            </span>
            <h1 className="app-gate__title">Chog Royale</h1>
            <p className="app-gate__lead">
              Settings holds your display name, avatar, verified wallets and this session. Sign in to load the real
              account details.
            </p>
            <button type="button" className="app-btn app-btn--battle" onClick={onSignIn}>
              <Icon name="user" size={22} />
              Log in
            </button>
            <p className="app-gate__note">Sign-in runs through Privy. Nothing on this screen is editable before then.</p>
            {noticeList.length > 0 && <div className="app-gate__notices">{noticeList}</div>}
          </div>
        </div>
      </main>
    );
  }

  if (phase === "profile") {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate app-rise">
            <span className="app-gate__mark app-gate__mark--warn" aria-hidden="true">
              <Icon name="lock" size={32} />
            </span>
            <h1 className="app-gate__title">Your settings could not be opened</h1>
            {noticeList.length > 0 ? (
              <div className="app-gate__notices">{noticeList}</div>
            ) : (
              <p className="app-gate__lead">Your account could not be read.</p>
            )}
            <div className="app-gate__actions">
              <button type="button" className="app-btn app-btn--battle" onClick={onRefresh} disabled={busy}>
                {busy ? "Checking" : "Try again"}
              </button>
              <button type="button" className="app-btn app-btn--ghost" onClick={onSignOut}>
                <Icon name="logout" size={16} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const displayName = player?.displayName || player?.username || "Player";
  const saveText = saveStatusText(save.state, save.message, dirty);
  const saveTone =
    save.state === "saving"
      ? "saving"
      : save.state === "saved"
        ? "saved"
        : save.state === "error"
          ? "error"
          : "idle";

  const walletBadge =
    wallets.state === "ready"
      ? wallets.verified === 1
        ? "1 verified wallet"
        : `${wallets.verified} verified wallets`
      : wallets.state === "empty"
        ? "No verified wallet"
        : wallets.state === "locked"
          ? "Wallets locked"
          : "Wallets unavailable";

  const walletCount =
    wallets.state === "ready"
      ? `${wallets.verified} of ${wallets.total} verified`
      : wallets.state === "empty"
        ? "No wallet linked"
        : wallets.state === "locked"
          ? "Locked"
          : "Not available";

  return (
    <>
      <AppHud player={player} onSignOut={onSignOut} />

      <main className={`app-stage app-stage--wide${calm ? " app-calm" : ""}`}>
        <div className="app-column app-column--wide">
          {noticeList.length > 0 && <div className="app-column__notices">{noticeList}</div>}

          <header className="app-settings-head app-rise">
            <p className="app-settings-head__eyebrow">Account</p>
            <h1 className="app-settings-head__title">Settings</h1>
            <p className="app-settings-head__lead">
              Your display name, avatar and verified wallets. A change is reported as saved only after the server
              confirms it.
            </p>
          </header>

          <div className="app-settings">
            <div className="app-settings__main">
              <section className="app-panel app-profile-id app-rise" aria-labelledby="app-settings-identity-title">
                <span className="app-profile-id__avatar">
                  {player?.avatarUrl ? (
                    <Image
                      src={player.avatarUrl}
                      alt={player.avatarName ? `${player.avatarName} avatar` : "Player avatar"}
                      width={84}
                      height={84}
                      className="app-profile-id__img"
                      unoptimized
                    />
                  ) : (
                    <span className="app-profile-id__empty" aria-hidden="true">
                      <Icon name="user" size={34} />
                    </span>
                  )}
                </span>

                <div className="app-profile-id__names">
                  <h2 className="app-profile-id__name" id="app-settings-identity-title">
                    {displayName}
                  </h2>
                  <p className="app-profile-id__handle">
                    {player?.username ? `@${player.username}` : "No username yet"}
                  </p>
                  <div className="app-profile-id__chips">
                    <span className="app-badge">{accountStatusLabel(player?.accountStatus)}</span>
                    <span className={`app-badge${wallets.state === "ready" && wallets.verified > 0 ? "" : " app-badge--muted"}`}>
                      {walletBadge}
                    </span>
                  </div>
                </div>
              </section>

              <section
                className="app-panel app-settings-edit app-rise"
                aria-labelledby="app-settings-edit-title"
                style={{ animationDelay: "90ms" }}
              >
                <h2 className="app-profile-panel__title" id="app-settings-edit-title">
                  Edit profile
                </h2>

                <form
                  className="app-settings-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSave();
                  }}
                >
                  <div className="app-settings-field">
                    <label className="app-settings-field__label" htmlFor="app-settings-display-name">
                      Display name
                    </label>
                    <input
                      id="app-settings-display-name"
                      className={`app-settings-input${nameError ? " app-settings-input--error" : ""}`}
                      type="text"
                      value={draftName}
                      maxLength={DISPLAY_NAME_MAX}
                      autoComplete="nickname"
                      placeholder={player?.username || "Choose a display name"}
                      disabled={save.state === "saving"}
                      aria-invalid={nameError ? true : undefined}
                      aria-describedby="app-settings-display-name-hint"
                      onChange={(event) => onNameChange(event.target.value)}
                    />
                    <p
                      id="app-settings-display-name-hint"
                      className={`app-settings-field__hint${nameError ? " app-settings-field__hint--error" : ""}`}
                    >
                      {nameError ?? `${draftName.trim().length} of ${DISPLAY_NAME_MAX} characters, trimmed before saving.`}
                    </p>
                  </div>

                  <fieldset
                    className="app-settings-avatars"
                    disabled={save.state === "saving" || avatarCatalog.state !== "ready"}
                  >
                    <legend className="app-settings-field__label">Avatar</legend>
                    {avatarCatalog.state === "ready" ? (
                      <div className="app-avatar-grid">
                        {avatarCatalog.choices.map((choice) => {
                          const selected = choice.id === draftAvatarId;
                          return (
                            <button
                              key={choice.id}
                              type="button"
                              className={`app-avatar-choice${selected ? " app-avatar-choice--active" : ""}`}
                              aria-pressed={selected}
                              onClick={() => onAvatarSelect(choice.id)}
                            >
                              <Image
                                src={choice.assetUrl}
                                alt=""
                                width={44}
                                height={44}
                                className="app-avatar-choice__img"
                                unoptimized
                              />
                              <span className="app-avatar-choice__name">{choice.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="app-profile-note">{avatarsNote ?? "The avatar picker is not available."}</p>
                    )}
                  </fieldset>

                  <div className="app-settings-save">
                    <button type="submit" className="app-btn app-btn--save" disabled={!canSave}>
                      {save.state === "saving" ? "Saving" : "Save changes"}
                    </button>
                    <p className={`app-settings-save__state app-settings-save__state--${saveTone}`} role="status">
                      {saveText}
                    </p>
                  </div>
                </form>
              </section>

              <section
                className="app-panel app-settings-wallets app-rise"
                aria-labelledby="app-settings-wallets-title"
                style={{ animationDelay: "150ms" }}
              >
                <h2 className="app-profile-panel__title" id="app-settings-wallets-title">
                  Verified wallets
                </h2>

                {wallets.state === "ready" ? (
                  <>
                    <p className="app-settings-wallets__count">{`${wallets.verified} of ${wallets.total} verified`}</p>
                    <ul className="app-settings-wallets__list">
                      {wallets.lines.map((line) => (
                        <li key={line.key} className="app-wallet">
                          <span className="app-wallet__type">{line.typeLabel}</span>
                          <span className="app-wallet__meta">
                            {[line.chainLabel, line.verified ? "Verified" : "Not verified"]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {line.primary && <span className="app-badge">Primary</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="app-profile-note">{walletsNote ?? "No wallet summary is shown."}</p>
                )}

                <p className="app-profile-caption">
                  Wallet addresses stay off this screen. The battle server checks ownership from your verified wallet.
                </p>
              </section>
            </div>

            <div className="app-settings__side">
              <section
                className="app-panel app-settings-account app-rise"
                aria-labelledby="app-settings-account-title"
                style={{ animationDelay: "210ms" }}
              >
                <h2 className="app-profile-panel__title" id="app-settings-account-title">
                  Account
                </h2>

                <dl className="app-profile-account__rows">
                  <div className="app-profile-account__row">
                    <dt>Status</dt>
                    <dd>{accountStatusLabel(player?.accountStatus)}</dd>
                  </div>
                  <div className="app-profile-account__row">
                    <dt>Profile setup</dt>
                    <dd>
                      {onboardingLabel(player?.onboardingComplete === true, player?.onboardingNextStep ?? "")}
                    </dd>
                  </div>
                  <div className="app-profile-account__row">
                    <dt>Member since</dt>
                    <dd>{memberSince ?? "Not available"}</dd>
                  </div>
                  <div className="app-profile-account__row">
                    <dt>Wallets</dt>
                    <dd>{walletCount}</dd>
                  </div>
                </dl>

                <div className="app-profile-account__actions">
                  <button type="button" className="app-btn app-btn--ghost" onClick={onRefresh} disabled={busy}>
                    <Icon name="refresh" size={16} />
                    {busy ? "Refreshing" : "Refresh"}
                  </button>
                </div>
              </section>

              <section
                className="app-panel app-settings-session app-rise"
                aria-labelledby="app-settings-session-title"
                style={{ animationDelay: "270ms" }}
              >
                <h2 className="app-profile-panel__title" id="app-settings-session-title">
                  Session
                </h2>
                <p className="app-profile-note">
                  Signing out ends this session on this device. Your profile and saved deck stay on your account.
                </p>
                <div className="app-profile-account__actions">
                  <button type="button" className="app-btn app-btn--ghost" onClick={onSignOut}>
                    <Icon name="logout" size={16} />
                    Sign out
                  </button>
                </div>
              </section>
            </div>
          </div>

          <p className="app-sr" role="status" aria-live="polite">
            {status}
          </p>
        </div>

        <AppNav activeId="profile" />
      </main>
    </>
  );
}
