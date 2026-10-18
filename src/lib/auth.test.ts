import { describe, it, expect, vi } from "vitest";
import {
  extractBearerToken,
  safePlayer,
  requirePlayer,
  requireActivePlayer,
  requireOnboardedPlayer,
  requireRole,
} from "@/lib/auth";
import { verifyPrivyToken } from "@/lib/privy-server";
import { requireTestDatabaseUrl, isTestDatabaseConfigured } from "@/db/test-db";
import type { Player } from "@/db/schema";

function req(headers: Record<string, string> = {}, url = "http://localhost/api/auth/me"): Request {
  return new Request(url, { headers });
}

describe("extractBearerToken", () => {
  it("extracts a bearer token", () => {
    expect(extractBearerToken(req({ authorization: "Bearer abc.def.ghi" }))).toBe("abc.def.ghi");
  });

  it("rejects missing and malformed headers", () => {
    expect(extractBearerToken(req())).toBeNull();
    expect(extractBearerToken(req({ authorization: "Bearer" }))).toBeNull();
    expect(extractBearerToken(req({ authorization: "Token abc" }))).toBeNull();
    expect(extractBearerToken(req({ authorization: "Bearer   " }))).toBeNull();
  });

  it("never reads tokens from query parameters", () => {
    expect(extractBearerToken(req({}, "http://localhost/api/auth/me?token=abc"))).toBeNull();
  });
});

describe("verifyPrivyToken", () => {
  const claims = {
    appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test-app",
    issuer: "privy.io",
    issuedAt: Math.floor(Date.now() / 1000),
    expiration: Math.floor(Date.now() / 1000) + 3600,
    sessionId: "sess_test",
    userId: "did:privy:test_user",
  };

  it("returns identity for valid verified claims", async () => {
    const id = await verifyPrivyToken("good.token", async () => claims);
    expect(id).toEqual({ privyDid: "did:privy:test_user", sessionId: "sess_test", appId: claims.appId });
  });

  it("rejects verifier failures (invalid/expired/forged)", async () => {
    const failing = vi.fn(async () => {
      throw new Error("invalid signature");
    });
    await expect(verifyPrivyToken("bad.token", failing)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects wrong-app tokens", async () => {
    await expect(
      verifyPrivyToken("other-app.token", async () => ({ ...claims, appId: "other-app-id" }))
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects claims without a user id", async () => {
    await expect(
      verifyPrivyToken("noid.token", async () => ({ ...claims, userId: "" }))
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects empty tokens without calling the verifier", async () => {
    const spy = vi.fn();
    await expect(verifyPrivyToken("", spy)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("safePlayer", () => {
  it("excludes internal identity and secrets", () => {
    const player = {
      id: "00000000-0000-0000-0000-000000000001",
      privyDid: "did:privy:secret",
      username: "hero",
      usernameKey: "hero",
      displayName: "Hero",
      avatarId: "chog-01",
      accountStatus: "active",
      onboardingStatus: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Player;
    const out = safePlayer(player) as Record<string, unknown>;
    expect(out.privyDid).toBeUndefined();
    expect(out.id).toBe(player.id);
    expect(out.username).toBe("hero");
  });
});

describe("requirePlayer / requireActivePlayer", () => {
  const verifier = async () => ({
    appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test-app",
    issuer: "privy.io",
    issuedAt: 1,
    expiration: 9999999999,
    sessionId: "s",
    userId: "did:privy:u1",
  });
  const authed = () => req({ authorization: "Bearer t" });
  const base = {
    id: "00000000-0000-0000-0000-000000000001",
    privyDid: "did:privy:u1",
    username: "hero",
    usernameKey: "hero",
    displayName: "Hero",
    avatarId: "chog-01",
    accountStatus: "active",
    onboardingStatus: "complete",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Player;

  it("returns player for authenticated provisioned identity", async () => {
    const ctx = await requirePlayer(authed(), verifier, async () => base);
    expect(ctx.player.id).toBe(base.id);
    expect(ctx.identity.privyDid).toBe("did:privy:u1");
  });

  it("rejects missing tokens without touching the database", async () => {
    const loader = vi.fn();
    await expect(requirePlayer(req(), verifier, loader)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("returns 404 for verified identities without a player (bootstrap next)", async () => {
    await expect(requirePlayer(authed(), verifier, async () => null)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("enforces suspended/banned states with 403", async () => {
    for (const status of ["suspended", "banned"]) {
      const banned = { ...base, accountStatus: status } as Player;
      await expect(requireActivePlayer(authed(), verifier, async () => banned)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    const ctx = await requireActivePlayer(authed(), verifier, async () => base);
    expect(ctx.player.accountStatus).toBe("active");
  });

  it("never derives roles from client input", async () => {
    const evil = req({ authorization: "Bearer t", "x-role": "ADMIN" });
    const ctx = await requirePlayer(evil, verifier, async () => base);
    expect((ctx.player as Record<string, unknown>).role).toBeUndefined();
    expect(ctx.player.accountStatus).toBe("active");
  });
});

describe("requireOnboardedPlayer / requireRole", () => {
  const verifier = async () => ({
    appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test-app",
    issuer: "privy.io",
    issuedAt: 1,
    expiration: 9999999999,
    sessionId: "s",
    userId: "did:privy:u1",
  });
  const authed = () => req({ authorization: "Bearer t" });
  const full = {
    id: "00000000-0000-0000-0000-000000000001",
    privyDid: "did:privy:u1",
    username: "hero",
    usernameKey: "hero",
    displayName: "Hero",
    avatarId: "chog-ember",
    accountStatus: "active",
    onboardingStatus: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Player;

  it("requires username, avatar and complete status for onboarded access", async () => {
    await expect(
      requireOnboardedPlayer(authed(), verifier, async () => ({ ...full, usernameKey: null })) as Promise<unknown>
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      requireOnboardedPlayer(authed(), verifier, async () => ({ ...full, avatarId: null })) as Promise<unknown>
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      requireOnboardedPlayer(authed(), verifier, async () => full) as Promise<unknown>
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const done = { ...full, onboardingStatus: "complete" } as Player;
    const ctx = await requireOnboardedPlayer(authed(), verifier, async () => done);
    expect(ctx.player.id).toBe(full.id);
  });

  it("grants privileged access only from persisted roles", async () => {
    const admin = () => requireRole(authed(), ["ADMIN"], { verifier, loader: async () => full, roleReader: async () => ["PLAYER", "ADMIN"] });
    expect((await admin()).player.id).toBe(full.id);
    await expect(
      requireRole(authed(), ["ADMIN"], { verifier, loader: async () => full, roleReader: async () => ["PLAYER"] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      requireRole(authed(), ["MODERATOR"], { verifier, loader: async () => full, roleReader: async () => ["PLAYER"] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("test database isolation", () => {
  it("fails closed when DATABASE_URL_TEST is missing", () => {
    if (process.env.DATABASE_URL_TEST) return; // configured envs skip this guard test
    expect(() => requireTestDatabaseUrl()).toThrow(/DATABASE_URL_TEST is not set/);
    expect(isTestDatabaseConfigured()).toBe(false);
  });

  it("refuses a test url that resolves to production", () => {
    process.env.DATABASE_URL_TEST = process.env.DATABASE_URL;
    expect(() => requireTestDatabaseUrl()).toThrow(/resolves to the production database/);
    delete process.env.DATABASE_URL_TEST;
  });

  it("refuses the pooled endpoint of the production branch", () => {
    const original = process.env.DATABASE_URL_TEST;
    const prod = new URL(process.env.DATABASE_URL!);
    prod.hostname = prod.hostname.replace(/^([^.]+?)(-pooler)?\./, "$1-pooler.");
    process.env.DATABASE_URL_TEST = prod.toString();
    try {
      expect(() => requireTestDatabaseUrl()).toThrow(/resolves to the production database/);
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL_TEST;
      else process.env.DATABASE_URL_TEST = original;
    }
  });
});
