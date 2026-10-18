import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireActivePlayer, safePlayer } from "@/lib/auth";
import { parseProfilePatch, validateDisplayName, getOnboardingState, reconcileOnboarding } from "@/lib/onboarding";
import { getRoles, listWallets, updateProfileFields } from "@/db/players";
import { isValidAvatarId } from "@/lib/avatars";
import { resolveAvatar } from "@/lib/profiles";
import { logger } from "@/lib/logger";

function ownProfileView(player: Parameters<typeof safePlayer>[0], roles: string[], wallets: Awaited<ReturnType<typeof listWallets>>) {
  return {
    ...safePlayer(player),
    avatar: resolveAvatar(player.avatarId),
    roles,
    wallets: wallets.map((w) => ({
      id: w.id,
      address: w.address,
      chainId: w.chainId,
      walletType: w.walletType,
      isPrimary: w.isPrimary,
      verifiedAt: w.verifiedAt,
    })),
    onboarding: getOnboardingState(player, wallets.length),
  };
}

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireActivePlayer(request);
    const reconciled = await reconcileOnboarding(player.id);
    const [roles, wallets] = await Promise.all([getRoles(reconciled.player.id), listWallets(reconciled.player.id)]);
    return success({ player: ownProfileView(reconciled.player, roles, wallets) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("players me read failure", { requestId });
    }
    return failure(err, requestId);
  }
}

// Only displayName and avatarId are editable. Username is claimed once via
// POST /api/players/onboard; everything else is owned by trusted services.
export async function PATCH(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireActivePlayer(request);
    const patch = parseProfilePatch(await request.json().catch(() => ({})));
    const updates: { displayName?: string; avatarId?: string } = {};
    if (patch.displayName !== undefined) updates.displayName = validateDisplayName(patch.displayName);
    if (patch.avatarId !== undefined) {
      if (!isValidAvatarId(patch.avatarId)) {
        throw new AppError("BAD_REQUEST", "Unknown avatar selection");
      }
      updates.avatarId = patch.avatarId;
    }
    const updated = await updateProfileFields(player.id, updates);
    const [roles, wallets] = await Promise.all([getRoles(updated.id), listWallets(updated.id)]);
    return success({ player: ownProfileView(updated, roles, wallets) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("players me update failure", { requestId });
    }
    return failure(err, requestId);
  }
}
