// Focused onboarding model tests. Pure, no DB, no network.
import { describe, expect, it } from "vitest";
import { deriveStep, onboardErrorMessage, usernameHint } from "@/components/app/onboarding-model";

describe("onboarding model", () => {
  it("walks the username, avatar, wallet ladder", () => {
    expect(deriveStep(false, false, 0)).toBe("username");
    expect(deriveStep(true, false, 0)).toBe("avatar");
    expect(deriveStep(true, true, 0)).toBe("wallet");
    expect(deriveStep(true, true, 1)).toBe("done");
  });

  it("hints username rules without enforcing for the server", () => {
    expect(usernameHint("")).toMatch(/choose/i);
    expect(usernameHint("ab")).toMatch(/3-20/);
    expect(usernameHint("Hero!")).toMatch(/lowercase/i);
    expect(usernameHint("hero_01")).toBeNull();
  });

  it("maps refusal codes to honest messages", () => {
    expect(onboardErrorMessage("CONFLICT", "x")).toMatch(/taken/);
    expect(onboardErrorMessage("NOPE", "fallback text")).toBe("fallback text");
  });
});
