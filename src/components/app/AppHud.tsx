"use client";

// The identity bar at the top of the authenticated app shell.
//
// One component for the lobby and the deck screen, so the player sees the same
// name, avatar and account state on every screen of the game.

import Link from "next/link";
import Image from "next/image";
import { useRef, type MouseEvent, type ReactNode } from "react";
import Icon from "./icons";
import type { LobbyPlayer } from "./lobby-types";

export default function AppHud({
  player,
  onSignOut,
  extra,
}: {
  player: LobbyPlayer | null;
  onSignOut: () => void;
  /** Extra controls rendered before the sign-out button. */
  extra?: ReactNode;
}) {
  const identityName = player?.displayName ?? player?.username ?? "";
  const mobileActions = useRef<HTMLDetailsElement>(null);

  const actions = (
    <>
      {extra}
      <Link href="/app/messages" className="app-iconbtn" aria-label="Messages" title="Messages">
        <Icon name="messages" />
        <span className="app-hud__action-label">Messages</span>
      </Link>
      <Link
        href="/app/settings"
        className="app-iconbtn"
        aria-label="Settings"
        title="Settings"
      >
        <Icon name="settings" />
        <span className="app-hud__action-label">Settings</span>
      </Link>
      <Link
        href="/app/profile"
        className="app-iconbtn"
        aria-label="Profile"
        title="Profile"
      >
        <Icon name="user" />
        <span className="app-hud__action-label">Profile</span>
      </Link>
      <button type="button" className="app-iconbtn" onClick={onSignOut} aria-label="Sign out" title="Sign out">
        <Icon name="logout" />
        <span className="app-hud__action-label">Sign out</span>
      </button>
    </>
  );

  const closeMobileActions = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("a, button")) {
      mobileActions.current?.removeAttribute("open");
    }
  };

  return (
    <header className="app-hud">
      <div className="app-identity">
        {player?.avatarUrl ? (
          <Image
            src={player.avatarUrl}
            alt={player.avatarName ? `${player.avatarName} avatar` : "Player avatar"}
            width={42}
            height={42}
            className="app-avatar"
            unoptimized
          />
        ) : (
          <span className="app-avatar app-avatar--empty" aria-hidden="true">
            <Icon name="user" size={20} />
          </span>
        )}
        <div className="app-identity__names">
          <p className="app-identity__name">{identityName || "Player"}</p>
          <p className="app-identity__handle">{player?.username ? `@${player.username}` : "No username yet"}</p>
        </div>
        {player?.walletLinked && (
          <span className="app-chip" role="img" aria-label="Wallet linked" title="Wallet linked">
            <Icon name="wallet" size={12} />
            <span className="app-chip__text">Wallet linked</span>
          </span>
        )}
      </div>

      <div className="app-hud__utils">
        <div className="app-hud__desktop-actions">{actions}</div>
        <details className="app-hud__mobile-menu" ref={mobileActions}>
          <summary className="app-iconbtn app-hud__mobile-trigger" aria-label="More account actions" title="More account actions">
            <Icon name="menu" />
          </summary>
          <div className="app-hud__mobile-panel" onClick={closeMobileActions}>
            <div className="app-hud__mobile-actions">{actions}</div>
          </div>
        </details>
      </div>
    </header>
  );
}

/** A back link to the lobby, used by the deck screen. */
export function AppHudBackLink() {
  return (
    <Link href="/app" className="app-iconbtn" aria-label="Back to the lobby" title="Back to the lobby">
      <Icon name="back" />
      <span className="app-hud__action-label">Back to the lobby</span>
    </Link>
  );
}
