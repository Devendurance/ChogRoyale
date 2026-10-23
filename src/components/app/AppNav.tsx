"use client";

// Game navigation (A1). One nav element, two shapes: a fixed bottom tab bar
// on phones and a bottom rail inside the stage on desktop.
//
// Tabs that are not part of this milestone are rendered as explicit disabled
// items with a "Soon" label. They are never styled like a working control,
// so nothing in the lobby looks usable but is not.

import Link from "next/link";
import Icon, { type IconName } from "./icons";

interface Tab {
  id: string;
  label: string;
  icon: IconName;
  href: string | null;
  /** False means the screen does not exist yet in this milestone. */
  available: boolean;
}

const TABS: Tab[] = [
  { id: "lobby", label: "Lobby", icon: "lobby", href: "/app", available: true },
  { id: "decks", label: "Decks", icon: "decks", href: "/app/decks", available: true },
  { id: "commanders", label: "Commanders", icon: "commanders", href: "/app/commanders", available: true },
  { id: "progress", label: "Progress", icon: "progress", href: "/app/progress", available: true },
  { id: "profile", label: "Profile", icon: "user", href: "/app/profile", available: true },
];

export default function AppNav({ activeId = "lobby" }: { activeId?: string }) {
  return (
    <nav className="app-nav" aria-label="Game sections">
      {TABS.map((tab) => {
        const isActive = tab.id === activeId;

        if (!tab.available || !tab.href) {
          return (
            <span
              key={tab.id}
              className="app-nav__item app-nav__item--disabled"
              aria-disabled="true"
              title={`${tab.label} is not available in this build yet`}
            >
              <Icon name={tab.icon} className="app-nav__icon" />
              <span className="app-nav__label">{tab.label}</span>
              <span className="app-nav__soon">Soon</span>
            </span>
          );
        }

        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`app-nav__item${isActive ? " app-nav__item--active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            {isActive && (
              <span className="app-nav__chev app-nav__chev--left" aria-hidden="true">
                &#8249;
              </span>
            )}
            <Icon name={tab.icon} className="app-nav__icon" />
            <span className="app-nav__label">{tab.label}</span>
            {isActive && (
              <span className="app-nav__chev app-nav__chev--right" aria-hidden="true">
                &#8250;
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
