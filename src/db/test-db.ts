import { getEnv } from "@/lib/env";

// Fail-closed test database guard. Write-based integration tests must resolve
// their connection through here. Throws unless DATABASE_URL_TEST is set and
// provably different from the production DATABASE_URL, so a missing or
// misconfigured test database can never silently target production.
export function requireTestDatabaseUrl(): string {
  let testUrl: string | undefined;
  let prodUrl: string | undefined;
  try {
    testUrl = process.env.DATABASE_URL_TEST;
    prodUrl = getEnv().DATABASE_URL;
  } catch {
    throw new Error("test database unavailable: environment invalid");
  }
  if (!testUrl) {
    throw new Error("test database unavailable: DATABASE_URL_TEST is not set");
  }
  // Compare Neon endpoints too: the pooled and direct URLs of one branch
  // differ as strings but reach the same database.
  const prodEndpoints = [prodUrl, process.env.DATABASE_URL_POOLED].map(neonEndpoint).filter((e): e is string => e !== null);
  const testEndpoint = neonEndpoint(testUrl);
  if (testUrl.trim() === prodUrl?.trim() || (testEndpoint !== null && prodEndpoints.includes(testEndpoint))) {
    throw new Error("test database refused: DATABASE_URL_TEST resolves to the production database");
  }
  return testUrl;
}

function neonEndpoint(url: string | undefined): string | null {
  try {
    return url ? (new URL(url.trim()).hostname.split(".")[0] ?? "").replace(/-pooler$/, "") || null : null;
  } catch {
    return null;
  }
}

export function isTestDatabaseConfigured(): boolean {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
}
