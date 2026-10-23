"use client";

// One notice plate, shared by the lobby, the deck screen and the profile.
//
// It was extracted from the lobby view unchanged so every screen reports a
// failure with the same plate, the same tone tokens and the same optional
// escape hatch. The copy always arrives from the container as a plain prop.

import Link from "next/link";
import type { LobbyNotice } from "./lobby-types";

export default function AppNotice({
  tone,
  text,
  action,
  onSignIn,
  onRetry,
}: LobbyNotice & { onSignIn?: () => void; onRetry?: () => void }) {
  const buttonAction =
    action?.kind === "signin" ? onSignIn : action?.kind === "retry" ? onRetry : undefined;

  return (
    <div className={`app-notice app-notice--${tone}`}>
      <p className="app-notice__text">{text}</p>
      {action &&
        (action.href ? (
          <Link href={action.href} className="app-notice__action">
            {action.label}
          </Link>
        ) : buttonAction ? (
          <button type="button" className="app-notice__action app-notice__action--button" onClick={buttonAction}>
            {action.label}
          </button>
        ) : null)}
    </div>
  );
}
