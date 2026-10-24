// P5f.1 loan collection: create + party-scoped lists. Chain/contract are
// server-fixed to Chog Genesis; the client never supplies them.
import { z } from "zod";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { createLoan, listLoansForBorrower, listLoansForOwner, productionLoanDeps } from "@/db/lending";
import { logger } from "@/lib/logger";

const MAX_BODY = 4096;
const createSchema = z.object({
  borrowerId: z.string().uuid(),
  tokenId: z.string().min(1).max(78),
  durationDays: z.number().int(),
  idempotencyKey: z.string().uuid(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const role = new URL(request.url).searchParams.get("role");
    if (role !== null && role !== "lent" && role !== "borrowed") {
      throw new AppError("BAD_REQUEST", "role must be lent or borrowed");
    }
    const lent = role === "borrowed" ? [] : await listLoansForOwner(player.id);
    const borrowed = role === "lent" ? [] : await listLoansForBorrower(player.id);
    return success({ lent, borrowed }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("loan list failure", { requestId });
    }
    return failure(err, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const len = Number(request.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) throw new AppError("BAD_REQUEST", "Request body too large");
    const text = await request.text();
    if (text.length > MAX_BODY) throw new AppError("BAD_REQUEST", "Request body too large");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AppError("BAD_REQUEST", "Body must be JSON");
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "borrowerId, tokenId, durationDays and idempotencyKey are required");
    const loan = await createLoan(
      {
        ownerId: player.id,
        borrowerId: parsed.data.borrowerId,
        tokenId: parsed.data.tokenId,
        durationDays: parsed.data.durationDays,
        idempotencyKey: parsed.data.idempotencyKey,
      },
      productionLoanDeps()
    );
    return success({ loan }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("loan create failure", { requestId });
    }
    return failure(err, requestId);
  }
}
