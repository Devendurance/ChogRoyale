import { describe, it, expect, afterEach } from "vitest";
import { resetEnvCache } from "@/lib/env";

afterEach(() => {
  resetEnvCache();
});

describe("env validation", () => {
  it("rejects missing required vars", async () => {
    const saved = { ...process.env };
    delete (process.env as Record<string, string | undefined>).DATABASE_URL;
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = "test-app";
    process.env.PRIVY_APP_SECRET = "test-secret";
    const { getEnv } = await import("@/lib/env");
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
    process.env = saved;
    resetEnvCache();
  });

  it("accepts valid env", async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://user:pass@localhost:5432/db";
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test-app";
    process.env.PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET ?? "test-secret";
    const { getEnv } = await import("@/lib/env");
    const env = getEnv();
    expect(env.MONAD_CHAIN_ID).toBe(143);
    expect(env.MONAD_RPC_URL).toContain("monad");
  });
});
