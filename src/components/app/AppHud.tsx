"use client";

// The identity bar at the top of the authenticated app shell.
//
// One component for the lobby and the deck screen, so the player sees the same
// name, avatar and account state on every screen of the game.

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
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
        {extra}
        <Link href="/app/messages" className="app-iconbtn" aria-label="Messages" title="Messages"><Icon name="messages" /></Link>
        <Link
          href="/app/settings"
          className="app-iconbtn"
          aria-label="Settings"
          title="Settings"
        >
          <Icon name="settings" />
        </Link>
        <Link
          href="/app/profile"
          className="app-iconbtn"
          aria-label="Profile"
          title="Profile"
        >
          <Icon name="user" />
        </Link>
        <button type="button" className="app-iconbtn" onClick={onSignOut} aria-label="Sign out" title="Sign out">
          <Icon name="logout" />
        </button>
      </div>
    </header>
  );
}

/** A back link to the lobby, used by the deck screen. */
export function AppHudBackLink() {
  return (
    <Link href="/app" className="app-iconbtn" aria-label="Back to the lobby" title="Back to the lobby">
      <Icon name="back" />
    </Link>
  );
}
