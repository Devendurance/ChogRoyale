import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireActivePlayer } from "@/lib/auth";
import { syncWalletsForPlayer } from "@/lib/wallets";
import { reconcileOnboarding } from "@/lib/onboarding";
import { getPrivyUser } from "@/lib/privy-server";
import { logger } from "@/lib/logger";

// Reconciles the caller's verified Privy linked wallets into player_wallets.
// The request body is ignored for identity: only Privy-verified linked
// accounts are associated, never client-submitted addresses.
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { identity, player } = await requireActivePlayer(request);
    const result = await syncWalletsForPlayer(player.id, identity.privyDid, getPrivyUser);
    const reconciled = await reconcileOnboarding(player.id);
    return success({ sync: result, onboarding: reconciled.state }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("wallets sync failure", { requestId });
    }
    return failure(err, requestId);
  }
}
