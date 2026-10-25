import { describe, expect, it } from "vitest";
import { candidateLabel, usableCandidate, type CommanderCandidate } from "./commander-candidate";

const now = Date.parse("2026-10-25T12:00:00Z");
const base: CommanderCandidate = { tokenId: "42", name: "Chog Genesis #42", imageUrl: null, status: "derived", eligible: true, basis: "owned", ownership: "owned" };

describe("ready-room commander candidates", () => {
  it("marks owned, borrowed and lent candidates from server data only", () => {
    expect(candidateLabel(base, now)).toEqual({ badge: "OWNED", detail: "In a verified wallet" });
    const borrowed = { ...base, basis: "borrowed" as const, ownership: "borrowed" as const, loan: { endsAt: "2026-10-27T12:00:00Z" } };
    expect(candidateLabel(borrowed, now).badge).toBe("BORROWED");
    expect(candidateLabel(borrowed, now).detail).toMatch(/^Borrowed until /);
    expect(usableCandidate(borrowed, now)).toBe(true);
    const lent = { ...base, ownership: "lent" as const, loan: { endsAt: "2026-10-27T12:00:00Z" } };
    expect(candidateLabel(lent, now).badge).toBe("LENT");
    expect(usableCandidate(lent, now)).toBe(false);
  });
  it("blocks an expired, missing or malformed loan and says the loan ended", () => {
    for (const loan of [{ endsAt: "2026-10-24T12:00:00Z" }, null, { endsAt: "not-a-date" }]) {
      const borrowed = { ...base, basis: "borrowed" as const, loan };
      expect(usableCandidate(borrowed, now)).toBe(false);
      expect(candidateLabel(borrowed, now)).toEqual({ badge: "BORROWED", detail: "Loan ended. Ask the owner for a new loan." });
    }
  });
  it("keeps pending and unverified candidates unavailable with the server reason", () => {
    expect(candidateLabel({ ...base, status: "pending", reason: "Not derived yet" }, now)).toEqual({ badge: "PENDING", detail: "Not derived yet" });
    expect(usableCandidate({ ...base, status: "pending" }, now)).toBe(false);
    expect(candidateLabel({ ...base, eligible: false, ownership: undefined, basis: undefined }, now).badge).toBe("UNVERIFIED");
  });
  it("never puts loan or party identifiers in a label", () => {
    const withIds = { ...base, basis: "borrowed" as const, loan: { endsAt: "2026-10-27T12:00:00Z", id: "loan-secret" } as { endsAt: string } };
    expect(JSON.stringify(candidateLabel(withIds, now))).not.toContain("loan-secret");
  });
});
