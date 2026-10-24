// P5f.1 commander loans: game-scoped delegation of the in-game use right.
// The NFT never leaves the owner's wallet. One ACTIVE row per token at a
// time (partial unique index + application re-checks). Durations are 1-7
// days, server-enforced. Block/unfriend never deletes rows; every battle
// entitlement use re-verifies loan + friendship + blocks + onchain owner.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { commanderLoans, players, type CommanderLoan } from "@/db/schema";
import { getAcceptedFriendship } from "@/db/friendships";
import { canSociallyInteract } from "@/db/blocks";
import { AppError } from "@/lib/errors";
import { CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT } from "@/lib/battle-protocol";

export const LOAN_MIN_DAYS = 1;
export const LOAN_MAX_DAYS = 7;
export const LOAN_MS_PER_DAY = 24 * 60 * 60 * 1000;

export type LoanStatus = "active" | "expired" | "revoked" | "returned";

export interface LoanView {
  id: string;
  chainId: number;
  contract: string;
  tokenId: string;
  ownerId: string;
  borrowerId: string;
  status: LoanStatus;
  startsAt: string;
  endsAt: string;
  terminatedAt: string | null;
  terminationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoanOwnershipDeps {
  /** Live onchain owner + chain, fail-closed with SERVICE_UNAVAILABLE. */
  ownerOf(tokenId: bigint): Promise<{ owner: string; chainId: number }>;
  /** Lowercase normalized addresses, verifiedAt !== null rows only. */
  verifiedWallets(playerId: string): Promise<string[]>;
  /** True when a B1 commander row exists for the token. */
  commanderExists(tokenId: string): Promise<boolean>;
}

/** Production deps: live Monad RPC + Neon reads. DB modules load lazily so
 * unit tests that inject stubs never touch the DB. */
export function productionLoanDeps(): LoanOwnershipDeps {
  return {
    async ownerOf(tokenId) {
      const { productionEntitlementDeps } = await import("@/server/battle/entitlement");
      return productionEntitlementDeps().ownerOf(tokenId);
    },
    async verifiedWallets(playerId) {
      const { productionEntitlementDeps } = await import("@/server/battle/entitlement");
      return productionEntitlementDeps().verifiedWallets(playerId);
    },
    async commanderExists(tokenId) {
      const { getCommanderByTokenId } = await import("@/db/commanders");
      return (await getCommanderByTokenId(tokenId)) !== null;
    },
  };
}

function pgCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i += 1) {
    if ("code" in cur && typeof (cur as { code?: unknown }).code === "string") return cur as unknown as string;
    cur = "cause" in cur ? (cur as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

/** Server/database clock. Eligibility never trusts client-supplied dates. */
export async function loanNowMs(): Promise<number> {
  const rows = (await getDb().execute(sql`SELECT now() as now`)) as unknown as
    | Array<{ now: string | Date }>
    | { rows?: Array<{ now: string | Date }> };
  const first = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
  const raw = first?.now;
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  return Number.isFinite(ms) ? (ms as number) : Date.now();
}

export function toLoanView(row: CommanderLoan): LoanView {
  return {
    id: row.id,
    chainId: row.chainId,
    contract: row.contract,
    tokenId: row.tokenId,
    ownerId: row.ownerId,
    borrowerId: row.borrowerId,
    status: row.status as LoanStatus,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    terminatedAt: row.terminatedAt ? row.terminatedAt.toISOString() : null,
    terminationReason: row.terminationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function usable(row: CommanderLoan, nowMs: number): boolean {
  return row.status === "active" && row.startsAt.getTime() <= nowMs && nowMs < row.endsAt.getTime();
}

async function requireLendablePlayer(id: string) {
  const rows = await getDb()
    .select({
      id: players.id,
      accountStatus: players.accountStatus,
      onboardingStatus: players.onboardingStatus,
      usernameKey: players.usernameKey,
      avatarId: players.avatarId,
    })
    .from(players)
    .where(eq(players.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Player not found");
  if (row.accountStatus !== "active" || row.onboardingStatus !== "complete" || !row.usernameKey || !row.avatarId) {
    throw new AppError("FORBIDDEN", "This player is unavailable.");
  }
  return row;
}

async function requireSocialPair(ownerId: string, borrowerId: string): Promise<void> {
  const verdict = await canSociallyInteract(ownerId, borrowerId);
  if (!verdict.allowed) throw new AppError("FORBIDDEN", "This player is unavailable.");
  const friendship = await getAcceptedFriendship(ownerId, borrowerId);
  if (!friendship) throw new AppError("FORBIDDEN", "An accepted friendship is required");
}

/** Marks past-due ACTIVE rows for one token expired. Returns survivors. */
async function expireTokenLoans(chainId: number, contract: string, tokenId: string, nowMs: number): Promise<void> {
  await getDb()
    .update(commanderLoans)
    .set({ status: "expired", terminatedAt: new Date(nowMs), terminationReason: "expired", updatedAt: new Date(nowMs) })
    .where(
      and(
        eq(commanderLoans.chainId, chainId),
        eq(commanderLoans.contract, contract),
        eq(commanderLoans.tokenId, tokenId),
        eq(commanderLoans.status, "active"),
        sql`${commanderLoans.endsAt} <= ${new Date(nowMs)}`
      )
    );
}

export interface CreateLoanInput {
  ownerId: string;
  borrowerId: string;
  tokenId: string;
  durationDays: number;
  idempotencyKey: string;
}

/**
 * Creates a loan. The owner must currently own the token (live ownerOf
 * against a verified linked wallet) and the pair must hold an accepted
 * friendship with no blocks either way. Concurrent duplicate creates with
 * the same idempotency key collapse to one row; concurrent loans for the
 * same token are refused by the partial unique index.
 */
export async function createLoan(input: CreateLoanInput, deps: LoanOwnershipDeps, nowMs?: number): Promise<LoanView> {
  if (input.ownerId === input.borrowerId) throw new AppError("BAD_REQUEST", "You cannot borrow from yourself");
  if (!Number.isInteger(input.durationDays) || input.durationDays < LOAN_MIN_DAYS || input.durationDays > LOAN_MAX_DAYS) {
    throw new AppError("BAD_REQUEST", "Loan duration must be 1 to 7 days");
  }
  const { parseTokenId } = await import("@/lib/nft-contract");
  let tokenBig: bigint;
  try {
    tokenBig = parseTokenId(input.tokenId);
  } catch {
    throw new AppError("BAD_REQUEST", "tokenId must be a player token id");
  }

  await requireLendablePlayer(input.ownerId);
  await requireLendablePlayer(input.borrowerId);
  await requireSocialPair(input.ownerId, input.borrowerId);

  let live: { owner: string; chainId: number };
  try {
    live = await deps.ownerOf(tokenBig);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("SERVICE_UNAVAILABLE", "NFT ownership check unavailable, retry later", { retryable: true });
  }
  if (live.chainId !== CHOG_GENESIS_CHAIN_ID) {
    throw new AppError("SERVICE_UNAVAILABLE", "NFT ownership check unavailable, retry later", { retryable: true });
  }
  const wallets = await deps.verifiedWallets(input.ownerId);
  const liveOwner = live.owner.trim().toLowerCase();
  if (!wallets.includes(liveOwner)) {
    throw new AppError("FORBIDDEN", "Only the verified owner can lend this commander");
  }
  if (!(await deps.commanderExists(tokenBig.toString()))) {
    throw new AppError("BAD_REQUEST", "Commander not derived for this token");
  }

  const now = nowMs ?? (await loanNowMs());
  const tokenId = tokenBig.toString();
  const db = getDb();
  // Idempotent replay first: a repeated create with the same key returns
  // the original row even while its overlap would otherwise conflict.
  const prior = await db.select().from(commanderLoans).where(eq(commanderLoans.idempotencyKey, input.idempotencyKey)).limit(1);
  if (prior[0]) return toLoanView(prior[0]);
  await expireTokenLoans(CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT, tokenId, now);
  const clash = await db
    .select({ id: commanderLoans.id })
    .from(commanderLoans)
    .where(
      and(
        eq(commanderLoans.chainId, CHOG_GENESIS_CHAIN_ID),
        eq(commanderLoans.contract, CHOG_GENESIS_CONTRACT),
        eq(commanderLoans.tokenId, tokenId),
        eq(commanderLoans.status, "active")
      )
    )
    .limit(1);
  if (clash[0]) throw new AppError("CONFLICT", "Commander is already on loan");

  const startsAt = new Date(now);
  const endsAt = new Date(now + input.durationDays * LOAN_MS_PER_DAY);
  const authProof = {
    policyVersion: 1,
    method: "ownerOf+verified-wallets",
    ownerWallet: liveOwner,
    verifiedAt: new Date(now).toISOString(),
  };
  try {
    const inserted = await db
      .insert(commanderLoans)
      .values({
        chainId: CHOG_GENESIS_CHAIN_ID,
        contract: CHOG_GENESIS_CONTRACT,
        tokenId,
        ownerId: input.ownerId,
        borrowerId: input.borrowerId,
        idempotencyKey: input.idempotencyKey,
        status: "active",
        startsAt,
        endsAt,
        authProof,
      })
      .onConflictDoNothing({ target: commanderLoans.idempotencyKey })
      .returning();
    const row = inserted[0] ?? (await db.select().from(commanderLoans).where(eq(commanderLoans.idempotencyKey, input.idempotencyKey)).limit(1))[0];
    if (!row) throw new AppError("INTERNAL_ERROR", "Loan creation failed");
    return toLoanView(row);
  } catch (err) {
    if (pgCode(err) === "23505") throw new AppError("CONFLICT", "Commander is already on loan");
    throw err;
  }
}

/** The currently usable loan for a token, or null. Never treats an expired
 * loan as available, even before the reconcile marker runs. */
export async function getActiveLoanForToken(tokenId: string, nowMs?: number): Promise<CommanderLoan | null> {
  const now = nowMs ?? (await loanNowMs());
  const rows = await getDb()
    .select()
    .from(commanderLoans)
    .where(
      and(
        eq(commanderLoans.chainId, CHOG_GENESIS_CHAIN_ID),
        eq(commanderLoans.contract, CHOG_GENESIS_CONTRACT),
        eq(commanderLoans.tokenId, tokenId),
        eq(commanderLoans.status, "active")
      )
    )
    .limit(1);
  const row = rows[0];
  return row && usable(row, now) ? row : null;
}

/** The borrower's currently usable loan for a token, or null. */
export async function getUsableLoanForBorrower(borrowerId: string, tokenId: string, nowMs?: number): Promise<CommanderLoan | null> {
  const row = await getActiveLoanForToken(tokenId, nowMs);
  return row && row.borrowerId === borrowerId ? row : null;
}

export async function listLoansForOwner(ownerId: string): Promise<LoanView[]> {
  const rows = await getDb()
    .select()
    .from(commanderLoans)
    .where(eq(commanderLoans.ownerId, ownerId))
    .orderBy(desc(commanderLoans.createdAt));
  return rows.map(toLoanView);
}

export async function listLoansForBorrower(borrowerId: string): Promise<LoanView[]> {
  const rows = await getDb()
    .select()
    .from(commanderLoans)
    .where(eq(commanderLoans.borrowerId, borrowerId))
    .orderBy(desc(commanderLoans.createdAt));
  return rows.map(toLoanView);
}

/** Party-only read. Non-parties get NOT_FOUND so loan ids stay private. */
export async function getLoanForViewer(loanId: string, viewerId: string): Promise<LoanView> {
  const rows = await getDb().select().from(commanderLoans).where(eq(commanderLoans.id, loanId)).limit(1);
  const row = rows[0];
  if (!row || (row.ownerId !== viewerId && row.borrowerId !== viewerId)) {
    throw new AppError("NOT_FOUND", "Loan not found");
  }
  return toLoanView(row);
}

async function terminateAs(loanId: string, actorId: string, role: "owner" | "borrower", reason: "revoked" | "returned", nowMs?: number): Promise<LoanView> {
  const db = getDb();
  const rows = await db.select().from(commanderLoans).where(eq(commanderLoans.id, loanId)).limit(1);
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Loan not found");
  const partyId = role === "owner" ? row.ownerId : row.borrowerId;
  if (partyId !== actorId) throw new AppError("FORBIDDEN", role === "owner" ? "Only the owner can revoke this loan" : "Only the borrower can return this loan");
  if (row.status !== "active") return toLoanView(row);
  const now = nowMs ?? (await loanNowMs());
  if (row.endsAt.getTime() <= now) {
    const expired = await db
      .update(commanderLoans)
      .set({ status: "expired", terminatedAt: new Date(now), terminationReason: "expired", updatedAt: new Date(now) })
      .where(and(eq(commanderLoans.id, row.id), eq(commanderLoans.status, "active")))
      .returning();
    return toLoanView(expired[0] ?? { ...row, status: "expired" as const, terminatedAt: new Date(now), terminationReason: "expired" });
  }
  const updated = await db
    .update(commanderLoans)
    .set({ status: reason, terminatedAt: new Date(now), terminationReason: reason, updatedAt: new Date(now) })
    .where(and(eq(commanderLoans.id, row.id), eq(commanderLoans.status, "active")))
    .returning();
  // A concurrent terminate won the race; the stored terminal row is truth.
  return toLoanView(updated[0] ?? (await db.select().from(commanderLoans).where(eq(commanderLoans.id, row.id)).limit(1))[0]!);
}

export async function revokeLoan(ownerId: string, loanId: string, nowMs?: number): Promise<LoanView> {
  return terminateAs(loanId, ownerId, "owner", "revoked", nowMs);
}

export async function returnLoan(borrowerId: string, loanId: string, nowMs?: number): Promise<LoanView> {
  return terminateAs(loanId, borrowerId, "borrower", "returned", nowMs);
}

/** Marks past-due ACTIVE rows expired. Bounded; safe to run opportunistically. */
export async function reconcileExpiredLoans(limit = 50, nowMs?: number): Promise<{ expired: number }> {
  const now = nowMs ?? (await loanNowMs());
  const db = getDb();
  const due = await db
    .select({ id: commanderLoans.id })
    .from(commanderLoans)
    .where(and(eq(commanderLoans.status, "active"), sql`${commanderLoans.endsAt} <= ${new Date(now)}`))
    .limit(Math.min(Math.max(limit, 1), 200));
  if (due.length === 0) return { expired: 0 };
  await db
    .update(commanderLoans)
    .set({ status: "expired", terminatedAt: new Date(now), terminationReason: "expired", updatedAt: new Date(now) })
    .where(and(eq(commanderLoans.status, "active"), inArray(commanderLoans.id, due.map((d) => d.id))));
  return { expired: due.length };
}
