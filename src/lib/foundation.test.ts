import { describe, it, expect } from "vitest";
import { sanitize, logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";

describe("logger sanitize", () => {
  it("redacts sensitive keys", () => {
    const out = sanitize({ token: "abc", nested: { "privySecret": "x", ok: 1 } }) as Record<string, unknown>;
    expect(out.token).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
  });

  it("does not throw on basic logging", () => {
    expect(() => logger.info("test log", { requestId: "r1" })).not.toThrow();
  });
});

describe("AppError", () => {
  it("maps codes to status", () => {
    expect(new AppError("UNAUTHORIZED", "no").status).toBe(401);
    expect(new AppError("CONFLICT", "dup").status).toBe(409);
  });
});
