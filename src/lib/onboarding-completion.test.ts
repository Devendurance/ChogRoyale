import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { players, type Player } from "@/db/schema";
import {
  provisionPlayer,
  findPlayerById,
  claimInitialUsername,
  updateProfileFields,
} from "@/db/players";
import { reconcileOnboarding } from "@/lib/onboarding";
import { syncWalletsForPlayer, type PrivyUserFetcher } from "@/lib/wallets";
import { requireOnboardedPlayer } from "@/lib/auth";

const createdPlayerIds: string[] = [];
const tag = () => randomUUID().slice(0, 8);
const addr = (seed: string) => {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `0x${h.toString(16).padStart(8, "0").repeat(5).slice(0, 40)}`;
};

function fetcherFor(
  wallets: Array<{ address: string; embedded?: boolean; verified?: boolean }>
): PrivyUserFetcher {
  return async () => ({
    linkedAccounts: wallets.map((w) => ({
      type: "wallet",
      address: w.address,
      chainType: "ethereum",
      walletClientType: w.embedded ? "privy" : "rabby",
      verifiedAt: w.verified === false ? null : new Date(),
    })),
  });
}

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
});

async function readyPlayer() {
  const p = await provisionPlayer({ privyDid: `did:privy:rec_${tag()}` });
  createdPlayerIds.push(p.id);
  await claimInitialUsername(p.id, `rec_${tag().replace(/-/g, "")}`);
  await updateProfileFields(p.id, { avatarId: "chog-spark" });
  return p;
}

describe("onboarding completion reconciliation", () => {
  it("transitions pending -> complete when all requirements are met", async () => {
    const p = await readyPlayer();
    const before = await reconcileOnboarding(p.id);
    expect(before.player.onboardingStatus).toBe("pending");
    expect(before.state.nextStep).toBe("wallet");

    await syncWalletsForPlayer(p.id, p.privyDid, fetcherFor([{ address: addr(`w${p.id}`), embedded: true }]));
    const after = await reconcileOnboarding(p.id);
    expect(after.player.onboardingStatus).toBe("complete");
    expect(after.state).toMatchObject({ complete: true, nextStep: "done", profileReady: true });
    expect((await findPlayerById(p.id))?.onboardingStatus).toBe("complete");
  });

  it("is idempotent across repeated reconciliations", async () => {
    const p = await readyPlayer();
    await syncWalletsForPlayer(p.id, p.privyDid, fetcherFor([{ address: addr(`i${p.id}`), embedded: true }]));
    const r1 = await reconcileOnboarding(p.id);
    const r2 = await reconcileOnboarding(p.id);
    expect(r1.player.onboardingStatus).toBe("complete");
    expect(r2.player.onboardingStatus).toBe("complete");
    expect(r2.state.complete).toBe(true);
  });

  it("reopens to pending when the last verified wallet is revoked", async () => {
    const p = await readyPlayer();
    const w = addr(`v${p.id}`);
    await syncWalletsForPlayer(p.id, p.privyDid, fetcherFor([{ address: w, embedded: true }]));
    expect((await reconcileOnboarding(p.id)).player.onboardingStatus).toBe("complete");

    await syncWalletsForPlayer(p.id, p.privyDid, fetcherFor([]));
    const after = await reconcileOnboarding(p.id);
    expect(after.player.onboardingStatus).toBe("pending");
    expect(after.state.complete).toBe(false);

    // Profile data survives revocation; only the flag moves.
    const row = await findPlayerById(p.id);
    expect(row?.usernameKey).not.toBeNull();
    expect(row?.avatarId).toBe("chog-spark");
  });

  it("ignores connected-but-unverified wallets", async () => {
    const p = await readyPlayer();
    // Session-visible wallets with no verified Privy linkage (unlinked
    // external wallet, expired verification) must never persist.
    const res = await syncWalletsForPlayer(
      p.id,
      p.privyDid,
      fetcherFor([
        { address: addr(`rabby${p.id}`), verified: false },
        { address: addr(`unv${p.id}`), verified: false },
      ])
    );
    expect(res.linked).toHaveLength(0);
    expect(res.refreshed).toHaveLength(0);
    expect((await reconcileOnboarding(p.id)).player.onboardingStatus).toBe("pending");
  });
});

describe("requireOnboardedPlayer enforces full state", () => {
  const verifier = async () => ({
    appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test-app",
    issuer: "privy.io",
    issuedAt: 1,
    expiration: 9999999999,
    sessionId: "s",
    userId: "did:privy:u1",
  });
  const authed = () => new Request("http://localhost/x", { headers: { authorization: "Bearer t" } });
  const base = {
    id: "00000000-0000-0000-0000-000000000001",
    privyDid: "did:privy:u1",
    username: "hero",
    usernameKey: "hero",
    displayName: "Hero",
    avatarId: "chog-spark",
    accountStatus: "active",
    onboardingStatus: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Player;

  it("rejects profile-ready players whose stored status is not complete", async () => {
    await expect(requireOnboardedPlayer(authed(), verifier, async () => base)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects complete-flagged players with missing profile data", async () => {
    const skewed = { ...base, onboardingStatus: "complete", avatarId: null } as Player;
    await expect(requireOnboardedPlayer(authed(), verifier, async () => skewed)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("accepts fully complete players", async () => {
    const done = { ...base, onboardingStatus: "complete" } as Player;
    const ctx = await requireOnboardedPlayer(authed(), verifier, async () => done);
    expect(ctx.player.id).toBe(done.id);
  });
});
