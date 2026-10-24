// Public battle availability (hotfix): separates the public player release
// gate from the developer-only gate. No Privy, DB, or network imports.
function configuredUrl(): string | null {
  const raw = (process.env.NEXT_PUBLIC_BATTLE_SERVER_URL ?? "").trim();
  if (raw === "") return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Configured battle server endpoint, or null when it is missing/malformed. */
export function battleServerUrl(): string | null {
  return configuredUrl();
}

/**
 * Public battles are permitted in development (localhost default applies)
 * and in production only when a real HTTPS battle server URL is
 * configured. Missing or non-HTTPS values refuse honestly instead of
 * sending players at a dead or insecure endpoint.
 */
export function isPublicBattleAvailable(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const url = configuredUrl();
  return url !== null && url.startsWith("https://");
}
