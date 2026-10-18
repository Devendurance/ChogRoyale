import { z } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  normalizeAddress,
  isValidEvmAddress,
  findWalletByAddress,
  linkWallet,
  refreshWalletVerification,
  markWalletStale,
  reassignStaleWallet,
  listWallets,
  setPrimaryWallet,
} from "@/db/players";
import type { PlayerWallet as PlayerWalletRow } from "@/db/schema";

export interface VerifiedEvmWallet {
  address: string;
  walletType: "embedded" | "external";
  linkSource: string;
}

export interface PrivyUserFetcher {
  (privyDid: string): Promise<{
    linkedAccounts: Array<{
      type: string;
      address?: string | null;
      chainType?: string;
      walletClientType?: string;
      verifiedAt?: Date | string | null;
    }>;
  }>;
}

// Trust boundary: only linked accounts Privy reports as verified ethereum
// wallets are accepted. Client-submitted addresses are never consulted.
export function extractVerifiedWallets(user: Awaited<ReturnType<PrivyUserFetcher>>): VerifiedEvmWallet[] {
  const out: VerifiedEvmWallet[] = [];
  const seen = new Set<string>();
  for (const account of user.linkedAccounts ?? []) {
    if (account.type !== "wallet") continue;
    if (account.chainType !== "ethereum") continue;
    if (!account.verifiedAt) continue;
    if (!account.address || !isValidEvmAddress(account.address)) continue;
    const normalized = normalizeAddress(account.address);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      address: account.address.trim(),
      walletType: account.walletClientType === "privy" ? "embedded" : "external",
      linkSource: `privy:${account.walletClientType === "privy" ? "embedded" : "linked"}`,
    });
  }
  return out;
}

export interface SyncResult {
  linked: string[];
  refreshed: string[];
  reassigned: string[];
  conflicts: string[];
  demotedStale: string[];
  primaryWalletId: string | null;
}

export async function syncWalletsForPlayer(
  playerId: string,
  privyDid: string,
  fetcher: PrivyUserFetcher
): Promise<SyncResult> {
  let user: Awaited<ReturnType<PrivyUserFetcher>>;
  try {
    user = await fetcher(privyDid);
  } catch {
    throw new AppError("SERVICE_UNAVAILABLE", "Identity provider unavailable, try again", { retryable: true });
  }
  const verified = extractVerifiedWallets(user);
  const verifiedSet = new Set(verified.map((w) => normalizeAddress(w.address)));
  const result: SyncResult = {
    linked: [],
    refreshed: [],
    reassigned: [],
    conflicts: [],
    demotedStale: [],
    primaryWalletId: null,
  };

  for (const wallet of verified) {
    const existing = await findWalletByAddress(wallet.address);
    if (!existing) {
      try {
        const row = await linkWallet({
          playerId,
          address: wallet.address,
          chainId: 143,
          walletType: wallet.walletType,
          linkSource: wallet.linkSource,
        });
        result.linked.push(row.addressNormalized);
      } catch (err) {
        // Lost a race with a concurrent sync: re-read and reconcile below.
        if (err instanceof AppError && err.code === "CONFLICT") {
          const retry = await findWalletByAddress(wallet.address);
          if (retry && retry.playerId === playerId) {
            await refreshWalletVerification(retry.id, { linkSource: wallet.linkSource });
            result.refreshed.push(retry.addressNormalized);
          } else {
            result.conflicts.push(normalizeAddress(wallet.address));
          }
        } else {
          throw err;
        }
      }
      continue;
    }
    if (existing.playerId === playerId) {
      await refreshWalletVerification(existing.id, { linkSource: wallet.linkSource });
      result.refreshed.push(existing.addressNormalized);
      continue;
    }
    if (existing.verifiedAt === null) {
      // Privy's current verified state beats our stale row: adopt it.
      logger.warn("wallet reassigned from stale owner", {
        playerId,
        address: existing.addressNormalized,
      });
      const moved = await reassignStaleWallet(existing.id, {
        playerId,
        linkSource: wallet.linkSource,
        walletType: wallet.walletType,
        chainId: 143,
      });
      result.reassigned.push(moved.addressNormalized);
      continue;
    }
    result.conflicts.push(existing.addressNormalized);
  }

  // Revocation reconciliation: verified rows we own but Privy no longer
  // lists lose verification and primary status. Stale rows never authorize.
  const owned = await listWallets(playerId);
  for (const row of owned) {
    if (row.verifiedAt !== null && !verifiedSet.has(row.addressNormalized)) {
      await markWalletStale(row.id);
      result.demotedStale.push(row.addressNormalized);
    }
  }

  const fresh = (await listWallets(playerId)).filter((w) => w.verifiedAt !== null);
  const primary = fresh.find((w) => w.isPrimary);
  if (primary) {
    result.primaryWalletId = primary.id;
  } else if (fresh.length > 0 && fresh[0]) {
    await setPrimaryWallet(playerId, fresh[0].id);
    result.primaryWalletId = fresh[0].id;
  }
  return result;
}

export const setPrimaryBodySchema = z
  .object({ walletId: z.string().uuid("walletId must be a UUID") })
  .strict();

export function parseSetPrimaryBody(body: unknown): { walletId: string } {
  if (body !== null && typeof body === "object" && "address" in (body as Record<string, unknown>)) {
    throw new AppError("UNPROCESSABLE", "Use server wallet synchronization, not submitted addresses");
  }
  const parsed = setPrimaryBodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.code === "unrecognized_keys") {
      throw new AppError("FORBIDDEN", "Field cannot be edited");
    }
    throw new AppError("BAD_REQUEST", issue?.message ?? "Invalid request");
  }
  return parsed.data;
}

export type { PlayerWalletRow as PlayerWallet };
