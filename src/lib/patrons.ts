// Arena Patron domain (B1.4a).
//
// Every ranked match references one real Chog Genesis NFT as its Arena
// Patron. The patron configuration is derived ONLY from the NFT's authentic
// indexed metadata: identity, name, tier, aura, background theme, and the
// metadata content hash. It carries NO stats, NO power numbers, and NO
// ownership data, so rarity can flavor future battlefield conditions without
// granting ranked advantages (fairness by construction, tested).
//
// Determinism: the same (tokenId, attributes, contentHash) always yields the
// same config. No Math.random anywhere in derivation. Server seeds drive
// selection; players never choose ranked patrons.

import { createHash } from "crypto";
import { AppError } from "@/lib/errors";

export const PATRON_RULESET_VERSION = "v1" as const;

export const PATRON_THEMES = ["ember", "frost", "surge", "rift", "rally", "prismatic"] as const;
export type PatronTheme = (typeof PATRON_THEMES)[number];

// Background keyword -> theme. First match in attribute order wins; anything
// unmapped falls back to "prismatic" (documented neutral, never invented).
const BACKGROUND_THEME_KEYWORDS: Array<{ match: RegExp; theme: PatronTheme }> = [
  { match: /red|crimson|ember|magma|lava|rose|scarlet|magenta|pink|ruby/i, theme: "ember" },
  { match: /blue|azure|frost|ice|glacier|aqua|cyan/i, theme: "frost" },
  { match: /yellow|gold|volt|surge|electric|amber|lightning/i, theme: "surge" },
  { match: /purple|violet|rift|void|cosmic|nebula/i, theme: "rift" },
  { match: /green|jade|rally|forest|lime|mint/i, theme: "rally" },
];

export interface PatronTraitInput {
  trait_type: string;
  value: string | number;
}

export interface PatronSnapshot {
  tokenId: string;
  name: string | null;
  tier: string | null;
  aura: string | null;
  background: string | null;
}

export interface PatronConfig {
  rulesetVersion: typeof PATRON_RULESET_VERSION;
  tokenId: string;
  name: string | null;
  tier: string | null;
  aura: string | null;
  auraFallback: boolean;
  theme: PatronTheme;
  themeSignal: string | null;
  metadataContentHash: string;
  configHash: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function snapshotTraits(tokenId: string, attributes: PatronTraitInput[] | null, name: string | null): PatronSnapshot {
  let tier: string | null = null;
  let aura: string | null = null;
  let background: string | null = null;
  for (const a of attributes ?? []) {
    if (typeof a.value !== "string") continue;
    if (a.trait_type === "Tier" && tier === null) tier = a.value;
    else if (a.trait_type === "Aura" && aura === null) aura = a.value;
    else if (a.trait_type === "Background" && background === null) background = a.value;
  }
  return { tokenId, name, tier, aura, background };
}

export function themeForBackground(background: string | null): { theme: PatronTheme; signal: string | null } {
  if (!background) return { theme: "prismatic", signal: null };
  for (const { match, theme } of BACKGROUND_THEME_KEYWORDS) {
    if (match.test(background)) return { theme, signal: background };
  }
  return { theme: "prismatic", signal: background };
}

export function derivePatronConfig(input: {
  tokenId: string | bigint;
  attributes: PatronTraitInput[] | null;
  metadataContentHash: string;
  name?: string | null;
}): PatronConfig {
  const tokenId = input.tokenId.toString();
  if (!/^[0-9]{1,78}$/.test(tokenId)) {
    throw new AppError("BAD_REQUEST", `Invalid patron token ID: ${tokenId}`);
  }
  if (!input.metadataContentHash || input.metadataContentHash === "unresolved") {
    throw new AppError("UNPROCESSABLE", `Patron requires resolved metadata for token ${tokenId}`);
  }
  const snapshot = snapshotTraits(tokenId, input.attributes, input.name ?? null);
  const { theme, signal } = themeForBackground(snapshot.background);
  const body = {
    tokenId: snapshot.tokenId,
    name: snapshot.name,
    tier: snapshot.tier,
    aura: snapshot.aura,
    theme,
    themeSignal: signal,
    metadataContentHash: input.metadataContentHash,
  };
  const configHash = createHash("sha256")
    .update(`patron:${PATRON_RULESET_VERSION}:${stableStringify(body)}`)
    .digest("hex");
  return {
    rulesetVersion: PATRON_RULESET_VERSION,
    ...body,
    auraFallback: snapshot.aura === null,
    configHash,
  };
}

// Server-controlled ranked selection: deterministic index from the
// server-generated match seed over the sorted eligible set. B3 supplies the
// eligible pool (e.g. all resolved Genesis tokens); players never choose.
export function selectPatronTokenId(seed: string, eligibleTokenIds: Array<string | bigint>): string {
  if (!seed || seed.trim().length === 0) {
    throw new AppError("BAD_REQUEST", "Patron selection requires a server-generated seed");
  }
  const sorted = [...new Set(eligibleTokenIds.map((t) => t.toString()))].sort((a, b) =>
    a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length - b.length
  );
  if (sorted.length === 0) {
    throw new AppError("UNPROCESSABLE", "Patron selection requires a non-empty eligible set");
  }
  const digest = createHash("sha256")
    .update(`patron-select:${PATRON_RULESET_VERSION}:${seed}:${sorted.join(",")}`)
    .digest("hex");
  return sorted[Number(BigInt(`0x${digest}`) % BigInt(sorted.length))] as string;
}

export function patronRulesetSummary() {
  return {
    version: PATRON_RULESET_VERSION,
    themes: [...PATRON_THEMES],
    keywordRules: BACKGROUND_THEME_KEYWORDS.map((r) => ({ pattern: r.match.source, theme: r.theme })),
    fallback: "prismatic",
    fairness: [
      "no-stats",
      "no-power-numbers",
      "no-ownership-input",
      "tier-prestige-only",
      "server-seed-selection",
    ],
  };
}
