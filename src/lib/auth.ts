import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { verifyPrivyToken, type PrivyIdentity, type PrivyTokenVerifier } from "@/lib/privy-server";
import { findPlayerByPrivyDid } from "@/db/players";
import type { Player } from "@/db/schema";
import { logger } from "@/lib/logger";

export interface AuthContext {
  identity: PrivyIdentity;
  player: Player;
  requestId: string;
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (!match || !match[1]) return null;
  return match[1].trim() || null;
}

function safePlayer(player: Player) {
  return {
    id: player.id,
    username: player.username,
    displayName: player.displayName,
    avatarId: player.avatarId,
    accountStatus: player.accountStatus,
    onboardingStatus: player.onboardingStatus,
    createdAt: player.createdAt,
    updatedAt: player.updatedAt,
  };
}

export type PlayerLoader = (privyDid: string) => Promise<Player | null>;

// Verifies the bearer token and loads the persisted player. Does not create
// or modify records. Throws 401 when unauthenticated, 404 when the verified
// identity has no provisioned player yet (caller should bootstrap).
// A custom loader may be injected for isolated unit tests.
export async function requirePlayer(
  request: Request,
  verifier?: PrivyTokenVerifier,
  loader: PlayerLoader = findPlayerByPrivyDid
): Promise<AuthContext> {
  const requestId = getRequestId(request.headers);
  const token = extractBearerToken(request);
  if (!token) {
    throw new AppError("UNAUTHORIZED", "Authentication required");
  }
  const identity = await verifyPrivyToken(token, verifier);
  const player = await loader(identity.privyDid);
  if (!player) {
    throw new AppError("NOT_FOUND", "Player not provisioned", { details: { bootstrap: true } });
  }
  return { identity, player, requestId };
}

// Same as requirePlayer but rejects suspended/banned accounts with 403.
// Use for every data/game endpoint; bootstrap stays reachable so clients can
// display account-status messaging.
export async function requireActivePlayer(
  request: Request,
  verifier?: PrivyTokenVerifier,
  loader: PlayerLoader = findPlayerByPrivyDid
): Promise<AuthContext> {
  const ctx = await requirePlayer(request, verifier, loader);
  if (ctx.player.accountStatus !== "active") {
    throw new AppError("FORBIDDEN", `Account is ${ctx.player.accountStatus}`);
  }
  return ctx;
}

export { safePlayer };

// Active account whose stored onboarding status is complete AND whose
// persisted profile still carries username + avatar. Both the flag and the
// underlying data are required, so a stale flag alone never authorizes.
export async function requireOnboardedPlayer(
  request: Request,
  verifier?: PrivyTokenVerifier,
  loader: PlayerLoader = findPlayerByPrivyDid
): Promise<AuthContext> {
  const ctx = await requireActivePlayer(request, verifier, loader);
  if (!ctx.player.usernameKey || !ctx.player.avatarId || ctx.player.onboardingStatus !== "complete") {
    throw new AppError("FORBIDDEN", "Profile onboarding is not complete");
  }
  return ctx;
}

export type PrivilegedRole = "MODERATOR" | "ADMIN";

// Server-controlled role gate. Roles come only from player_roles rows;
// nothing in the request can confer privilege.
export async function requireRole(
  request: Request,
  roles: PrivilegedRole[],
  opts?: { verifier?: PrivyTokenVerifier; loader?: PlayerLoader; roleReader?: (playerId: string) => Promise<string[]> }
): Promise<AuthContext> {
  const ctx = await requireActivePlayer(request, opts?.verifier, opts?.loader);
  const { getRoles } = await import("@/db/players");
  const held = await (opts?.roleReader ?? getRoles)(ctx.player.id);
  if (!roles.some((r) => held.includes(r))) {
    throw new AppError("FORBIDDEN", "Insufficient permissions");
  }
  return ctx;
}

export async function runGuarded<T>(
  request: Request,
  guard: (req: Request) => Promise<T>,
  respond: (ctx: T, requestId: string) => unknown
) {
  const requestId = getRequestId(request.headers);
  try {
    const ctx = await guard(request);
    return success(await respond(ctx, requestId), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("auth route failure", { requestId });
    }
    return failure(err, requestId);
  }
}
