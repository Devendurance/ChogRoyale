import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireActivePlayer, safePlayer } from "@/lib/auth";
import { parseOnboardBody, validateDisplayName, reconcileOnboarding } from "@/lib/onboarding";
import { claimInitialUsername, updateProfileFields } from "@/db/players";
import { isValidAvatarId } from "@/lib/avatars";
import { logger } from "@/lib/logger";

// Resumable onboarding step: claim username once, set/refresh display name
// and avatar. Repeating a completed step with the same values succeeds
// without duplicating or resetting anything.
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireActivePlayer(request);
    const body = parseOnboardBody(await request.json().catch(() => ({})));
    if (body.username !== undefined) {
      await claimInitialUsername(player.id, body.username);
    }
    const profileUpdates: { displayName?: string; avatarId?: string } = {};
    if (body.displayName !== undefined) profileUpdates.displayName = validateDisplayName(body.displayName);
    if (body.avatarId !== undefined) {
      if (!isValidAvatarId(body.avatarId)) {
        throw new AppError("BAD_REQUEST", "Unknown avatar selection");
      }
      profileUpdates.avatarId = body.avatarId;
    }
    if (profileUpdates.displayName !== undefined || profileUpdates.avatarId !== undefined) {
      await updateProfileFields(player.id, profileUpdates);
    }
    const reconciled = await reconcileOnboarding(player.id);
    return success(
      { player: safePlayer(reconciled.player), onboarding: reconciled.state },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("players onboard failure", { requestId });
    }
    return failure(err, requestId);
  }
}
