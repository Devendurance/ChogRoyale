import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { players } from "@/db/schema";
import {
  provisionPlayer,
  listWallets,
  findWalletByAddress,
  claimInitialUsername,
  updateProfileFields,
} from "@/db/players";
import {
  extractVerifiedWallets,
  syncWalletsForPlayer,
  parseSetPrimaryBody,
  type PrivyUserFetcher,
} from "@/lib/wallets";

const createdPlayerIds: string[] = [];
const tag = () => randomUUID().slice(0, 8);
const addr = (seed: string) => {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `0x${(h.toString(16).padStart(8, "0").repeat(5)).slice(0, 40)}`;
};

function fetcherFor(wallets: Array<{ address: string; embedded?: boolean; verified?: boolean; chain?: string }>): PrivyUserFetcher {
  return async () => ({
    linkedAccounts: wallets.map((w) => ({
      type: "wallet",
      address: w.address,
      chainType: w.chain ?? "ethereum",
      walletClientType: w.embedded ? "privy" : "metamask",
      verifiedAt: w.verified === false ? null : new Date(),
    })),
  });
}

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  for (const id of createdPlayerIds) {
    await db.delete(players).where(eq(players.id, id));
  }
  resetDbCache();
});

describe("extractVerifiedWallets", () => {
  it("accepts only verified ethereum wallets, dedupes, classifies embedded", () => {
    const a = addr("class-a");
    const out = extractVerifiedWallets({
      linkedAccounts: [
        { type: "wallet", address: a, chainType: "ethereum", walletClientType: "privy", verifiedAt: new Date() },
        { type: "wallet", address: a.toUpperCase().replace("0X", "0x"), chainType: "ethereum", walletClientType: "privy", verifiedAt: new Date() },
        { type: "wallet", address: addr("unverified"), chainType: "ethereum", walletClientType: "privy", verifiedAt: null },
        { type: "wallet", address: "9x".padEnd(44, "1"), chainType: "solana", walletClientType: "privy", verifiedAt: new Date() },
        { type: "email", address: "a@b.c", chainType: "ethereum", walletClientType: "email", verifiedAt: new Date() },
        { type: "wallet", address: "not-an-address", chainType: "ethereum", walletClientType: "privy", verifiedAt: new Date() },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ walletType: "embedded" });
  });

  it("marks non-privy wallets external", () => {
    const out = extractVerifiedWallets({
      linkedAccounts: [
        { type: "wallet", address: addr("ext"), chainType: "ethereum", walletClientType: "metamask", verifiedAt: new Date() },
      ],
    });
    expect(out[0]?.walletType).toBe("external");
  });
});

describe("syncWalletsForPlayer (isolated branch)", () => {
  it("links embedded + external wallets and assigns primary", async () => {
    const p = await provisionPlayer({ privyDid: `did:privy:sync_${tag()}` });
    createdPlayerIds.push(p.id);
    const a = addr(`e1${p.id}`);
    const b = addr(`x1${p.id}`);
    const res = await syncWalletsForPlayer(
      p.id,
      p.privyDid,
      fetcherFor([{ address: a, embedded: true }, { address: b }])
    );
    expect(res.linked).toHaveLength(2);
    expect(res.conflicts).toHaveLength(0);
    expect(res.primaryWalletId).not.toBeNull();
    const wallets = await listWallets(p.id);
    expect(wallets.filter((w) => w.verifiedAt !== null)).toHaveLength(2);
    expect(wallets.filter((w) => w.isPrimary)).toHaveLength(1);
  });

  it("is idempotent across repeat syncs", async () => {
    const p = await provisionPlayer({ privyDid: `did:privy:idem_${tag()}` });
    createdPlayerIds.push(p.id);
    const f = fetcherFor([{ address: addr(`i${p.id}`), embedded: true }]);
    const r1 = await syncWalletsForPlayer(p.id, p.privyDid, f);
    const r2 = await syncWalletsForPlayer(p.id, p.privyDid, f);
    expect(r1.linked).toHaveLength(1);
    expect(r2.linked).toHaveLength(0);
    expect(r2.refreshed).toHaveLength(1);
    expect((await listWallets(p.id))).toHaveLength(1);
  });

  it("protects wallets verified to another account", async () => {
    const a = await provisionPlayer({ privyDid: `did:privy:own_${tag()}` });
    const b = await provisionPlayer({ privyDid: `did:privy:att_${tag()}` });
    createdPlayerIds.push(a.id, b.id);
    const w = addr(`shared${tag()}`);
    await syncWalletsForPlayer(a.id, a.privyDid, fetcherFor([{ address: w, embedded: true }]));
    const res = await syncWalletsForPlayer(b.id, b.privyDid, fetcherFor([{ address: w }]));
    expect(res.linked).toHaveLength(0);
    expect(res.conflicts).toContain(w.toLowerCase());
    expect((await findWalletByAddress(w))?.playerId).toBe(a.id);
  });

  it("demotes wallets Privy no longer lists", async () => {
    const p = await provisionPlayer({ privyDid: `did:privy:rev_${tag()}` });
    createdPlayerIds.push(p.id);
    const w = addr(`rev${p.id}`);
    await syncWalletsForPlayer(p.id, p.privyDid, fetcherFor([{ address: w, embedded: true }]));
    const res = await syncWalletsForPlayer(p.id, p.privyDid, fetcherFor([]));
    expect(res.demotedStale).toContain(w.toLowerCase());
    const row = await findWalletByAddress(w);
    expect(row?.verifiedAt).toBeNull();
    expect(row?.isPrimary).toBe(false);
  });

  it("reassigns stale rows to a newly verified owner", async () => {
    const a = await provisionPlayer({ privyDid: `did:privy:st1_${tag()}` });
    const b = await provisionPlayer({ privyDid: `did:privy:st2_${tag()}` });
    createdPlayerIds.push(a.id, b.id);
    const w = addr(`stale${tag()}`);
    await syncWalletsForPlayer(a.id, a.privyDid, fetcherFor([{ address: w }]));
    await syncWalletsForPlayer(a.id, a.privyDid, fetcherFor([]));
    const res = await syncWalletsForPlayer(b.id, b.privyDid, fetcherFor([{ address: w, embedded: true }]));
    expect(res.reassigned).toContain(w.toLowerCase());
    expect((await findWalletByAddress(w))?.playerId).toBe(b.id);
  });

  it("survives concurrent syncs with one owner", async () => {
    const p = await provisionPlayer({ privyDid: `did:privy:conc_${tag()}` });
    createdPlayerIds.push(p.id);
    const f = fetcherFor([{ address: addr(`c${p.id}`), embedded: true }]);
    const results = await Promise.all([
      syncWalletsForPlayer(p.id, p.privyDid, f),
      syncWalletsForPlayer(p.id, p.privyDid, f),
    ]);
    expect(results.flatMap((r) => r.linked).length + results.flatMap((r) => r.refreshed).length).toBe(2);
    expect((await listWallets(p.id)).filter((w) => w.verifiedAt !== null)).toHaveLength(1);
  });

  it("supports full onboarding to COMPLETE with a verified wallet", async () => {
    const p = await provisionPlayer({ privyDid: `did:privy:full_${tag()}` });
    createdPlayerIds.push(p.id);
    const name = `full_${tag().replace(/-/g, "")}`;
    await claimInitialUsername(p.id, name);
    await updateProfileFields(p.id, { avatarId: "chog-tide" });
    const res = await syncWalletsForPlayer(p.id, p.privyDid, fetcherFor([{ address: addr(`f${p.id}`), embedded: true }]));
    expect(res.primaryWalletId).not.toBeNull();
    const { getOnboardingState } = await import("@/lib/onboarding");
    const { findPlayerById } = await import("@/db/players");
    const fresh = await findPlayerById(p.id);
    expect(getOnboardingState(fresh!, 1).profileReady).toBe(true);
  });
});

describe("parseSetPrimaryBody", () => {
  it("accepts a wallet uuid", () => {
    expect(parseSetPrimaryBody({ walletId: randomUUID() }).walletId).toBeDefined();
  });

  it("rejects submitted addresses with 422", () => {
    expect(() => parseSetPrimaryBody({ address: addr("evil") })).toThrowError(
      expect.objectContaining({ code: "UNPROCESSABLE" })
    );
  });

  it("rejects unknown fields", () => {
    expect(() => parseSetPrimaryBody({ walletId: randomUUID(), role: "ADMIN" })).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
  });
});
