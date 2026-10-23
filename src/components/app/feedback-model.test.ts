// Focused tests for the A4.3 feedback model. Every API failure must produce a
// notice, never a success or an empty-state claim, and the action must match
// the failure: sign in for 401, retry for transient failures, setup for 404.

import { describe, it, expect } from "vitest";
import {
  dedupeNotices,
  feedbackNoticeFor,
  retryNotice,
  sessionNotice,
} from "./feedback-model";
import type { LobbyNotice } from "./lobby-types";

describe("sessionNotice", () => {
  it("offers a real sign-in action", () => {
    const notice = sessionNotice("open settings");
    expect(notice.tone).toBe("error");
    expect(notice.text).toBe("Your session is no longer valid. Sign in again to open settings.");
    expect(notice.action).toEqual({ label: "Sign in", kind: "signin" });
  });
});

describe("retryNotice", () => {
  it("offers a retry without claiming the work was lost", () => {
    const notice = retryNotice("The profile service could not be read.");
    expect(notice.tone).toBe("warn");
    expect(notice.action).toEqual({ label: "Try again", kind: "retry" });
  });
});

describe("feedbackNoticeFor", () => {
  it("maps 401 to the sign-in action", () => {
    const notice = feedbackNoticeFor({ code: "UNAUTHORIZED", message: "Authentication required" }, "open settings");
    expect(notice.tone).toBe("error");
    expect(notice.text).toContain("session is no longer valid");
    expect(notice.action).toEqual({ label: "Sign in", kind: "signin" });
  });

  it("maps a bootstrappable 404 to the setup link", () => {
    const notice = feedbackNoticeFor(
      { code: "NOT_FOUND", message: "Player not provisioned", bootstrap: true },
      "open settings"
    );
    expect(notice.tone).toBe("warn");
    expect(notice.action).toEqual({ label: "Finish profile setup", href: "/dev/onboarding" });
  });

  it("keeps a 403 as a lock with no retry", () => {
    const notice = feedbackNoticeFor({ code: "FORBIDDEN", message: "Account suspended" }, "open settings");
    expect(notice.tone).toBe("error");
    expect(notice.text).toContain("Account suspended");
    expect(notice.action).toBeUndefined();
  });

  it("keeps validation failures as validation failures, not retries", () => {
    const notice = feedbackNoticeFor({ code: "BAD_REQUEST", message: "Unknown avatar selection" }, "save settings");
    expect(notice.tone).toBe("error");
    expect(notice.text).toBe("Unknown avatar selection");
    expect(notice.action).toBeUndefined();
  });

  it("offers a retry for service and network failures", () => {
    for (const code of ["SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "NETWORK", "RATE_LIMITED"]) {
      const notice = feedbackNoticeFor({ code, message: "Try later" }, "load your deck");
      expect(notice.action).toEqual({ label: "Try again", kind: "retry" });
      expect(notice.tone === "warn" || notice.tone === "error").toBe(true);
    }
  });

  it("keeps a conflict as a conflict and keeps the local work", () => {
    const notice = feedbackNoticeFor({ code: "CONFLICT", message: "Revision changed" }, "save your deck");
    expect(notice.tone).toBe("warn");
    expect(notice.text).toContain("Your work is still on this screen");
    expect(notice.action).toEqual({ label: "Try again", kind: "retry" });
  });

  it("never turns a failure into an ok tone or a saved claim", () => {
    const codes = [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "BAD_REQUEST",
      "UNPROCESSABLE",
      "CONFLICT",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
      "SERVICE_UNAVAILABLE",
      "NETWORK",
      "REQUEST_FAILED",
    ];
    for (const code of codes) {
      const notice = feedbackNoticeFor({ code, message: "Failure" }, "load the screen");
      expect(notice.tone).not.toBe("ok");
      expect(notice.text.toLowerCase()).not.toContain("saved to your account");
      expect(notice.text.toLowerCase()).not.toContain("no matches");
      expect(notice.text.toLowerCase()).not.toContain("zero");
    }
  });
});

describe("dedupeNotices", () => {
  it("keeps one notice per message and preserves order", () => {
    const notices: LobbyNotice[] = [
      { tone: "error", text: "First" },
      { tone: "warn", text: "Second" },
      { tone: "error", text: "First" },
    ];
    expect(dedupeNotices(notices).map((n) => n.text)).toEqual(["First", "Second"]);
  });

  it("prefers the actionable copy when the same message appears twice", () => {
    const notices: LobbyNotice[] = [
      { tone: "error", text: "Your session is no longer valid." },
      {
        tone: "error",
        text: "Your session is no longer valid.",
        action: { label: "Sign in", kind: "signin" },
      },
    ];
    expect(dedupeNotices(notices)).toEqual([
      {
        tone: "error",
        text: "Your session is no longer valid.",
        action: { label: "Sign in", kind: "signin" },
      },
    ]);
  });

  it("keeps two notices when the messages differ", () => {
    const notices: LobbyNotice[] = [
      { tone: "error", text: "Your session is no longer valid." },
      { tone: "warn", text: "The profile service is unavailable." },
    ];
    expect(dedupeNotices(notices)).toHaveLength(2);
  });
});
