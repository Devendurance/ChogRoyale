import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireActivePlayer } from "@/lib/auth";
import { parseSetPrimaryBody } from "@/lib/wallets";
import { listWallets, setPrimaryWallet } from "@/db/players";
import { logger } from "@/lib/logger";

export async function PATCH(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireActivePlayer(request);
    const { walletId } = parseSetPrimaryBody(await request.json().catch(() => ({})));
    await setPrimaryWallet(player.id, walletId);
    const wallets = await listWallets(player.id);
    return success(
      {
        wallets: wallets.map((w) => ({
          id: w.id,
          address: w.address,
          chainId: w.chainId,
          walletType: w.walletType,
          isPrimary: w.isPrimary,
          verifiedAt: w.verifiedAt,
        })),
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("wallets primary failure", { requestId });
    }
    return failure(err, requestId);
  }
}
