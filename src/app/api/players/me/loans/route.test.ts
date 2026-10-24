// P5f.1 loan routes: auth, validation, neutral block handling, lifecycle.
// productionLoanDeps is stubbed (no live chain); the DAL runs on TEST.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { acceptRequest, sendRequest } from "@/db/friendships";
import { blockPlayer } from "@/db/blocks";
import { commanderLoans, friendships, playerBlocks, players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { CHOG_GENESIS_CHAIN_ID } from "@/lib/battle-protocol";
import { GET as listGet, POST as createPost } from "./route";
import { GET as readGet } from "./[id]/route";
import { POST as revokePost } from "./[id]/revoke/route";
import { POST as returnPost } from "./[id]/return/route";

const OWNER_WALLET = `0x${"c".repeat(40)}`;

vi.mock("@/db/lending", async (orig) => {
  const mod = await orig<typeof import("@/db/lending")>();
  return {
    ...mod,
    productionLoanDeps: () => ({
      ownerOf: async () => ({ owner: OWNER_WALLET, chainId: CHOG_GENESIS_CHAIN_ID }),
      verifiedWallets: async () => [OWNER_WALLET],
      commanderExists: async () => true,
    }),
  };
});

vi.mock("@/lib/privy-server", async (orig) => {
  const mod = await orig<typeof import("@/lib/privy-server")>();
  return {
    ...mod,
    verifyPrivyToken: async (token: string) => {
      if (!token.startsWith("tok-")) throw new AppError("UNAUTHORIZED", "Invalid or expired credentials");
      return { privyDid: `did:privy:${token.slice(4)}`, sessionId: "s", appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test" };
    },
  };
});

const BASE = "http://localhost/api/players/me/loans";
const createdPlayerIds: string[] = [];

const req = (url: string, name: string | null, body?: unknown) =>
  new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(name ? { authorization: `Bearer tok-${name}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function onboarded(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:${name}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: name, usernameKey: name, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(inArray(players.id, [p.id]))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
}

async function befriend(a: Player, b: Player): Promise<void> {
  const sent = await sendRequest(a.id, b.id);
  await acceptRequest(b.id, sent.friendshipId);
}

type LoanBody = { success: boolean; data: { loan: { id: string; status: string } } };

beforeAll(() => {
  routeDalToTestDb();
});

beforeAll(async () => {
  await getDb().delete(commanderLoans);
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
});

afterAll(async () => {
  await getDb().delete(commanderLoans);
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
});

describe("P5f.1 loan routes", () => {
  it("refuses unauthenticated access and bad input", async () => {
    expect((await createPost(req(BASE, null, {}))).status).toBe(401);
    expect((await listGet(req(BASE, null))).status).toBe(401);
    const a = await onboarded(`lr_a_${randomUUID().slice(0, 6)}`.replace(/-/g, ""));
    const bad = await createPost(req(BASE, a.username!, { borrowerId: "x", tokenId: "1", durationDays: 2, idempotencyKey: randomUUID() }));
    expect(bad.status).toBe(400);
    const self = await createPost(
      req(BASE, a.username!, { borrowerId: a.id, tokenId: "1462", durationDays: 2, idempotencyKey: randomUUID() })
    );
    expect(self.status).toBe(400);
  });

  it("creates, lists, reads, revokes and returns a loan", async () => {
    const s = `lr_o_${randomUUID().slice(0, 6)}`.replace(/-/g, "");
    const r = `lr_b_${randomUUID().slice(0, 6)}`.replace(/-/g, "");
    const owner = await onboarded(s);
    const borrower = await onboarded(r);
    await befriend(owner, borrower);

    const created = (await (await createPost(
      req(BASE, owner.username!, { borrowerId: borrower.id, tokenId: "1463", durationDays: 2, idempotencyKey: randomUUID() })
    )).json()) as LoanBody;
    expect(created.data.loan.status).toBe("active");

    const listed = (await (await listGet(req(BASE, owner.username!))).json()) as {
      data: { lent: { id: string }[]; borrowed: { id: string }[] };
    };
    expect(listed.data.lent.map((l) => l.id)).toContain(created.data.loan.id);
    expect(listed.data.borrowed).toEqual([]);
    const blisted = (await (await listGet(req(`${BASE}?role=borrowed`, borrower.username!))).json()) as {
      data: { lent: unknown[]; borrowed: { id: string }[] };
    };
    expect(blisted.data.borrowed.map((l) => l.id)).toContain(created.data.loan.id);

    const read = (await (await readGet(req(`${BASE}/${created.data.loan.id}`, borrower.username!), {
      params: Promise.resolve({ id: created.data.loan.id }),
    })).json()) as LoanBody;
    expect(read.data.loan.id).toBe(created.data.loan.id);

    // Borrower cannot revoke; owner revokes; return after revoke stays revoked.
    expect((await revokePost(req(`${BASE}/${created.data.loan.id}/revoke`, borrower.username!), { params: Promise.resolve({ id: created.data.loan.id }) })).status).toBe(403);
    const revoked = (await (await revokePost(req(`${BASE}/${created.data.loan.id}/revoke`, owner.username!), {
      params: Promise.resolve({ id: created.data.loan.id }),
    })).json()) as LoanBody;
    expect(revoked.data.loan.status).toBe("revoked");

    const created2 = (await (await createPost(
      req(BASE, owner.username!, { borrowerId: borrower.id, tokenId: "1464", durationDays: 2, idempotencyKey: randomUUID() })
    )).json()) as LoanBody;
    const returned = (await (await returnPost(req(`${BASE}/${created2.data.loan.id}/return`, borrower.username!), {
      params: Promise.resolve({ id: created2.data.loan.id }),
    })).json()) as LoanBody;
    expect(returned.data.loan.status).toBe("returned");
  });

  it("keeps blocked creation neutral and non-party reads private", async () => {
    const s = `lr_x_${randomUUID().slice(0, 6)}`.replace(/-/g, "");
    const r = `lr_y_${randomUUID().slice(0, 6)}`.replace(/-/g, "");
    const q = `lr_z_${randomUUID().slice(0, 6)}`.replace(/-/g, "");
    const owner = await onboarded(s);
    const borrower = await onboarded(r);
    const stranger = await onboarded(q);
    await befriend(owner, borrower);
    await blockPlayer(borrower.id, owner.id);
    const res = await createPost(
      req(BASE, owner.username!, { borrowerId: borrower.id, tokenId: "1465", durationDays: 2, idempotencyKey: randomUUID() })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("This player is unavailable.");

    const missing = await readGet(req(`${BASE}/${randomUUID()}`, stranger.username!), {
      params: Promise.resolve({ id: randomUUID() }),
    });
    expect(missing.status).toBe(404);
  });
});
