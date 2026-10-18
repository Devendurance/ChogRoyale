import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

const statusFor: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  retryable: boolean;
  details?: unknown;

  constructor(code: ErrorCode, message: string, opts?: { retryable?: boolean; details?: unknown }) {
    super(message);
    this.code = code;
    this.status = statusFor[code];
    this.retryable = opts?.retryable ?? false;
    this.details = opts?.details;
  }
}

export function getRequestId(headers: Headers): string {
  return headers.get("x-request-id") ?? randomUUID();
}

export function success<T>(data: T, init?: { status?: number; requestId?: string }) {
  return NextResponse.json(
    { success: true, data, requestId: init?.requestId },
    { status: init?.status ?? 200 }
  );
}

export function failure(err: unknown, requestId: string) {
  if (err instanceof AppError) {
    return NextResponse.json(
      {
        success: false,
        error: { code: err.code, message: err.message, requestId, retryable: err.retryable },
      },
      { status: err.status }
    );
  }
  return NextResponse.json(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId, retryable: false },
    },
    { status: 500 }
  );
}

export function handleRouteError(err: unknown, requestId: string) {
  return failure(err, requestId);
}
