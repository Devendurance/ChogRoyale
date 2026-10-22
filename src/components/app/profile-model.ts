// Pure derivation for the profile screen (A3.1).
//
// Everything here is a function of already-fetched API payloads. No network,
// no server imports: the same functions run in the authenticated container and
// in a test, and a partial or garbage payload degrades a row instead of
// throwing the screen away.

import type { RecordSummary } from "./profile-types";

/** The stats read as it arrives: one optional object of optional numbers. */
export interface StatsPayloadLike {
  stats?: {
    total?: unknown;
    wins?: unknown;
    losses?: unknown;
    draws?: unknown;
    winRateBp?: unknown;
    crownsEarned?: unknown;
    crownsConceded?: unknown;
  } | null;
}

const EMPTY_RECORD: RecordSummary = {
  state: "unavailable",
  total: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  winRateBp: null,
  crownsEarned: 0,
  crownsConceded: 0,
};

/** A finite number, or null. Booleans, arrays and objects are not numbers. */
function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A count that can only be a whole, non-negative number of matches. */
function count(value: unknown): number {
  const parsed = numeric(value);
  return parsed === null ? 0 : Math.max(0, Math.floor(parsed));
}

/**
 * Basis points, or null when the payload does not carry a real rate. The route
 * sends an integer or null, so anything else is reported as missing rather
 * than guessed.
 */
function winRateBp(value: unknown): number | null {
  const parsed = numeric(value);
  return parsed === null ? null : Math.max(0, Math.floor(parsed));
}

/**
 * The verified record. A read that never arrived is "unavailable", an account
 * with no settled match is "empty", and only real rows are "ready".
 */
export function resolveRecord(payload: StatsPayloadLike | null): RecordSummary {
  const stats = payload?.stats ?? null;
  if (!stats) return { ...EMPTY_RECORD };

  const total = count(stats.total);
  return {
    state: total > 0 ? "ready" : "empty",
    total,
    wins: count(stats.wins),
    losses: count(stats.losses),
    draws: count(stats.draws),
    winRateBp: winRateBp(stats.winRateBp),
    crownsEarned: count(stats.crownsEarned),
    crownsConceded: count(stats.crownsConceded),
  };
}

const MEMBER_SINCE_FORMAT = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** The account's join date, or null when the value is missing or unreadable. */
export function formatMemberSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return MEMBER_SINCE_FORMAT.format(date);
}

export function accountStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "Active account";
    case "suspended":
      return "Suspended";
    case "banned":
      return "Banned";
    default:
      return "Account status unavailable";
  }
}

export function onboardingLabel(complete: boolean, nextStep: string): string {
  if (complete) return "Profile setup complete";
  switch (nextStep) {
    case "username":
      return "Needs a username";
    case "avatar":
      return "Needs an avatar";
    case "wallet":
      return "Needs a linked wallet";
    default:
      return "Profile setup incomplete";
  }
}

/** Basis points as a percentage, or "n/a" when no rate is known. */
export function winRateLabel(winRateBp: number | null): string {
  if (winRateBp === null || !Number.isFinite(winRateBp)) return "n/a";
  return `${(winRateBp / 100).toFixed(1)}%`;
}
