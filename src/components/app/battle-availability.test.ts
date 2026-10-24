// Hotfix tests: public battle availability gate. Pure, no DB, no network.
import { describe, expect, it } from "vitest";
import { battleServerUrl, isPublicBattleAvailable } from "@/components/app/battle-availability";

describe("public battle availability", () => {
  it("opens in development without configuration", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(isPublicBattleAvailable()).toBe(true);
  });

  it("parses the configured server URL honestly", () => {
    process.env.NEXT_PUBLIC_BATTLE_SERVER_URL = "https://battle.example.invalid";
    expect(battleServerUrl()).toBe("https://battle.example.invalid");
    process.env.NEXT_PUBLIC_BATTLE_SERVER_URL = "not a url";
    expect(battleServerUrl()).toBeNull();
    process.env.NEXT_PUBLIC_BATTLE_SERVER_URL = "ftp://battle.example.invalid";
    expect(battleServerUrl()).toBeNull();
    delete process.env.NEXT_PUBLIC_BATTLE_SERVER_URL;
    expect(battleServerUrl()).toBeNull();
  });

  it("refuses production without a real HTTPS battle URL", () => {
    const env = process.env as Record<string, string | undefined>;
    const prevNode = env.NODE_ENV;
    const prevUrl = env.NEXT_PUBLIC_BATTLE_SERVER_URL;
    env.NODE_ENV = "production";
    try {
      delete env.NEXT_PUBLIC_BATTLE_SERVER_URL;
      expect(isPublicBattleAvailable()).toBe(false);
      env.NEXT_PUBLIC_BATTLE_SERVER_URL = "http://battle.example.invalid";
      expect(isPublicBattleAvailable()).toBe(false);
      env.NEXT_PUBLIC_BATTLE_SERVER_URL = "ws://battle.example.invalid";
      expect(isPublicBattleAvailable()).toBe(false);
      env.NEXT_PUBLIC_BATTLE_SERVER_URL = "https://battle.example.invalid";
      expect(isPublicBattleAvailable()).toBe(true);
    } finally {
      env.NODE_ENV = prevNode;
      if (prevUrl === undefined) delete env.NEXT_PUBLIC_BATTLE_SERVER_URL;
      else env.NEXT_PUBLIC_BATTLE_SERVER_URL = prevUrl;
    }
  });
});
