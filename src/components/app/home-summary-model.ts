// Pure display models for the Battle Hall's compact account summary.

import type { AccountXpLevelView } from "./account-xp-model";

export interface HomeSummaryRequestError {
  code?: unknown;
  status?: unknown;
  message?: unknown;
}

export type HomeSummaryRequest<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; status?: number };

export type HomeMetricView =
  | { state: "loading"; value: null; message?: null }
  | { state: "ready"; value: number; message?: null }
  | { state: "auth" | "locked" | "unavailable"; value: null; message: string };

export interface HomeSummaryProps {
  gold: HomeMetricView;
  crowns: HomeMetricView;
  accountLevel: AccountXpLevelView;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function failedMetric(error: HomeSummaryRequestError): HomeMetricView {
  const code = typeof error.code === "string" ? error.code : null;
  const status = typeof error.status === "number" ? error.status : null;
  const message = typeof error.message === "string" && error.message.trim()
    ? error.message
    : "This account value could not be loaded.";

  if (code === "UNAUTHORIZED" || status === 401) {
    return { state: "auth", value: null, message: "Sign in again to load this value." };
  }
  if (code === "FORBIDDEN" || status === 403) {
    return { state: "locked", value: null, message: "Finish profile setup to load this value." };
  }
  return { state: "unavailable", value: null, message };
}

function resolveCountRequest(
  request: HomeSummaryRequest<unknown> | null,
  pick: (data: unknown) => unknown,
  invalidMessage: string,
): HomeMetricView {
  if (request === null) return { state: "loading", value: null, message: null };
  if (!request.ok) return failedMetric(request);

  const value = pick(request.data);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return { state: "unavailable", value: null, message: invalidMessage };
  }
  return { state: "ready", value, message: null };
}

/** Read only the server-returned balance from GET /api/players/me/gold. */
export function resolveHomeGold(request: HomeSummaryRequest<unknown> | null): HomeMetricView {
  return resolveCountRequest(
    request,
    (data) => (isRecord(data) && isRecord(data.gold) ? data.gold.balance : undefined),
    "The server did not return a verified Gold balance.",
  );
}

/** Read only the server-returned earned crown total from GET /api/players/me/stats. */
export function resolveHomeCrowns(request: HomeSummaryRequest<unknown> | null): HomeMetricView {
  return resolveCountRequest(
    request,
    (data) => (isRecord(data) && isRecord(data.stats) ? data.stats.crownsEarned : undefined),
    "The server did not return a verified crowns-earned total.",
  );
}
