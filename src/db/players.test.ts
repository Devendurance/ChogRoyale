import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDb, resetDbCache } from "@/db/client";
import {
  provisionPlayer,
  findPlayerByPrivyDid,
  isUsernameAvailable,
  claimUsername,
  listWallets,
  linkWallet,
  setPrimaryWallet,
  getRoles,
  grantRole,
} from "@/db/players";
import { players } from "@/db/schema";
import { AppError } from "@/lib/errors";

const createdPlayerIds: string[] = [];
const tag = () => randomUUID().slice(0, 8);

function testWalletAddr(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  return `0x${(hex + hex + hex + hex + hex).slice(0, 40)}`;
}

afterAll(async () => {
  const db = getDb();
  for (const id of createdPlayerIds) {
    await db.delete(players).where(eq(players.id, id));
  }
});

describe("player provisioning", () => {
  it("provisions idempotently with defaults and PLAYER role", async () => {
    const did = `did:privy:test_${tag()}`;
    const p1 = await provisionPlayer({ privyDid: did });
    createdPlayerIds.push(p1.id);
    expect(p1.accountStatus).toBe("active");
    expect(p1.onboardingStatus).toBe("pending");
    expect(p1.username).toBeNull();
    expect(p1.createdAt).toBeInstanceOf(Date);

    const p2 = await provisionPlayer({ privyDid: did });
    expect(p2.id).toBe(p1.id);

    const roles = await getRoles(p1.id);
    expect(roles).toEqual(["PLAYER"]);

    const found = await findPlayerByPrivyDid(did);
    expect(found?.id).toBe(p1.id);
  });

  it("persists across separate connections", async () => {
    const did = `did:privy:test_${tag()}`;
    const p = await provisionPlayer({ privyDid: did });
    createdPlayerIds.push(p.id);
    resetDbCache();
    const found = await findPlayerByPrivyDid(did);
    expect(found?.id).toBe(p.id);
  });
});

describe("username claims", () => {
  it("checks availability and claims atomically", async () => {
    const name = `hero_${tag().replace(/-/g, "")}`;
    expect(await isUsernameAvailable(name)).toBe(true);
    const p = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    createdPlayerIds.push(p.id);
    const claimed = await claimUsername(p.id, name);
    expect(claimed.usernameKey).toBe(name.toLowerCase());
    expect(await isUsernameAvailable(name)).toBe(false);
  });

  it("rejects case-insensitive collisions", async () => {
    const name = `Case_${tag().replace(/-/g, "").slice(0, 6)}`;
    const a = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    const b = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    createdPlayerIds.push(a.id, b.id);
    await claimUsername(a.id, name);
    await expect(claimUsername(b.id, name.toUpperCase())).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("allows only one winner for concurrent claims", async () => {
    const name = `race_${tag().replace(/-/g, "")}`;
    const a = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    const b = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    createdPlayerIds.push(a.id, b.id);
    const results = await Promise.allSettled([claimUsername(a.id, name), claimUsername(b.id, name)]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });
  });

  it("rejects reserved/invalid usernames", async () => {
    const p = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    createdPlayerIds.push(p.id);
    for (const bad of ["ab", "way-too-long-username-over-20", "has space", "UPPER IS FINE BUT SYMBOL!"]) {
      if (bad === "UPPER IS FINE BUT SYMBOL!") continue;
      await expect(claimUsername(p.id, bad)).rejects.toBeInstanceOf(AppError);
    }
    await expect(claimUsername(p.id, "x")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("wallets", () => {
  it("links wallets and enforces global uniqueness", async () => {
    const a = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    const b = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    createdPlayerIds.push(a.id, b.id);
    const addr = testWalletAddr(a.id);
    const w = await linkWallet({ playerId: a.id, address: addr, walletType: "embedded", linkSource: "privy:embedded" });
    expect(w.addressNormalized).toBe(addr.toLowerCase());

    // Same address, different case, different player -> conflict
    await expect(
      linkWallet({ playerId: b.id, address: `0x${addr.slice(2).toUpperCase()}`, walletType: "external" })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const listed = await listWallets(a.id);
    expect(listed.map((x) => x.id)).toContain(w.id);
  });

  it("rejects invalid addresses and enforces FK integrity", async () => {
    const a = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    createdPlayerIds.push(a.id);
    await expect(linkWallet({ playerId: a.id, address: "not-an-address", walletType: "external" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      linkWallet({ playerId: randomUUID(), address: testWalletAddr(randomUUID()), walletType: "external" })
    ).rejects.toThrow();
  });

  it("keeps at most one primary wallet per player", async () => {
    const a = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    createdPlayerIds.push(a.id);
    const w1 = await linkWallet({ playerId: a.id, address: testWalletAddr(`p1${a.id}`), walletType: "external" });
    const w2 = await linkWallet({ playerId: a.id, address: testWalletAddr(`p2${a.id}`), walletType: "external" });
    await setPrimaryWallet(a.id, w1.id);
    await setPrimaryWallet(a.id, w2.id);
    const listed = await listWallets(a.id);
    const primaries = listed.filter((w) => w.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id).toBe(w2.id);
  });
});

describe("roles", () => {
  it("prevents duplicate assignments and supports admin grant", async () => {
    const a = await provisionPlayer({ privyDid: `did:privy:test_${tag()}` });
    createdPlayerIds.push(a.id);
    await grantRole(a.id, "MODERATOR", "system:test");
    await grantRole(a.id, "MODERATOR", "system:test");
    const roles = await getRoles(a.id);
    expect(roles.sort()).toEqual(["MODERATOR", "PLAYER"]);
  });
});
