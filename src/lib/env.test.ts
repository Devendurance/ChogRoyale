import { describe, it, expect, afterEach } from "vitest";
import { resetEnvCache } from "@/lib/env";

/**
 * Why the cache reset matters here
 * -------------------------------
 * getEnv() memoizes the parsed environment in a module-level `cached` variable
 * (src/lib/env.ts). Under CHOG_TEST_DB=1 that cache is already warm before any
 * test in this file runs:
 *
 *   vitest.setup.ts -> routeDalToTestDb() -> requireTestDatabaseUrl() -> getEnv()
 *
 * A warm cache makes getEnv() return the memoized value without re-validating
 * process.env, so "rejects missing required vars" stops proving that getEnv()
 * actually re-validates and rejects a missing DATABASE_URL. The test then
 * fails on a warm cache and passes on a cold one, which is the opposite of a
 * meaningful regression test.
 *
 * The fix is to call resetEnvCache() (the exported way to clear the memoized
 * environment) so the assertion exercises the real validation path every time.
 * The production fail-closed database guard in src/db/client.ts and
 * src/db/test-db.ts is untouched and still owns CHOG_TEST_DB=1 routing.
 *
 * process.env is restored in a finally block, so a failing assertion can never
 * leave DATABASE_URL deleted for the rest of the file.
 */

const MANAGED_KEYS = ["DATABASE_URL", "NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET"] as const;

function saveEnv(keys: readonly string[]): Map<string, string | undefined> {
  const saved = new Map<string, string | undefined>();
  for (const key of keys) saved.set(key, process.env[key]);
  return saved;
}

function restoreEnv(saved: Map<string, string | undefined>): void {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  resetEnvCache();
});

describe("env validation", () => {
  it("rejects missing required vars", async () => {
    const saved = saveEnv(MANAGED_KEYS);
    try {
      delete process.env.DATABASE_URL;
      process.env.NEXT_PUBLIC_PRIVY_APP_ID = "test-app";
      process.env.PRIVY_APP_SECRET = "test-secret";
      // Drop the memoized env so getEnv() re-parses the mutated process.env
      // instead of returning a value cached by the setup file.
      resetEnvCache();
      const { getEnv } = await import("@/lib/env");
      expect(() => getEnv()).toThrow(/DATABASE_URL/);
    } finally {
      restoreEnv(saved);
      resetEnvCache();
    }
  });

  it("accepts valid env", async () => {
    const saved = saveEnv(MANAGED_KEYS);
    try {
      process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://user:pass@localhost:5432/db";
      process.env.NEXT_PUBLIC_PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test-app";
      process.env.PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET ?? "test-secret";
      // Same reason as above: parse afresh so this asserts on the current
      // process.env rather than on a value memoized earlier in the run.
      resetEnvCache();
      const { getEnv } = await import("@/lib/env");
      const env = getEnv();
      expect(env.MONAD_CHAIN_ID).toBe(143);
      expect(env.MONAD_RPC_URL).toContain("monad");
    } finally {
      restoreEnv(saved);
      resetEnvCache();
    }
  });
});
