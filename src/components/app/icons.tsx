// Inline icons for the lobby shell. Drawn here so the game side carries no
// icon dependency and every glyph keeps the same stroke weight and shape
// language as the Chog plates.

import type { ReactNode } from "react";

export type IconName =
  | "lobby"
  | "decks"
  | "collection"
  | "commanders"
  | "progress"
  | "guide"
  | "user"
  | "friends"
  | "clans"
  | "messages"
  | "settings"
  | "wallet"
  | "logout"
  | "refresh"
  | "lock"
  | "swords"
  | "energy"
  | "back"
  | "check"
  | "swap"
  | "close"
  | "menu";

const PATHS: Record<IconName, ReactNode> = {
  messages: <path d="M4 4h16v12H9l-5 4V4Zm4 5h8M8 12h5" />,
  lobby: (
    <>
      <path d="M3.4 10.6L12 3.8l8.6 6.8" />
      <path d="M5.6 9.2V20h12.8V9.2" />
      <path d="M10 20v-5.4h4V20" />
    </>
  ),
  decks: (
    <>
      <rect x="6.5" y="3.5" width="12" height="15" rx="2.4" />
      <path d="M4.2 6.6v11.2a2.6 2.6 0 0 0 2.6 2.6h7.4" />
    </>
  ),
  commanders: (
    <>
      <path d="M3.6 18.2h16.8" />
      <path d="M4.4 18.2L3 8.4l5 3.6L12 5.4l4 6.6 5-3.6-1.4 9.8" />
    </>
  ),
  progress: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-6" />
      <path d="M12 20V6" />
      <path d="M17 20v-9" />
    </>
  ),
  guide: (
    <>
      <path d="M4.4 5.4c2.8-.8 5.2-.2 7.6 1.2 2.4-1.4 4.8-2 7.6-1.2v12.6c-2.8-.8-5.2-.2-7.6 1.2-2.4-1.4-4.8-2-7.6-1.2z" />
      <path d="M12 6.6v12.6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 20c0-3.5 3.2-5.6 7.2-5.6s7.2 2.1 7.2 5.6" />
    </>
  ),
  friends: (
    <>
      <circle cx="8.6" cy="9" r="3" />
      <path d="M2.8 19.4c0-3 2.6-4.8 5.8-4.8 1 0 2 .2 2.8.7" />
      <circle cx="16.4" cy="9.6" r="2.4" />
      <path d="M14.6 14.9c2.9.3 5.2 2 5.2 4.5" />
    </>
  ),
  clans: (
    <>
      <path d="M12 3.4 19 6v5.2c0 4.2-2.8 7.7-7 9.4-4.2-1.7-7-5.2-7-9.4V6l7-2.6Z" />
      <path d="m8.2 11.4 2.2 2.2 5.4-5.4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="6.2" />
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3.4v2.2" />
      <path d="M12 18.4v2.2" />
      <path d="M3.4 12h2.2" />
      <path d="M18.4 12h2.2" />
      <path d="M5.9 5.9l1.6 1.6" />
      <path d="M16.5 16.5l1.6 1.6" />
      <path d="M18.1 5.9l-1.6 1.6" />
      <path d="M7.5 16.5l-1.6 1.6" />
    </>
  ),
  wallet: (
    <>
      <path d="M3.6 8.4a2.6 2.6 0 0 1 2.6-2.6h11.4a2 2 0 0 1 2 2v1.2" />
      <path d="M3.6 8.4v9.4a2.6 2.6 0 0 0 2.6 2.6h13a2 2 0 0 0 2-2v-6.2a2 2 0 0 0-2-2H6.2a2.6 2.6 0 0 1-2.6-2.6z" />
      <path d="M16.6 13.4h.02" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.6H6.6A1.8 1.8 0 0 0 4.8 6.4v11.2a1.8 1.8 0 0 0 1.8 1.8H14" />
      <path d="M17.4 8.6l3.2 3.4-3.2 3.4" />
      <path d="M9.8 12h10.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2" />
      <path d="M19.8 4.6v4.2h-4.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5.2" y="10.4" width="13.6" height="9.4" rx="2.4" />
      <path d="M8.4 10.2V7.8a3.6 3.6 0 0 1 7.2 0v2.4" />
    </>
  ),
  swords: (
    <>
      <path d="M4.4 4.4l11 11" />
      <path d="M19.6 4.4l-11 11" />
      <path d="M4.4 4.4l1 3.6 2.4-1" />
      <path d="M19.6 4.4l-1 3.6-2.4-1" />
      <path d="M14.2 16.2l3.4 3.4" />
      <path d="M9.8 16.2l-3.4 3.4" />
    </>
  ),
  collection: (
    <>
      <rect x="3.4" y="3.4" width="7.2" height="9.6" rx="1.8" />
      <rect x="13.4" y="3.4" width="7.2" height="9.6" rx="1.8" />
      <rect x="3.4" y="15.4" width="7.2" height="5.2" rx="1.6" />
      <rect x="13.4" y="15.4" width="7.2" height="5.2" rx="1.6" />
    </>
  ),
  energy: (
    <>
      <path d="M12 3.2c3.4 4 5.6 6.8 5.6 9.6a5.6 5.6 0 1 1-11.2 0c0-2.8 2.2-5.6 5.6-9.6z" />
    </>
  ),
  back: (
    <>
      <path d="M14.4 5.6L8 12l6.4 6.4" />
    </>
  ),
  check: (
    <>
      <path d="M4.8 12.6l4.4 4.4L19.2 7" />
    </>
  ),
  swap: (
    <>
      <path d="M4.4 8.4h13.2" />
      <path d="M14.4 5.2l3.2 3.2-3.2 3.2" />
      <path d="M19.6 15.6H6.4" />
      <path d="M9.6 12.4l-3.2 3.2 3.2 3.2" />
    </>
  ),
  close: (
    <>
      <path d="M6.4 6.4l11.2 11.2" />
      <path d="M17.6 6.4L6.4 17.6" />
    </>
  ),
  menu: (
    <>
      <path d="M4.5 6.8h15" />
      <path d="M4.5 12h15" />
      <path d="M4.5 17.2h15" />
    </>
  ),
};

export default function Icon({
  name,
  size = 22,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
