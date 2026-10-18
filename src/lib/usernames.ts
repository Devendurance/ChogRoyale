import { AppError } from "@/lib/errors";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

// Launch-default reserved names. Exact match on the normalized key.
const RESERVED = new Set(
  [
    "admin",
    "administrator",
    "mod",
    "moderator",
    "support",
    "system",
    "official",
    "owner",
    "staff",
    "root",
    "api",
    "help",
    "security",
    "bot",
    "server",
    "null",
    "undefined",
    "chog",
    "royale",
    "chogroyale",
    "chog_royale",
  ].map((s) => s.toLowerCase())
);

// Launch-default profanity blocklist. Substring match on the normalized key.
// Deliberately short; extend via moderation tooling, not code churn.
const BLOCKED_SUBSTRINGS = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "hitler",
  "nazi",
];

export function normalizeUsernameKey(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}

export type UsernameVerdict =
  | { valid: true; key: string }
  | { valid: false; reason: "invalid" | "reserved" | "profanity"; message: string };

// Pure format/reserved/profanity check. Database uniqueness is enforced
// separately by the UNIQUE(username_key) constraint, never by this alone.
export function describeUsername(username: unknown): UsernameVerdict {
  if (typeof username !== "string") {
    return { valid: false, reason: "invalid", message: "Username must be text" };
  }
  const key = normalizeUsernameKey(username);
  if (!USERNAME_PATTERN.test(key)) {
    return {
      valid: false,
      reason: "invalid",
      message: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters: lowercase letters, numbers, underscores`,
    };
  }
  if (RESERVED.has(key)) {
    return { valid: false, reason: "reserved", message: "That username is reserved" };
  }
  if (BLOCKED_SUBSTRINGS.some((w) => key.includes(w))) {
    return { valid: false, reason: "profanity", message: "That username is not allowed" };
  }
  return { valid: true, key };
}

// Throws BAD_REQUEST with a helpful message; returns the canonical key.
export function validateUsername(username: unknown): string {
  const verdict = describeUsername(username);
  if (!verdict.valid) {
    throw new AppError("BAD_REQUEST", verdict.message);
  }
  return verdict.key;
}

export function displayUsername(username: unknown): string {
  if (typeof username !== "string") {
    throw new AppError("BAD_REQUEST", "Username must be text");
  }
  return username.normalize("NFKC").trim();
}
