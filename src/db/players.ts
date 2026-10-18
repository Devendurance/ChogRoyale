import { eq, and, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { players, playerWallets, playerRoles, type Player, type PlayerWallet } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { validateUsername, displayUsername } from "@/lib/usernames";
import { isValidAvatarId } from "@/lib/avatars";

export function normalizeUsername(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}

export function isValidUsernameKey(key: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(key);
}

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function isValidEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

function pgCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ("code" in cur && typeof (cur as { code?: unknown }).code === "string") {
      return (cur as { code: string }).code;
    }
    cur = "cause" in cur ? (cur as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === "23505";
}

function isCheckViolation(err: unknown): boolean {
  return pgCode(err) === "23514";
}

export async function findPlayerByPrivyDid(privyDid: string): Promise<Player | null> {
  const db = getDb();
  const rows = await db.select().from(players).where(eq(players.privyDid, privyDid)).limit(1);
  return rows[0] ?? null;
}

export async function findPlayerById(id: string): Promise<Player | null> {
  const db = getDb();
  const rows = await db.select().from(players).where(eq(players.id, id)).limit(1);
  return rows[0] ?? null;
}

// Idempotent: safe to call on every login. Never trusts client claims beyond
// the verified Privy DID passed in by the B0.3 auth layer.
export async function provisionPlayer(input: {
  privyDid: string;
  displayName?: string;
}): Promise<Player> {
  const db = getDb();
  const inserted = await db
    .insert(players)
    .values({ privyDid: input.privyDid, displayName: input.displayName ?? null })
    .onConflictDoNothing({ target: players.privyDid })
    .returning();
  const player = inserted[0] ?? (await findPlayerByPrivyDid(input.privyDid));
  if (!player) throw new AppError("INTERNAL_ERROR", "Player provisioning failed");
  await db
    .insert(playerRoles)
    .values({ playerId: player.id, role: "PLAYER", grantedBy: "system:provisioning" })
    .onConflictDoNothing({ target: [playerRoles.playerId, playerRoles.role] });
  return player;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const key = normalizeUsername(username);
  if (!isValidUsernameKey(key)) return false;
  const db = getDb();
  const rows = await db.select({ id: players.id }).from(players).where(eq(players.usernameKey, key)).limit(1);
  return rows.length === 0;
}

// Atomic: single UPDATE guarded by the UNIQUE(username_key) constraint.
// Concurrent claims for the same name -> exactly one wins, loser gets CONFLICT.
export async function claimUsername(playerId: string, username: string): Promise<Player> {
  const trimmed = username.normalize("NFKC").trim();
  const key = trimmed.toLowerCase();
  if (!isValidUsernameKey(key)) {
    throw new AppError("BAD_REQUEST", "Username must be 3-20 chars: lowercase letters, numbers, underscores");
  }
  const db = getDb();
  try {
    const rows = await db
      .update(players)
      .set({ username: trimmed, usernameKey: key, updatedAt: sql`now()` })
      .where(eq(players.id, playerId))
      .returning();
    const player = rows[0];
    if (!player) throw new AppError("NOT_FOUND", "Player not found");
    return player;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError("CONFLICT", "Username is already taken");
    }
    throw err;
  }
}

export async function listWallets(playerId: string): Promise<PlayerWallet[]> {
  const db = getDb();
  return db.select().from(playerWallets).where(eq(playerWallets.playerId, playerId));
}

export async function findWalletByAddress(address: string): Promise<PlayerWallet | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(playerWallets)
    .where(eq(playerWallets.addressNormalized, normalizeAddress(address)))
    .limit(1);
  return rows[0] ?? null;
}

export async function linkWallet(input: {
  playerId: string;
  address: string;
  chainId?: number;
  walletType: "embedded" | "external";
  linkSource?: string;
  verifiedAt?: Date;
}): Promise<PlayerWallet> {
  if (!isValidEvmAddress(input.address)) {
    throw new AppError("BAD_REQUEST", "Invalid EVM wallet address");
  }
  const db = getDb();
  try {
    const rows = await db
      .insert(playerWallets)
      .values({
        playerId: input.playerId,
        address: input.address.trim(),
        addressNormalized: normalizeAddress(input.address),
        chainId: input.chainId ?? 143,
        walletType: input.walletType,
        linkSource: input.linkSource ?? null,
        verifiedAt: input.verifiedAt ?? sql`now()`,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new AppError("INTERNAL_ERROR", "Wallet link failed");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError("CONFLICT", "Wallet is already linked to an account");
    }
    if (isCheckViolation(err)) {
      throw new AppError("BAD_REQUEST", "Wallet data failed validation");
    }
    throw err;
  }
}

// Two statements: Postgres checks partial unique indexes per row during a
// statement, so a single UPDATE swapping primaries can falsely conflict.
// Clear-then-set converges: concurrent setters leave exactly one primary
// (the loser's second statement raises CONFLICT and can retry).
export async function setPrimaryWallet(playerId: string, walletId: string): Promise<void> {
  const db = getDb();
  await db
    .update(playerWallets)
    .set({ isPrimary: false, updatedAt: sql`now()` })
    .where(eq(playerWallets.playerId, playerId));
  try {
    const rows = await db
      .update(playerWallets)
      .set({ isPrimary: true, updatedAt: sql`now()` })
      .where(and(eq(playerWallets.playerId, playerId), eq(playerWallets.id, walletId)))
      .returning({ id: playerWallets.id });
    if (rows.length === 0) {
      throw new AppError("NOT_FOUND", "Wallet not found for player");
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError("CONFLICT", "Primary wallet changed concurrently, retry", {
        retryable: true,
      });
    }
    throw err;
  }
}

export async function getRoles(playerId: string): Promise<string[]> {  const db = getDb();
  const rows = await db
    .select({ role: playerRoles.role })
    .from(playerRoles)
    .where(eq(playerRoles.playerId, playerId));
  return rows.map((r) => r.role);
}

// Server-side only. No public route may call this with client-chosen roles.
export async function grantRole(playerId: string, role: "PLAYER" | "MODERATOR" | "ADMIN", grantedBy: string): Promise<void> {
  const db = getDb();
  await db
    .insert(playerRoles)
    .values({ playerId, role, grantedBy })
    .onConflictDoNothing({ target: [playerRoles.playerId, playerRoles.role] });
}

export async function completeOnboarding(playerId: string): Promise<Player> {
  const db = getDb();
  const rows = await db
    .update(players)
    .set({ onboardingStatus: "complete", updatedAt: sql`now()` })
    .where(and(eq(players.id, playerId)))
    .returning();
  const player = rows[0];
  if (!player) throw new AppError("NOT_FOUND", "Player not found");
  return player;
}

// Reopens onboarding when a completion requirement is lost (e.g. the last
// verified wallet is revoked). Profile data is preserved; only the status
// flag moves back so gated operations stop being authorized.
export async function reopenOnboarding(playerId: string): Promise<Player> {
  const db = getDb();
  const rows = await db
    .update(players)
    .set({ onboardingStatus: "pending", updatedAt: sql`now()` })
    .where(and(eq(players.id, playerId)))
    .returning();
  const player = rows[0];
  if (!player) throw new AppError("NOT_FOUND", "Player not found");
  return player;
}

// One-time initial username claim. Idempotent when the same name is
// resubmitted; any different name after a claim is rejected with CONFLICT.
// The final uniqueness guard is the UNIQUE(username_key) constraint, so
// concurrent claims for the same name never both succeed.
export async function claimInitialUsername(
  playerId: string,
  username: string
): Promise<{ player: Player; alreadyClaimed: boolean }> {
  const key = validateUsername(username);
  const existing = await findPlayerById(playerId);
  if (!existing) throw new AppError("NOT_FOUND", "Player not found");
  if (existing.usernameKey) {
    if (existing.usernameKey === key) return { player: existing, alreadyClaimed: true };
    throw new AppError("CONFLICT", "Username is already claimed and cannot be changed");
  }
  const player = await claimUsername(playerId, displayUsername(username));
  return { player, alreadyClaimed: false };
}

export async function updateProfileFields(
  playerId: string,
  fields: { displayName?: string; avatarId?: string }
): Promise<Player> {
  const set: { displayName?: string | null; avatarId?: string | null; updatedAt: SQL<unknown> } = {
    updatedAt: sql`now()`,
  };
  if (fields.displayName !== undefined) {
    const name = fields.displayName.normalize("NFKC").trim();
    if (name.length === 0 || name.length > 32) {
      throw new AppError("BAD_REQUEST", "Display name must be 1-32 characters");
    }
    set.displayName = name;
  }
  if (fields.avatarId !== undefined) {
    if (!isValidAvatarId(fields.avatarId)) {
      throw new AppError("BAD_REQUEST", "Unknown avatar selection");
    }
    set.avatarId = fields.avatarId;
  }
  const db = getDb();
  const rows = await db.update(players).set(set).where(eq(players.id, playerId)).returning();
  const player = rows[0];
  if (!player) throw new AppError("NOT_FOUND", "Player not found");
  return player;
}

// Refresh verification evidence for a wallet already owned by this player.
// Idempotent: re-syncing the same Privy state is a no-op on key fields.
export async function refreshWalletVerification(
  walletId: string,
  input: { linkSource: string; verifiedAt?: Date | unknown }
): Promise<PlayerWallet> {
  const db = getDb();
  const rows = await db
    .update(playerWallets)
    .set({ linkSource: input.linkSource, verifiedAt: (input.verifiedAt as Date) ?? sql`now()`, updatedAt: sql`now()` })
    .where(eq(playerWallets.id, walletId))
    .returning();
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Wallet not found");
  return row;
}

// Demote wallets that Privy no longer lists as verified linked accounts.
// Rows are kept for provenance; verifiedAt=NULL means "must not authorize".
export async function markWalletStale(walletId: string): Promise<void> {
  const db = getDb();
  await db
    .update(playerWallets)
    .set({ verifiedAt: null, isPrimary: false, updatedAt: sql`now()` })
    .where(eq(playerWallets.id, walletId));
}

// Move a STALE (verifiedAt NULL) wallet row to a newly verified owner.
// Only Privy-verified freshness can trigger this; fresh rows never move.
export async function reassignStaleWallet(
  walletId: string,
  input: { playerId: string; linkSource: string; walletType: "embedded" | "external"; chainId: number }
): Promise<PlayerWallet> {
  const db = getDb();
  const current = await db.select().from(playerWallets).where(eq(playerWallets.id, walletId)).limit(1);
  const row = current[0];
  if (!row) throw new AppError("NOT_FOUND", "Wallet not found");
  if (row.verifiedAt !== null) {
    throw new AppError("CONFLICT", "Wallet is already linked to another account");
  }
  const rows = await db
    .update(playerWallets)
    .set({
      playerId: input.playerId,
      linkSource: input.linkSource,
      walletType: input.walletType,
      chainId: input.chainId,
      verifiedAt: sql`now()`,
      isPrimary: false,
      updatedAt: sql`now()`,
    })
    .where(eq(playerWallets.id, walletId))
    .returning();
  const updated = rows[0];
  if (!updated) throw new AppError("INTERNAL_ERROR", "Wallet reassignment failed");
  return updated;
}
