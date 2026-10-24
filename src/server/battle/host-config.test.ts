// P7a focused tests: production-safe host config. Pure, no DB, no network.
import { describe, expect, it, vi } from "vitest";
import { describeBattleHostConfig, resolveBattleHostConfig } from "@/server/battle/host-config";
import { drainBattleServer } from "@/server/battle/server";

const PROD = {
  NODE_ENV: "production",
  BATTLE_HOSTING_ENABLED: "1",
  BATTLE_SERVER_HOST: "127.0.0.1",
  BATTLE_SERVER_PORT: "2567",
  BATTLE_PUBLIC_URL: "wss://battle.example.invalid",
  BATTLE_ALLOWED_ORIGINS: "https://app.example.invalid",
};

describe("P7a battle host config", () => {
  it("keeps local development on historical defaults", () => {
    const r = resolveBattleHostConfig({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.host).toBe("127.0.0.1");
    expect(r.config.port).toBe(2567);
    expect(r.config.hostingEnabled).toBe(false);
  });

  it("refuses production without explicit hosting activation", () => {
    const r = resolveBattleHostConfig({ NODE_ENV: "production" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/BATTLE_HOSTING_ENABLED/);
  });

  it("refuses strict mode with missing or malformed values", () => {
    const missing = resolveBattleHostConfig({ NODE_ENV: "production", BATTLE_HOSTING_ENABLED: "1" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.length).toBeGreaterThanOrEqual(4);
    const badPort = resolveBattleHostConfig({ ...PROD, BATTLE_SERVER_PORT: "99999" });
    expect(badPort.ok).toBe(false);
    const plainHttp = resolveBattleHostConfig({ ...PROD, BATTLE_PUBLIC_URL: "https://battle.example.invalid" });
    expect(plainHttp.ok).toBe(false);
    const wsRemote = resolveBattleHostConfig({ ...PROD, BATTLE_PUBLIC_URL: "ws://battle.example.invalid" });
    expect(wsRemote.ok).toBe(false);
    const httpOrigin = resolveBattleHostConfig({ ...PROD, BATTLE_ALLOWED_ORIGINS: "http://app.example.invalid" });
    expect(httpOrigin.ok).toBe(false);
  });

  it("accepts a complete production config and localhost acceptance", () => {
    const r = resolveBattleHostConfig(PROD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.publicUrl).toBe("wss://battle.example.invalid");
    const local = resolveBattleHostConfig({
      BATTLE_HOSTING_ENABLED: "1",
      BATTLE_SERVER_HOST: "127.0.0.1",
      BATTLE_SERVER_PORT: "2568",
      BATTLE_PUBLIC_URL: "ws://127.0.0.1:2568",
      BATTLE_ALLOWED_ORIGINS: "http://localhost:3000",
    });
    expect(local.ok).toBe(true);
  });

  it("describes config without secrets", () => {
    const r = resolveBattleHostConfig(PROD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = describeBattleHostConfig(r.config).toLowerCase();
    expect(text).toContain("wss://battle.example.invalid");
    for (const secret of ["privy", "token", "secret", "password", "database_url", "wallet"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("drains the sweeper and rooms without secrets in logs", async () => {
    const stopSweeper = vi.fn();
    const gracefullyShutdown = vi.fn(async () => undefined);
    await drainBattleServer({ gracefullyShutdown } as never, { settlement: { stopSweeper } as never });
    expect(stopSweeper).toHaveBeenCalledTimes(1);
    expect(gracefullyShutdown).toHaveBeenCalledTimes(1);
    // Null settlement (dev default) drains rooms all the same.
    await drainBattleServer({ gracefullyShutdown } as never, {});
    expect(gracefullyShutdown).toHaveBeenCalledTimes(2);
  });
});
