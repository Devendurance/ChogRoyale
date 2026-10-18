// NFT Legacy domain (B1.4c).
//
// Token-centric verified history. Legacy belongs to the NFT (chain +
// contract + tokenId), never to a wallet owner, so transfers, metadata
// changes, and seasons cannot erase it. All battle facts enter through
// trusted server-origin events (B3 settlement in production); this module
// defines the semantics, eligibility, and aggregation purely. Nothing here
// invents matches: an NFT with no events has exactly zero history.

export const LEGACY_SCHEMA_VERSION = "v1" as const;

export const LEGACY_CATEGORIES = [
  "patron_appearance",
  "commander_appearance",
  "commander_outcome",
  "achievement",
] as const;
export type LegacyCategory = (typeof LEGACY_CATEGORIES)[number];

// Only authoritative lifecycle states can ground permanent history. A
// scheduled-but-cancelled match proves nothing happened.
export const FINALIZED_MATCH_STATUSES = ["completed", "finalized"] as const;

export interface LegacyEventInput {
  authorityKey: string;
  category: LegacyCategory;
  tokenId: string | bigint;
  matchId: string | null;
  matchStatus: string | null;
  payload: Record<string, unknown>;
  rulesetRefs: Record<string, string>;
  supersedesAuthorityKey?: string | null;
}

export interface StoredLegacyEvent {
  authorityKey: string;
  category: LegacyCategory;
  tokenId: string;
  matchId: string | null;
  matchStatus: string | null;
  payload: Record<string, unknown>;
  superseded: boolean;
}

export function isHistoryGrounding(status: string | null): boolean {
  return status !== null && (FINALIZED_MATCH_STATUSES as readonly string[]).includes(status);
}

// Event semantics: which categories require a finalized match, and which
// payload fields make the fact auditable. Selection alone (deck choice,
// patron assignment without a completed match) grounds nothing.
export function requiresFinalizedMatch(category: LegacyCategory): boolean {
  return category === "patron_appearance" || category === "commander_appearance" || category === "commander_outcome";
}

export function validateLegacyEventInput(input: LegacyEventInput): void {
  const tokenId = input.tokenId.toString();
  if (!/^[0-9]{1,78}$/.test(tokenId)) throw new Error(`Invalid legacy token ID: ${tokenId}`);
  if (!input.authorityKey || input.authorityKey.trim().length === 0) {
    throw new Error("Legacy event requires a stable authority key");
  }
  if (!(LEGACY_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new Error(`Unknown legacy category: ${input.category}`);
  }
  if (requiresFinalizedMatch(input.category) && !isHistoryGrounding(input.matchStatus)) {
    throw new Error(`Category ${input.category} requires a finalized match, got ${input.matchStatus}`);
  }
  if (input.category === "commander_outcome") {
    const result = (input.payload as { result?: unknown }).result;
    if (result !== "victory" && result !== "defeat") {
      throw new Error("commander_outcome payload requires result victory|defeat");
    }
  }
}

export interface AchievementDefinition {
  code: string;
  version: string;
  name: string;
  description: string;
  eligibility: string;
}

// Small versioned catalog. Game-defined, not onchain traits. Eligibility is
// evaluated deterministically from authoritative events only.
export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    code: "first_blood",
    version: "v1",
    name: "First Blood",
    description: "First verified commander battle appearance.",
    eligibility: ">=1 finalized commander_appearance",
  },
  {
    code: "first_victory",
    version: "v1",
    name: "First Victory",
    description: "First verified commander victory.",
    eligibility: ">=1 commander_outcome victory",
  },
  {
    code: "veteran",
    version: "v1",
    name: "Veteran",
    description: "Five completed commander appearances across distinct matches.",
    eligibility: ">=5 distinct finalized commander_appearance matches",
  },
  {
    code: "paragon",
    version: "v1",
    name: "Paragon",
    description: "Ten verified patron appearances across distinct matches.",
    eligibility: ">=10 distinct finalized patron_appearance matches",
  },
];

export function distinctMatches(events: StoredLegacyEvent[], category: LegacyCategory): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.superseded || e.category !== category || !isHistoryGrounding(e.matchStatus) || !e.matchId) continue;
    out.add(e.matchId);
  }
  return out;
}

// Deterministic eligibility from the authoritative ledger. Returns the codes
// the token has earned (idempotent: re-evaluation yields the same set).
export function evaluateAchievements(events: StoredLegacyEvent[]): string[] {
  const earned: string[] = [];
  const appearances = distinctMatches(events, "commander_appearance");
  const active = events.filter((e) => !e.superseded);
  const victories = active.filter(
    (e) => e.category === "commander_outcome" && isHistoryGrounding(e.matchStatus) && (e.payload as { result?: string }).result === "victory"
  );
  const patron = distinctMatches(events, "patron_appearance");
  if (appearances.size >= 1) earned.push("first_blood");
  if (victories.length >= 1) earned.push("first_victory");
  if (appearances.size >= 5) earned.push("veteran");
  if (patron.size >= 10) earned.push("paragon");
  return earned;
}

export interface NftLegacyStats {
  patronAppearances: number;
  commanderAppearances: number;
  victories: number;
  defeats: number;
  achievements: string[];
}

// Aggregates count each commander once per match (distinct match IDs), so a
// commander appearing multiple times in one match cannot inflate statistics.
export function aggregateLegacyStats(events: StoredLegacyEvent[]): NftLegacyStats {
  const active = events.filter((e) => !e.superseded);
  const outcomes = active.filter(
    (e) => e.category === "commander_outcome" && isHistoryGrounding(e.matchStatus)
  );
  return {
    patronAppearances: distinctMatches(events, "patron_appearance").size,
    commanderAppearances: distinctMatches(events, "commander_appearance").size,
    victories: outcomes.filter((e) => (e.payload as { result?: string }).result === "victory").length,
    defeats: outcomes.filter((e) => (e.payload as { result?: string }).result === "defeat").length,
    achievements: evaluateAchievements(events),
  };
}
