// Pure derivation for the Genesis legacy vault (A3.2b).
//
// The record belongs to the Genesis token, not the wallet. Vault holdings are
// cached observations from verified wallets; commander appearances carry the
// match-time direct-owner proof. Arena Patron appearances are a separate,
// server-selected relationship and are never presented as a player choice.
//
// Achievement definitions are the authored catalog in src/lib/legacy.ts. The
// read API exposes earned awards only, so locked progress is derived from the
// verified legacy counts the token route already returns.

import { ACHIEVEMENT_DEFINITIONS } from "@/lib/legacy";
import type { LobbyArt } from "./lobby-types";
import { formatRecordDate } from "./progress-model";
import type {
  AchievementSummary,
  AchievementView,
  LegacyEventView,
  LegacyRecordView,
  LegacyRecordState,
  LegacyStatsView,
  VaultState,
  VaultSummary,
  VaultToken,
} from "./legacy-types";

export interface NftsPayloadLike {
  holdings?: unknown;
  walletsChecked?: unknown;
  freshness?: unknown;
}

export interface CommandersPayloadLike {
  nftCommanders?: unknown;
}

export interface LegacyPayloadLike {
  tokenId?: unknown;
  name?: unknown;
  stats?: unknown;
  total?: unknown;
  history?: unknown;
}

export interface AchievementsPayloadLike {
  achievements?: unknown;
}

export interface LegacyClassInfo {
  className: string;
  art: LobbyArt;
}

export interface LegacyLookup {
  classes: Record<string, LegacyClassInfo>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrNull(value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null) return null;
  return Math.max(0, Math.floor(parsed));
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

export function formatLegacyDate(iso: string | null | undefined): string | null {
  return formatRecordDate(iso);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function displayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  if (value.startsWith("https://") || value.startsWith("/")) return value;
  return null;
}

export function failureVault(state: VaultState): VaultSummary {
  return {
    state,
    tokens: [],
    walletsChecked: null,
    latestObservedAt: null,
    latestObservedLabel: null,
    classDataAvailable: false,
  };
}

/**
 * The player's Genesis holdings. A missing holdings array is unavailable. An
 * empty array after a successful read is empty, unless no verified wallet was
 * checked, which is its own no-wallet state.
 */
export function resolveVault(
  nfts: NftsPayloadLike | null,
  commanders: CommandersPayloadLike | null,
  lookup: LegacyLookup
): VaultSummary {
  if (!nfts) return failureVault("unavailable");
  if (!Array.isArray(nfts.holdings)) return failureVault("unavailable");

  const walletsChecked = intOrNull(nfts.walletsChecked);
  const commanderRows = commanders && Array.isArray(commanders.nftCommanders) ? commanders.nftCommanders : null;
  const classDataAvailable = commanderRows !== null;
  const byToken = new Map<string, Record<string, unknown>>();
  if (commanderRows) {
    for (const raw of commanderRows) {
      const row = asRecord(raw);
      if (row && typeof row.tokenId === "string") byToken.set(row.tokenId, row);
    }
  }

  const tokens: VaultToken[] = [];
  for (const raw of nfts.holdings) {
    const holding = asRecord(raw);
    if (!holding || typeof holding.tokenId !== "string" || holding.tokenId.length === 0) continue;
    const tokenId = holding.tokenId;
    const commander = byToken.get(tokenId);
    const commanderFields = asRecord(commander?.commander);
    const classId = typeof commanderFields?.class === "string" ? commanderFields.class : null;
    const classInfo = classId ? lookup.classes[classId] ?? null : null;
    const observedAt = isoOrNull(holding.observedAt);

    let eligibility: VaultToken["eligibility"] = "no-class";
    if (commander) {
      if (commander.eligible === true) eligibility = "eligible";
      else if (commander.status === "pending") eligibility = "pending";
      else eligibility = "not-eligible";
    }

    tokens.push({
      tokenId,
      name:
        displayName(commander?.name) ??
        displayName(holding.name) ??
        `CHOG #${tokenId}`,
      imageUrl: safeImageUrl(commander?.imageUrl),
      classId,
      className: classInfo?.className ?? (classId ? titleCase(classId) : null),
      classArt: classInfo?.art ?? null,
      eligibility,
      eligibilityFreshness:
        commander?.eligibilityFreshness === "live"
          ? "live"
          : commander?.eligibilityFreshness === "cached"
            ? "cached"
            : null,
      holdingFreshness: holding.freshness === "live" ? "live" : "cached",
      observedAt,
      observedLabel: formatLegacyDate(observedAt),
    });
  }

  tokens.sort((a, b) => a.tokenId.localeCompare(b.tokenId, undefined, { numeric: true }));

  let latestObservedAt: string | null = null;
  for (const token of tokens) {
    if (!token.observedAt) continue;
    if (!latestObservedAt || Date.parse(token.observedAt) > Date.parse(latestObservedAt)) {
      latestObservedAt = token.observedAt;
    }
  }

  const state: VaultState =
    tokens.length > 0 ? "ready" : walletsChecked === 0 ? "no-wallet" : "empty";

  return {
    state,
    tokens,
    walletsChecked,
    latestObservedAt,
    latestObservedLabel: formatLegacyDate(latestObservedAt),
    classDataAvailable,
  };
}

export function defaultTokenId(vault: VaultSummary): string | null {
  return vault.tokens[0]?.tokenId ?? null;
}

export function eligibilityLabel(token: VaultToken): string {
  if (token.eligibility === "eligible") {
    return token.eligibilityFreshness === "live" ? "Commander eligible, live" : "Commander eligible, cached";
  }
  if (token.eligibility === "pending") return "Commander class pending";
  if (token.eligibility === "not-eligible") return "Not eligible as commander";
  return "No commander class";
}

export function failureRecord(state: LegacyRecordState): LegacyRecordView {
  return {
    state,
    tokenId: null,
    name: null,
    stats: null,
    total: 0,
    history: [],
    nextOffset: null,
  };
}

function matchTypeLabel(value: unknown): string | null {
  if (value === "private") return "Private room";
  if (value === "matchmaking") return "Matchmaking";
  return null;
}

function resultOf(value: unknown, kind: "appearance" | "outcome"): {
  result: LegacyEventView["result"];
  label: string | null;
} {
  if (kind === "appearance") {
    if (value === "win") return { result: "victory", label: "Victory" };
    if (value === "loss") return { result: "defeat", label: "Defeat" };
    if (value === "draw") return { result: "draw", label: "Draw" };
    return { result: "unknown", label: "Result unavailable" };
  }
  if (value === "victory") return { result: "victory", label: "Victory" };
  if (value === "defeat") return { result: "defeat", label: "Defeat" };
  return { result: "unknown", label: "Result unavailable" };
}

function resolveEvent(raw: unknown, index: number, lookup: LegacyLookup): LegacyEventView | null {
  const row = asRecord(raw);
  if (!row) return null;
  const category = row.category;
  if (
    category !== "commander_appearance" &&
    category !== "patron_appearance" &&
    category !== "commander_outcome" &&
    category !== "achievement"
  ) {
    return null;
  }
  const status = row.status === "corrected" ? "corrected" : row.status === "recorded" ? "recorded" : null;
  if (!status) return null;

  const payload = asRecord(row.payload) ?? {};
  const occurredAt = isoOrNull(row.occurredAt);
  const verified =
    status === "recorded" && (row.matchStatus === "completed" || row.matchStatus === "finalized");

  let kind: LegacyEventView["kind"];
  let kindLabel: string;
  let result: LegacyEventView["result"] = null;
  let resultLabel: string | null = null;
  let crownsMine: number | null = null;
  let crownsOpponent: number | null = null;
  let themeLabel: string | null = null;
  let className: string | null = null;
  let achievementName: string | null = null;
  let ownershipVerified = false;

  if (category === "commander_appearance") {
    kind = "commander";
    kindLabel = "Commander appearance";
    const parsed = resultOf(payload.result, "appearance");
    result = parsed.result;
    resultLabel = parsed.label;
    const crowns = asRecord(payload.crowns);
    crownsMine = intOrNull(crowns?.mine);
    crownsOpponent = intOrNull(crowns?.opponent);
    const classId = typeof payload.commanderClass === "string" ? payload.commanderClass : null;
    className = classId ? lookup.classes[classId]?.className ?? titleCase(classId) : null;
    ownershipVerified = payload.basis === "direct-owner";
  } else if (category === "patron_appearance") {
    kind = "patron";
    kindLabel = "Arena Patron appearance";
    const theme = typeof payload.theme === "string" ? payload.theme : null;
    themeLabel = theme ? titleCase(theme) : null;
  } else if (category === "commander_outcome") {
    kind = "outcome";
    kindLabel = "Commander outcome";
    const parsed = resultOf(payload.result, "outcome");
    result = parsed.result;
    resultLabel = parsed.label;
  } else {
    kind = "achievement";
    kindLabel = "Achievement";
    const code = typeof payload.code === "string" ? payload.code : null;
    achievementName = code
      ? ACHIEVEMENT_DEFINITIONS.find((definition) => definition.code === code)?.name ?? null
      : null;
  }

  return {
    id: typeof row.id === "string" ? row.id : `legacy-${index}`,
    kind,
    kindLabel,
    status,
    verified,
    result,
    resultLabel,
    crownsMine,
    crownsOpponent,
    matchTypeLabel: matchTypeLabel(payload.matchType),
    themeLabel,
    className,
    achievementName,
    occurredAt,
    dateLabel: formatLegacyDate(occurredAt),
    ownershipVerified,
  };
}

/** The visible trail keeps appearances and milestones, not the duplicate outcome row. */
export function visibleTrail(rows: LegacyEventView[]): LegacyEventView[] {
  return rows.filter((row) => row.kind !== "outcome");
}

/**
 * One page of token legacy. A failed payload is unavailable. A successful
 * payload with total 0 is empty. A total above zero with missing history is a
 * broken read, not an empty record.
 */
export function resolveLegacyRecord(
  payload: LegacyPayloadLike | null,
  offset = 0,
  lookup: LegacyLookup = { classes: {} }
): LegacyRecordView {
  if (!payload) return failureRecord("unavailable");
  const statsRow = asRecord(payload.stats);
  if (!statsRow) return failureRecord("unavailable");

  const commanderAppearances = intOrNull(statsRow.commanderAppearances);
  const patronAppearances = intOrNull(statsRow.patronAppearances);
  const victories = intOrNull(statsRow.victories);
  const defeats = intOrNull(statsRow.defeats);
  if (
    commanderAppearances === null ||
    patronAppearances === null ||
    victories === null ||
    defeats === null
  ) {
    return failureRecord("unavailable");
  }

  const rawHistory = Array.isArray(payload.history) ? payload.history : null;
  const total = intOrNull(payload.total) ?? rawHistory?.length ?? 0;
  if (total > 0 && rawHistory === null) return failureRecord("unavailable");
  if (total === 0 && (commanderAppearances > 0 || patronAppearances > 0 || victories > 0 || defeats > 0)) {
    return failureRecord("unavailable");
  }

  const achievementCodes = Array.isArray(statsRow.achievements)
    ? statsRow.achievements.filter((code): code is string => typeof code === "string")
    : [];

  const stats: LegacyStatsView = {
    commanderAppearances,
    patronAppearances,
    victories,
    defeats,
    achievementCodes,
  };

  const history = (rawHistory ?? [])
    .map((event, index) => resolveEvent(event, index, lookup))
    .filter((event): event is LegacyEventView => event !== null);
  const rawCount = rawHistory?.length ?? 0;
  const nextOffset = offset + rawCount < total ? offset + rawCount : null;

  return {
    state: total > 0 ? "ready" : "empty",
    tokenId: typeof payload.tokenId === "string" ? payload.tokenId : null,
    name: displayName(payload.name),
    stats,
    total,
    history,
    nextOffset,
  };
}

export function appendLegacyPage(previous: LegacyRecordView, page: LegacyRecordView): LegacyRecordView {
  if (page.state !== "ready" && page.state !== "empty") return previous;
  const seen = new Set(previous.history.map((row) => row.id));
  const history = [...previous.history, ...page.history.filter((row) => !seen.has(row.id))];
  return {
    ...previous,
    state: page.total > 0 || history.length > 0 ? "ready" : "empty",
    tokenId: previous.tokenId ?? page.tokenId,
    name: previous.name ?? page.name,
    stats: page.stats ?? previous.stats,
    total: page.total,
    history,
    nextOffset: page.nextOffset,
  };
}

interface ProgressSpec {
  current: number;
  target: number;
  label: string;
}

function progressFor(code: string, stats: LegacyStatsView): ProgressSpec | null {
  switch (code) {
    case "first_blood":
      return { current: stats.commanderAppearances, target: 1, label: "commander appearance" };
    case "first_victory":
      return { current: stats.victories, target: 1, label: "verified victory" };
    case "veteran":
      return { current: stats.commanderAppearances, target: 5, label: "commander appearances" };
    case "paragon":
      return { current: stats.patronAppearances, target: 10, label: "Arena Patron appearances" };
    default:
      return null;
  }
}

/**
 * Achievements from the earned-only read contract plus the four authored
 * definitions. Locked progress is shown only for rules whose counts the token
 * record actually reports. A conflicting locked state is not given a progress
 * bar, because the server has the final word on awards.
 */
export function resolveAchievements(
  record: LegacyRecordView,
  payload: AchievementsPayloadLike | null
): AchievementSummary {
  if (record.state === "locked") return { state: "locked", items: [], earnedCount: 0, note: null };
  if (record.state === "auth") return { state: "auth", items: [], earnedCount: 0, note: null };
  if (record.state === "unavailable" || record.state === "not-found" || !record.stats) {
    return { state: "unavailable", items: [], earnedCount: 0, note: null };
  }

  const rows = payload && Array.isArray(payload.achievements) ? payload.achievements : null;
  const awarded = new Map<string, { name: string | null; awardedAt: string | null }>();
  if (rows) {
    for (const raw of rows) {
      const row = asRecord(raw);
      if (!row || typeof row.code !== "string") continue;
      awarded.set(row.code, {
        name: displayName(row.name),
        awardedAt: isoOrNull(row.awardedAt),
      });
    }
  }

  const earnedCodes = new Set<string>([...awarded.keys(), ...record.stats.achievementCodes]);
  const items: AchievementView[] = [];

  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    const earned = earnedCodes.has(definition.code);
    const award = awarded.get(definition.code);
    if (earned) {
      items.push({
        code: definition.code,
        name: award?.name ?? definition.name,
        description: definition.description,
        state: "earned",
        awardedAt: award?.awardedAt ?? null,
        awardedLabel: formatLegacyDate(award?.awardedAt ?? null),
        progressCurrent: null,
        progressTarget: null,
        progressLabel: null,
        progressAvailable: false,
      });
      continue;
    }

    const progress = progressFor(definition.code, record.stats);
    // If the counts already meet the rule but the server has not awarded it, do
    // not draw a contradictory progress bar.
    const usableProgress = progress && progress.current < progress.target ? progress : null;
    items.push({
      code: definition.code,
      name: definition.name,
      description: definition.description,
      state: "locked",
      awardedAt: null,
      awardedLabel: null,
      progressCurrent: usableProgress?.current ?? null,
      progressTarget: usableProgress?.target ?? null,
      progressLabel: usableProgress
        ? `${usableProgress.current} of ${usableProgress.target} ${usableProgress.label}`
        : null,
      progressAvailable: usableProgress !== null,
    });
  }

  for (const [code, award] of awarded) {
    if (ACHIEVEMENT_DEFINITIONS.some((definition) => definition.code === code)) continue;
    items.push({
      code,
      name: award.name ?? "Achievement",
      description: "Details are unavailable for this award.",
      state: "earned",
      awardedAt: award.awardedAt,
      awardedLabel: formatLegacyDate(award.awardedAt),
      progressCurrent: null,
      progressTarget: null,
      progressLabel: null,
      progressAvailable: false,
    });
  }

  items.sort((a, b) => (a.state === b.state ? 0 : a.state === "earned" ? -1 : 1));
  const earnedCount = items.filter((item) => item.state === "earned").length;
  const missingDates = items.some((item) => item.state === "earned" && !item.awardedAt);

  return {
    state: rows ? "ready" : "partial",
    items,
    earnedCount,
    note: rows
      ? missingDates
        ? "Some award dates are unavailable."
        : null
      : "Award dates are unavailable right now. Earned awards are read from the verified legacy record.",
  };
}
