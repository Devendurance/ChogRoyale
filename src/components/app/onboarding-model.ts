// Pure onboarding derivation (client-safe). Step order mirrors the server
// ladder in src/lib/onboarding.ts; the server stays the source of truth and
// only its onboarding.complete unlocks entry to /app.

export type OnboardingStep = "username" | "avatar" | "wallet" | "done";

export function deriveStep(hasUsername: boolean, hasAvatar: boolean, walletCount: number): OnboardingStep {
  if (!hasUsername) return "username";
  if (!hasAvatar) return "avatar";
  if (walletCount <= 0) return "wallet";
  return "done";
}

/** Client-side username hint; the server enforces 3-20 [a-z0-9_]. */
export function usernameHint(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v.length === 0) return "Choose a username.";
  if (v.length < 3 || v.length > 20) return "Usernames are 3-20 characters.";
  if (!/^[a-z0-9_]+$/.test(v)) return "Lowercase letters, numbers and underscores only.";
  return null;
}

/** Human message for onboard/bootstrap error codes. No internals leak. */
export function onboardErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case "CONFLICT":
      return "That username is taken. Try another.";
    case "BAD_REQUEST":
      return "That entry is not valid. Check the rules and try again.";
    case "UNAUTHORIZED":
      return "Your session expired. Sign in again.";
    case "NETWORK":
      return "The server could not be reached. Try again.";
    default:
      return fallback;
  }
}
