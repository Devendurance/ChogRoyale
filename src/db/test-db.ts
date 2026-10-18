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
  if (testUrl.trim() === prodUrl?.trim()) {
    throw new Error("test database refused: DATABASE_URL_TEST resolves to the production database");
  }
  return testUrl;
}

export function isTestDatabaseConfigured(): boolean {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
}
