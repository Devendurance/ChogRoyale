// Pure client model for GET /api/players/me/account-xp (V2.2b).
//
// The endpoint is a read of server-owned Account XP. This module validates the
// response before exposing it to Profile or Progress. It never derives a
// level from a missing total, turns a failed read into Level 1, or accepts a
// reward row whose source and result are not part of the Account XP contract.

import {
  ACCOUNT_XP_MAX_LEVEL,
  ACCOUNT_XP_POLICY_VERSION,
  accountXpThresholdForLevel,
} from "@/lib/account-xp";

export const ACCOUNT_XP_MAX_ACCOUNT_LEVEL = ACCOUNT_XP_MAX_LEVEL;

export type AccountXpSource = "matchmaking" | "unranked-fallback";
export type AccountXpResult = "win" | "loss" | "draw";

/** The read states shared by the Profile and Progress panels. */
export type AccountXpReadState =
  | "ready"
  | "disabled"
  | "migration"
  | "unavailable"
  | "auth"
  | "forbidden"
  | "malformed"
  | "network";

/** The recent award row returned by the authenticated endpoint. */
export interface AccountXpAwardView {
  matchId: string;
  source: AccountXpSource;
  result: AccountXpResult;
  amount: number;
  policyVersion: number;
  createdAt: string | null;
}

/** The validated `data` object from the account-XP API response. */
export interface AccountXpPayload {
  policyVersion: number;
  level: number;
  totalXp: number;
  currentLevelThreshold: number;
  nextLevelThreshold: number | null;
  xpIntoLevel: number;
  xpToNext: number | null;
  maxLevel: boolean;
  maxAccountLevel: number;
  enabled: boolean;
  pvpDailyCap: number;
  pvpRewardedToday: number;
  awards: AccountXpAwardView[];
}

/** A response body accepted by the route's standard success/failure envelope. */
export interface AccountXpSuccessEnvelope {
  success: true;
  data: unknown;
}

export interface AccountXpFailureEnvelope {
  success: false;
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export type AccountXpEnvelope = AccountXpSuccessEnvelope | AccountXpFailureEnvelope;

export type AccountXpValidationReason =
  | "not-an-object"
  | "invalid-envelope"
  | "missing-data"
  | "invalid-policy-version"
  | "invalid-level"
  | "invalid-total-xp"
  | "invalid-current-threshold"
  | "invalid-next-threshold"
  | "invalid-xp-into-level"
  | "invalid-xp-to-next"
  | "invalid-max-level"
  | "invalid-max-account-level"
  | "invalid-enabled"
  | "invalid-daily-cap"
  | "invalid-rewarded-today"
  | "invalid-awards"
  | "invalid-award";

export type AccountXpValidation =
  | { ok: true; payload: AccountXpPayload }
  | { ok: false; payload: null; reason: AccountXpValidationReason };

export type AccountXpEnvelopeValidation =
  | { ok: true; payload: AccountXpPayload }
  | { ok: false; payload: null; reason: AccountXpValidationReason; code: string | null };

export interface AccountXpRequestError {
  code?: unknown;
  status?: unknown;
  message?: unknown;
}

/** Flat view props keep both screens independent of the API envelope. */
export interface AccountXpSummary {
  state: AccountXpReadState;
  /** Null in disabled and failed states, so callers cannot show fake Level 1. */
  level: number | null;
  totalXp: number | null;
  currentLevelThreshold: number | null;
  nextLevelThreshold: number | null;
  xpIntoLevel: number | null;
  xpToNext: number | null;
  maxLevel: boolean | null;
  policyVersion: number | null;
  maxAccountLevel: number | null;
  enabled: boolean | null;
  pvpDailyCap: number | null;
  pvpRewardedToday: number | null;
  awards: AccountXpAwardView[];
  /** The validator reason or API error code, useful for diagnostics and tests. */
  reason: string | null;
  /** The valid server payload, including a disabled payload, when available. */
  data: AccountXpPayload | null;
}

export type AccountXpLevelState = "loading" | "ready" | "unavailable" | "disabled";

/** Display-safe level projection shared by Profile and Progress. */
export interface AccountXpLevelView {
  state: AccountXpLevelState;
  level: number | null;
  totalXp: number | null;
  currentLevelThreshold: number | null;
  nextLevelThreshold: number | null;
  xpIntoLevel: number | null;
  xpToNext: number | null;
  maxLevel: boolean;
  maxAccountLevel: number;
  message: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  isSafeInteger(value) && value >= 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isSource = (value: unknown): value is AccountXpSource =>
  value === "matchmaking" || value === "unranked-fallback";

const isResult = (value: unknown): value is AccountXpResult =>
  value === "win" || value === "loss" || value === "draw";

function invalid(reason: AccountXpValidationReason): AccountXpValidation {
  return { ok: false, payload: null, reason };
}

function validDateOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value)));
}

function parseAward(value: unknown): AccountXpAwardView | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.matchId) || !isSource(value.source) || !isResult(value.result)) return null;
  if (!isNonNegativeInteger(value.amount) || !isSafeInteger(value.policyVersion) || value.policyVersion < 1) return null;
  if (!validDateOrNull(value.createdAt)) return null;
  return {
    matchId: value.matchId,
    source: value.source,
    result: value.result,
    amount: value.amount,
    policyVersion: value.policyVersion,
    createdAt: value.createdAt,
  };
}

/**
 * Validate only the route's data object. Numeric strings are rejected because
 * the JSON route returns numbers and accepting strings would hide a contract
 * or serialization failure.
 */
export function validateAccountXpPayload(value: unknown): AccountXpValidation {
  if (!isRecord(value)) return invalid("not-an-object");

  if (value.policyVersion !== ACCOUNT_XP_POLICY_VERSION) return invalid("invalid-policy-version");
  if (!isSafeInteger(value.level) || value.level < 1 || value.level > ACCOUNT_XP_MAX_LEVEL) return invalid("invalid-level");
  if (!isNonNegativeInteger(value.totalXp)) return invalid("invalid-total-xp");
  if (!isNonNegativeInteger(value.currentLevelThreshold)) return invalid("invalid-current-threshold");
  if (value.nextLevelThreshold !== null && !isNonNegativeInteger(value.nextLevelThreshold)) return invalid("invalid-next-threshold");
  if (!isNonNegativeInteger(value.xpIntoLevel)) return invalid("invalid-xp-into-level");
  if (value.xpToNext !== null && !isNonNegativeInteger(value.xpToNext)) return invalid("invalid-xp-to-next");
  if (typeof value.maxLevel !== "boolean") return invalid("invalid-max-level");
  if (value.maxAccountLevel !== ACCOUNT_XP_MAX_ACCOUNT_LEVEL) return invalid("invalid-max-account-level");
  if (typeof value.enabled !== "boolean") return invalid("invalid-enabled");
  if (!isSafeInteger(value.pvpDailyCap) || value.pvpDailyCap < 1) return invalid("invalid-daily-cap");
  if (!isNonNegativeInteger(value.pvpRewardedToday) || value.pvpRewardedToday > value.pvpDailyCap) return invalid("invalid-rewarded-today");
  if (!Array.isArray(value.awards)) return invalid("invalid-awards");

  const awards: AccountXpAwardView[] = [];
  const matchIds = new Set<string>();
  for (const row of value.awards) {
    const award = parseAward(row);
    if (!award || matchIds.has(award.matchId)) return invalid("invalid-award");
    matchIds.add(award.matchId);
    awards.push(award);
  }

  const currentLevelThreshold = accountXpThresholdForLevel(value.level);
  if (value.currentLevelThreshold !== currentLevelThreshold) return invalid("invalid-current-threshold");

  const isMax = value.level === ACCOUNT_XP_MAX_ACCOUNT_LEVEL;
  if (value.maxLevel !== isMax) return invalid("invalid-max-level");
  if (value.totalXp < value.currentLevelThreshold) return invalid("invalid-total-xp");
  if (value.xpIntoLevel !== value.totalXp - value.currentLevelThreshold) return invalid("invalid-xp-into-level");

  if (isMax) {
    if (value.nextLevelThreshold !== null || value.xpToNext !== null) return invalid("invalid-max-level");
  } else {
    const nextLevelThreshold = accountXpThresholdForLevel(value.level + 1);
    if (value.nextLevelThreshold !== nextLevelThreshold) return invalid("invalid-next-threshold");
    if (value.nextLevelThreshold <= value.totalXp) return invalid("invalid-next-threshold");
    if (value.xpToNext !== value.nextLevelThreshold - value.totalXp) return invalid("invalid-xp-to-next");
  }

  return {
    ok: true,
    payload: {
      policyVersion: value.policyVersion,
      level: value.level,
      totalXp: value.totalXp,
      currentLevelThreshold: value.currentLevelThreshold,
      nextLevelThreshold: value.nextLevelThreshold,
      xpIntoLevel: value.xpIntoLevel,
      xpToNext: value.xpToNext,
      maxLevel: value.maxLevel,
      maxAccountLevel: value.maxAccountLevel,
      enabled: value.enabled,
      pvpDailyCap: value.pvpDailyCap,
      pvpRewardedToday: value.pvpRewardedToday,
      awards,
    },
  };
}

/** Validate the complete `{ success, data }` route envelope. */
export function validateAccountXpResponse(value: unknown): AccountXpEnvelopeValidation {
  if (!isRecord(value)) return { ok: false, payload: null, reason: "not-an-object", code: null };
  if (value.success !== true) {
    const error = isRecord(value.error) ? value.error : null;
    const code = typeof error?.code === "string" ? error.code : null;
    return { ok: false, payload: null, reason: "invalid-envelope", code };
  }
  if (!("data" in value)) return { ok: false, payload: null, reason: "missing-data", code: null };
  const parsed = validateAccountXpPayload(value.data);
  return parsed.ok ? parsed : { ...parsed, code: null };
}

/** Alias for callers that use `parse` terminology. */
export const parseAccountXpResponse = validateAccountXpResponse;

function emptySummary(state: AccountXpReadState, reason: string | null): AccountXpSummary {
  return {
    state,
    level: null,
    totalXp: null,
    currentLevelThreshold: null,
    nextLevelThreshold: null,
    xpIntoLevel: null,
    xpToNext: null,
    maxLevel: null,
    policyVersion: null,
    maxAccountLevel: null,
    enabled: null,
    pvpDailyCap: null,
    pvpRewardedToday: null,
    awards: [],
    reason,
    data: null,
  };
}

export function failureAccountXp(state: Exclude<AccountXpReadState, "ready" | "disabled">, reason: string | null = null): AccountXpSummary {
  return emptySummary(state, reason);
}

export function accountXpLevelView(summary: AccountXpSummary | null, loading = false): AccountXpLevelView {
  if (loading || summary === null) {
    return {
      state: "loading",
      level: null,
      totalXp: null,
      currentLevelThreshold: null,
      nextLevelThreshold: null,
      xpIntoLevel: null,
      xpToNext: null,
      maxLevel: false,
      maxAccountLevel: ACCOUNT_XP_MAX_ACCOUNT_LEVEL,
      message: null,
    };
  }

  if (summary.state === "disabled") {
    return {
      state: "disabled",
      level: null,
      totalXp: null,
      currentLevelThreshold: null,
      nextLevelThreshold: null,
      xpIntoLevel: null,
      xpToNext: null,
      maxLevel: false,
      maxAccountLevel: summary.maxAccountLevel ?? ACCOUNT_XP_MAX_ACCOUNT_LEVEL,
      message: "Account XP is not active yet. Your progression will appear when it opens.",
    };
  }

  if (summary.state !== "ready") {
    const message =
      summary.state === "forbidden"
        ? "Finish profile setup before account progression can be read."
        : summary.state === "auth"
          ? "Sign in again to load account progression."
          : summary.state === "migration"
            ? "Account progression is waiting for its server release. No level or XP is inferred."
            : summary.state === "malformed"
              ? "The account progression response was incomplete. No level or XP is inferred."
              : "The account progression service did not answer. No level or XP is inferred.";
    return {
      state: "unavailable",
      level: null,
      totalXp: null,
      currentLevelThreshold: null,
      nextLevelThreshold: null,
      xpIntoLevel: null,
      xpToNext: null,
      maxLevel: false,
      maxAccountLevel: summary.maxAccountLevel ?? ACCOUNT_XP_MAX_ACCOUNT_LEVEL,
      message,
    };
  }

  return {
    state: "ready",
    level: summary.level,
    totalXp: summary.totalXp,
    currentLevelThreshold: summary.currentLevelThreshold,
    nextLevelThreshold: summary.nextLevelThreshold,
    xpIntoLevel: summary.xpIntoLevel,
    xpToNext: summary.xpToNext,
    maxLevel: summary.maxLevel === true,
    maxAccountLevel: summary.maxAccountLevel ?? ACCOUNT_XP_MAX_ACCOUNT_LEVEL,
    message: null,
  };
}

function readySummary(payload: AccountXpPayload): AccountXpSummary {
  if (!payload.enabled) {
    return {
      ...emptySummary("disabled", "disabled"),
      policyVersion: payload.policyVersion,
      maxAccountLevel: payload.maxAccountLevel,
      enabled: false,
      pvpDailyCap: payload.pvpDailyCap,
      pvpRewardedToday: payload.pvpRewardedToday,
      data: payload,
    };
  }
  return {
    state: "ready",
    level: payload.level,
    totalXp: payload.totalXp,
    currentLevelThreshold: payload.currentLevelThreshold,
    nextLevelThreshold: payload.nextLevelThreshold,
    xpIntoLevel: payload.xpIntoLevel,
    xpToNext: payload.xpToNext,
    maxLevel: payload.maxLevel,
    policyVersion: payload.policyVersion,
    maxAccountLevel: payload.maxAccountLevel,
    enabled: true,
    pvpDailyCap: payload.pvpDailyCap,
    pvpRewardedToday: payload.pvpRewardedToday,
    awards: payload.awards,
    reason: null,
    data: payload,
  };
}

/** Map a failed account-XP read to an explicit panel state. */
export function accountXpReadStateForError(error: AccountXpRequestError | string | null | undefined): Exclude<AccountXpReadState, "ready" | "disabled"> {
  const code = typeof error === "string" ? error : typeof error?.code === "string" ? error.code : null;
  const status = typeof error === "object" && error !== null && typeof error.status === "number" ? error.status : null;
  if (code === "NETWORK" || code === "FETCH_FAILED") return "network";
  if (code === "UNAUTHORIZED" || status === 401) return "auth";
  if (code === "FORBIDDEN" || status === 403) return "forbidden";
  // This route uses SERVICE_UNAVAILABLE specifically while migration 0026 is
  // absent. Other 5xx/internal codes remain ordinary unavailability.
  if (code === "MALFORMED") return "malformed";
  if (code === "SERVICE_UNAVAILABLE" && (status === null || status === 503)) return "migration";
  return "unavailable";
}

/** Short alias used by read containers. */
export const panelStateForAccountXpError = accountXpReadStateForError;

/**
 * Resolve either the raw data object or the complete API envelope. The second
 * argument is for containers that already caught a fetch/API error.
 */
export function resolveAccountXp(value: unknown, error?: AccountXpRequestError | string | null): AccountXpSummary {
  if (error) return failureAccountXp(accountXpReadStateForError(error), typeof error === "string" ? error : typeof error.code === "string" ? error.code : null);

  if (isRecord(value) && "success" in value) {
    const response = validateAccountXpResponse(value);
    if (!response.ok) {
      if (response.code) return failureAccountXp(accountXpReadStateForError(response.code), response.code);
      return failureAccountXp("malformed", response.reason);
    }
    return readySummary(response.payload);
  }

  const parsed = validateAccountXpPayload(value);
  return parsed.ok ? readySummary(parsed.payload) : failureAccountXp("malformed", parsed.reason);
}

/** Explicit name for callers passing a response envelope. */
export const resolveAccountXpResponse = resolveAccountXp;

/** Display percentage for the server-supplied level bar, or null when hidden. */
export function accountXpProgressPercent(summary: Pick<AccountXpSummary, "state" | "xpIntoLevel" | "nextLevelThreshold" | "currentLevelThreshold" | "maxLevel">): number | null {
  if (summary.state !== "ready") return null;
  if (summary.maxLevel) return 100;
  if (summary.xpIntoLevel === null || summary.nextLevelThreshold === null || summary.currentLevelThreshold === null) return null;
  const span = summary.nextLevelThreshold - summary.currentLevelThreshold;
  if (!Number.isSafeInteger(span) || span <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((summary.xpIntoLevel / span) * 100)));
}

export const accountXpBarPercent = accountXpProgressPercent;

/** Return the server's next-level requirement, never a fabricated value. */
export function accountXpNextRequirement(summary: Pick<AccountXpSummary, "state" | "xpToNext">): number | null {
  return summary.state === "ready" ? summary.xpToNext : null;
}

export function accountXpSourceLabel(source: AccountXpSource): string {
  return source === "unranked-fallback" ? "Unranked AI" : "Unranked PvP";
}

export function accountXpResultLabel(result: AccountXpResult): string {
  return result === "win" ? "Victory" : result === "loss" ? "Defeat" : "Draw";
}

const AWARD_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatAccountXpAwardDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : AWARD_DATE_FORMAT.format(new Date(timestamp));
}

