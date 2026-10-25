"use client";

import type { FormEventHandler } from "react";

export default function OnboardingUsernameForm({ draftName, draftDisplay, nameError, busy, onNameChange, onDisplayChange, onSubmit }: {
  draftName: string; draftDisplay: string; nameError: string | null; busy: string | null;
  onNameChange: (value: string) => void; onDisplayChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return <form onSubmit={onSubmit}>
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
                    onChange={(event) => onNameChange(event.target.value)}
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
                    onChange={(event) => onDisplayChange(event.target.value)}
                  />
                </div>
                <button type="submit" className="app-btn app-btn--battle" disabled={busy !== null}>
                  {busy ? "Saving" : "Claim username"}
                </button>
              </form>;
}
