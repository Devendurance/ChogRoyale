import { NextRequest } from "next/server";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { pingDb } from "@/db/client";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  try {
    let db: "up" | "down" = "down";
    let latencyMs: number | null = null;
    try {
      const ping = await pingDb();
      db = "up";
      latencyMs = ping.latencyMs;
    } catch (err) {
      logger.error("health db ping failed", { requestId, error: String(err) });
    }

    if (db === "down") {
      throw new AppError("SERVICE_UNAVAILABLE", "Database unreachable", { retryable: true });
    }

    return success(
      {
        status: "ok",
        version: "b0.1",
        db,
        latencyMs,
        timestamp: new Date().toISOString(),
        uptimeSec: Math.floor(process.uptime()),
      },
      { requestId }
    );
  } catch (err) {
    return failure(err, requestId);
  }
}
