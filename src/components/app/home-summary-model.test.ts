import { describe, expect, it } from "vitest";
import { resolveHomeCrowns, resolveHomeGold } from "./home-summary-model";

describe("home summary resource reads", () => {
  it("keeps pending reads in loading state", () => {
    expect(resolveHomeGold(null)).toEqual({ state: "loading", value: null, message: null });
    expect(resolveHomeCrowns(null)).toEqual({ state: "loading", value: null, message: null });
  });

  it("accepts the server Gold balance including a real zero", () => {
    expect(resolveHomeGold({ ok: true, data: { gold: { balance: 1250 } } })).toEqual({
      state: "ready",
      value: 1250,
      message: null,
    });
    expect(resolveHomeGold({ ok: true, data: { gold: { balance: 0 } } })).toMatchObject({
      state: "ready",
      value: 0,
    });
  });

  it("accepts only the server-earned crown count, including a real zero", () => {
    expect(resolveHomeCrowns({ ok: true, data: { stats: { crownsEarned: 27 } } })).toMatchObject({
      state: "ready",
      value: 27,
    });
    expect(resolveHomeCrowns({ ok: true, data: { stats: { crownsEarned: 0 } } })).toMatchObject({
      state: "ready",
      value: 0,
    });
  });

  it("does not turn missing or malformed successful data into zero", () => {
    for (const value of [undefined, null, "4", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(resolveHomeGold({ ok: true, data: { gold: { balance: value } } }).state).toBe("unavailable");
    }
    for (const value of [undefined, null, "4", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(resolveHomeCrowns({ ok: true, data: { stats: { crownsEarned: value } } }).state).toBe("unavailable");
    }
    expect(resolveHomeCrowns({ ok: true, data: { stats: { total: 0 } } })).toMatchObject({
      state: "unavailable",
      value: null,
    });
  });

  it("keeps authentication and setup failures visible", () => {
    expect(resolveHomeGold({ ok: false, code: "UNAUTHORIZED", message: "Unauthorized", status: 401 })).toMatchObject({
      state: "auth",
      value: null,
      message: "Sign in again to load this value.",
    });
    expect(resolveHomeCrowns({ ok: false, code: "FORBIDDEN", message: "Forbidden", status: 403 })).toMatchObject({
      state: "locked",
      value: null,
      message: "Finish profile setup to load this value.",
    });
  });

  it("preserves a useful service error without inventing a value", () => {
    expect(resolveHomeGold({ ok: false, code: "SERVICE_UNAVAILABLE", message: "The Gold service is waiting." })).toEqual({
      state: "unavailable",
      value: null,
      message: "The Gold service is waiting.",
    });
  });
});
