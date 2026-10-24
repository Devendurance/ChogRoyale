// P5f.1 loan lifecycle tests. Ownership proofs are controlled stubs (no
// live chain); the one live-holder acceptance path stays explicitly pending.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { acceptRequest, removeFriendship, sendRequest } from "@/db/friendships";
import { blockPlayer, unblockPlayer } from "@/db/blocks";
import {
  createLoan,
  getActiveLoanForToken,
  getLoanForViewer,
  getUsableLoanForBorrower,
  listLoansForBorrower,
  listLoansForOwner,
  reconcileExpiredLoans,
  returnLoan,
  revokeLoan,
  type LoanOwnershipDeps,
} from "@/db/lending";
import { commanderLoans, friendships, playerBlocks, players, type Player } from "@/db/schema";
import { CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT } from "@/lib/battle-protocol";

beforeAll(() => {
  routeDalToTestDb();
});

beforeAll(async () => {
  await getDb().delete(commanderLoans);
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
});

const NOW = Date.parse("2026-10-24T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const OWNER_WALLET = `0x${"1".repeat(40)}`;
const STRANGER_WALLET = `0x${"2".repeat(40)}`;
const TOKEN = "1462";
const createdPlayerIds: string[] = [];

const mkPlayer = async (name: string): Promise<Player> => {
  const tag = `lend_${name}_${randomUUID().slice(0, 8)}`.toLowerCase().replace(/-/g, "_");
  const p = await provisionPlayer({ privyDid: `did:privy:${tag}` });
  const key = tag.slice(0, 20);
  const [row] = await getDb()
    .update(players)
    .set({ username: key, usernameKey: key, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
};

const befriend = async (a: Player, b: Player): Promise<void> => {
  const sent = await sendRequest(a.id, b.id);
  await acceptRequest(b.id, sent.friendshipId);
};

const depsFor = (owner: Player, over: Partial<LoanOwnershipDeps> = {}): LoanOwnershipDeps => ({
  ownerOf: async () => ({ owner: OWNER_WALLET, chainId: CHOG_GENESIS_CHAIN_ID }),
  verifiedWallets: async (pid) => (pid === owner.id ? [OWNER_WALLET] : []),
  commanderExists: async () => true,
  ...over,
});

afterAll(async () => {
  await getDb().delete(commanderLoans);
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
});

describe("P5f.1 commander loans", () => {
  it("a genuine owner creates a bounded loan and stays the only issuer", async () => {
    const owner = await mkPlayer("own_a");
    const borrower = await mkPlayer("bor_a");
    await befriend(owner, borrower);
    const loan = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: TOKEN, durationDays: 3, idempotencyKey: randomUUID() },
      depsFor(owner),
      NOW
    );
    expect(loan.status).toBe("active");
    expect(loan.chainId).toBe(CHOG_GENESIS_CHAIN_ID);
    expect(loan.contract).toBe(CHOG_GENESIS_CONTRACT);
    expect(loan.endsAt).toBe(new Date(NOW + 3 * DAY).toISOString());
    const usable = await getUsableLoanForBorrower(borrower.id, TOKEN, NOW);
    expect(usable?.id).toBe(loan.id);
  });

  it("rejects non-owners, bad tokens, strangers and self-loans", async () => {
    const owner = await mkPlayer("own_b");
    const borrower = await mkPlayer("bor_b");
    const stranger = await mkPlayer("str_b");
    await befriend(owner, borrower);
    // Not the onchain owner.
    await expect(
      createLoan(
        { ownerId: borrower.id, borrowerId: owner.id, tokenId: TOKEN, durationDays: 2, idempotencyKey: randomUUID() },
        depsFor(owner),
        NOW
      )
    ).rejects.toThrow();
    // Malformed token ids.
    for (const bad of ["abc", "0", ""]) {
      await expect(
        createLoan(
          { ownerId: owner.id, borrowerId: borrower.id, tokenId: bad, durationDays: 2, idempotencyKey: randomUUID() },
          depsFor(owner),
          NOW
        )
      ).rejects.toThrow();
    }
    // No friendship.
    await expect(
      createLoan(
        { ownerId: owner.id, borrowerId: stranger.id, tokenId: "171", durationDays: 2, idempotencyKey: randomUUID() },
        depsFor(owner),
        NOW
      )
    ).rejects.toThrow();
    // Self.
    await expect(
      createLoan(
        { ownerId: owner.id, borrowerId: owner.id, tokenId: TOKEN, durationDays: 2, idempotencyKey: randomUUID() },
        depsFor(owner),
        NOW
      )
    ).rejects.toThrow();
  });

  it("rejects blocks in either direction with a neutral error", async () => {
    const owner = await mkPlayer("own_c");
    const borrower = await mkPlayer("bor_c");
    await befriend(owner, borrower);
    await blockPlayer(owner.id, borrower.id);
    await expect(
      createLoan(
        { ownerId: owner.id, borrowerId: borrower.id, tokenId: "341", durationDays: 2, idempotencyKey: randomUUID() },
        depsFor(owner),
        NOW
      )
    ).rejects.toThrow("unavailable");
    await unblockPlayer(owner.id, borrower.id);

    const owner2 = await mkPlayer("own_c2");
    const borrower2 = await mkPlayer("bor_c2");
    await befriend(owner2, borrower2);
    await blockPlayer(borrower2.id, owner2.id);
    await expect(
      createLoan(
        { ownerId: owner2.id, borrowerId: borrower2.id, tokenId: "342", durationDays: 2, idempotencyKey: randomUUID() },
        depsFor(owner2),
        NOW
      )
    ).rejects.toThrow("unavailable");
  });

  it("enforces the 1 to 7 day duration bounds", async () => {
    const owner = await mkPlayer("own_d");
    const borrower = await mkPlayer("bor_d");
    await befriend(owner, borrower);
    for (const days of [0, 8, -1]) {
      await expect(
        createLoan(
          { ownerId: owner.id, borrowerId: borrower.id, tokenId: "343", durationDays: days, idempotencyKey: randomUUID() },
          depsFor(owner),
          NOW
        )
      ).rejects.toThrow("1 to 7 days");
    }
    const one = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "344", durationDays: 1, idempotencyKey: randomUUID() },
      depsFor(owner),
      NOW
    );
    expect(one.endsAt).toBe(new Date(NOW + DAY).toISOString());
    const seven = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "345", durationDays: 7, idempotencyKey: randomUUID() },
      depsFor(owner),
      NOW
    );
    expect(seven.endsAt).toBe(new Date(NOW + 7 * DAY).toISOString());
  });

  it("duplicate idempotency keys collapse and double lending is refused", async () => {
    const owner = await mkPlayer("own_e");
    const borrower = await mkPlayer("bor_e");
    const borrower2 = await mkPlayer("bor_e2");
    await befriend(owner, borrower);
    await befriend(owner, borrower2);
    const key = randomUUID();
    const first = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "346", durationDays: 2, idempotencyKey: key },
      depsFor(owner),
      NOW
    );
    const repeat = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "346", durationDays: 2, idempotencyKey: key },
      depsFor(owner),
      NOW
    );
    expect(repeat.id).toBe(first.id);
    // Same token, second borrower: one active loan per token.
    await expect(
      createLoan(
        { ownerId: owner.id, borrowerId: borrower2.id, tokenId: "346", durationDays: 2, idempotencyKey: randomUUID() },
        depsFor(owner),
        NOW
      )
    ).rejects.toThrow("already on loan");
  });

  it("owner revokes and borrower returns, idempotently and role-checked", async () => {
    const owner = await mkPlayer("own_f");
    const borrower = await mkPlayer("bor_f");
    await befriend(owner, borrower);
    const loan = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "347", durationDays: 2, idempotencyKey: randomUUID() },
      depsFor(owner),
      NOW
    );
    // Wrong roles refused.
    await expect(revokeLoan(borrower.id, loan.id, NOW)).rejects.toThrow();
    await expect(returnLoan(owner.id, loan.id, NOW)).rejects.toThrow();
    const revoked = await revokeLoan(owner.id, loan.id, NOW);
    expect(revoked.status).toBe("revoked");
    expect((await revokeLoan(owner.id, loan.id, NOW)).status).toBe("revoked");
    expect(await getUsableLoanForBorrower(borrower.id, "347", NOW)).toBeNull();

    const loan2 = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "348", durationDays: 2, idempotencyKey: randomUUID() },
      depsFor(owner),
      NOW
    );
    const returned = await returnLoan(borrower.id, loan2.id, NOW);
    expect(returned.status).toBe("returned");
    expect((await returnLoan(borrower.id, loan2.id, NOW)).status).toBe("returned");
    expect(await listLoansForOwner(owner.id)).toHaveLength(2);
    expect(await listLoansForBorrower(borrower.id)).toHaveLength(2);
  });

  it("non-parties cannot read a loan", async () => {
    const owner = await mkPlayer("own_g");
    const borrower = await mkPlayer("bor_g");
    const stranger = await mkPlayer("str_g");
    await befriend(owner, borrower);
    const loan = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "349", durationDays: 2, idempotencyKey: randomUUID() },
      depsFor(owner),
      NOW
    );
    await expect(getLoanForViewer(loan.id, stranger.id)).rejects.toThrow("not found");
    expect((await getLoanForViewer(loan.id, borrower.id)).id).toBe(loan.id);
  });

  it("expiry ends availability and reconcile marks it", async () => {
    const owner = await mkPlayer("own_h");
    const borrower = await mkPlayer("bor_h");
    await befriend(owner, borrower);
    const loan = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "350", durationDays: 1, idempotencyKey: randomUUID() },
      depsFor(owner),
      NOW
    );
    // Past the end: not usable even before the marker runs.
    expect(await getUsableLoanForBorrower(borrower.id, "350", NOW + 2 * DAY)).toBeNull();
    expect(await getActiveLoanForToken("350", NOW + 2 * DAY)).toBeNull();
    const { expired } = await reconcileExpiredLoans(50, NOW + 2 * DAY);
    expect(expired).toBeGreaterThanOrEqual(1);
    expect((await getLoanForViewer(loan.id, owner.id)).status).toBe("expired");
    // The token is lendable again after expiry.
    const again = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "350", durationDays: 1, idempotencyKey: randomUUID() },
      depsFor(owner),
      NOW + 2 * DAY
    );
    expect(again.status).toBe("active");
  });

  it("a removed friendship blocks new loans but preserves history", async () => {
    const owner = await mkPlayer("own_i");
    const borrower = await mkPlayer("bor_i");
    await befriend(owner, borrower);
    const loan = await createLoan(
      { ownerId: owner.id, borrowerId: borrower.id, tokenId: "351", durationDays: 2, idempotencyKey: randomUUID() },
      depsFor(owner),
      NOW
    );
    const rows = await getDb().select().from(friendships);
    const pair = rows.find(
      (r) => (r.userA === owner.id && r.userB === borrower.id) || (r.userA === borrower.id && r.userB === owner.id)
    );
    await removeFriendship(owner.id, pair!.id);
    await expect(
      createLoan(
        { ownerId: owner.id, borrowerId: borrower.id, tokenId: "352", durationDays: 2, idempotencyKey: randomUUID() },
        depsFor(owner),
        NOW
      )
    ).rejects.toThrow();
    // History survives the unfriend.
    expect((await getLoanForViewer(loan.id, owner.id)).status).toBe("active");
  });

  it("a transferred token fails closed at the ownership proof", async () => {
    const owner = await mkPlayer("own_j");
    const borrower = await mkPlayer("bor_j");
    await befriend(owner, borrower);
    await expect(
      createLoan(
        { ownerId: owner.id, borrowerId: borrower.id, tokenId: "353", durationDays: 2, idempotencyKey: randomUUID() },
        depsFor(owner, {
          ownerOf: async () => ({ owner: STRANGER_WALLET, chainId: CHOG_GENESIS_CHAIN_ID }),
        }),
        NOW
      )
    ).rejects.toThrow("Only the verified owner");
  });
});
