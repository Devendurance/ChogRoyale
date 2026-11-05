import { describe, expect, it } from "vitest";
import { onboardingRedirectStep } from "./use-onboarding-redirect";

describe("onboardingRedirectStep", () => {
  it("redirects an incomplete player once", () => {
    expect(onboardingRedirectStep("incomplete", "/app", false)).toEqual({ go: true, redirected: true });
  });

  it("can't bounce a finished player when a hidden route is revealed with its old snapshot", () => {
    // Regression: /app <-> /app/onboarding looped until the browser threw on
    // history.replaceState, which rendered the framework error page.
    const first = onboardingRedirectStep("incomplete", "/app", false);
    const revealed = onboardingRedirectStep("incomplete", "/app", first.redirected);
    expect(revealed.go).toBe(false);
  });

  it("allows a new redirect only after a new read", () => {
    const reading = onboardingRedirectStep("loading", "/app", true);
    expect(reading).toEqual({ go: false, redirected: false });
    expect(onboardingRedirectStep("incomplete", "/app", reading.redirected).go).toBe(true);
  });

  it("never redirects while loading, unavailable, complete or already on setup", () => {
    for (const state of ["loading", "unavailable", "complete"] as const) {
      expect(onboardingRedirectStep(state, "/app", false).go).toBe(false);
    }
    expect(onboardingRedirectStep("incomplete", "/app/onboarding", false).go).toBe(false);
  });
});
