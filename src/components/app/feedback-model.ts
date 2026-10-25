// Shared feedback mapping for the authenticated app (A4.3).
//
// One place decides how an API error reads, which tone it uses and whether it
// offers a sign-in, a retry or a setup link. Screens keep their own state
// models; this module only shapes the notice that explains the state.
//
// A failure is never mapped to "ok" or to an empty success. A screen that
// needs to show an empty account does so only from a successful payload.

import type { LobbyNotice } from "./lobby-types";

export interface FeedbackError {
  code: string;
  message: string;
  /** Present on a 404 that means the verified identity has no player row. */
  bootstrap?: boolean;
}

/** The one session-expiry notice, with a real sign-in action. */
export function sessionNotice(subject: string): LobbyNotice {
  return {
    tone: "error",
    text: `Your session is no longer valid. Sign in again to ${subject}.`,
    action: { label: "Sign in", kind: "signin" },
  };
}

/** A read or write that failed but can be tried again without losing work. */
export function retryNotice(text: string): LobbyNotice {
  return { tone: "warn", text, action: { label: "Try again", kind: "retry" } };
}

/**
 * Map an API error to the shared notice. `subject` is a verb phrase such as
 * "open settings" or "load your deck".
 */
export function feedbackNoticeFor(error: FeedbackError, subject: string): LobbyNotice {
  if (error.code === "UNAUTHORIZED") return sessionNotice(subject);

  if (error.code === "NOT_FOUND") {
    return {
      tone: "warn",
      text: `This sign-in has no player profile yet, so we cannot ${subject}.`,
      action: { label: "Finish profile setup", href: "/app/onboarding" },
    };
  }

  if (error.code === "BOOTSTRAP_FAILED") {
    return {
      tone: "error",
      text: `Your player profile could not be created. ${error.message}`,
      action: { label: "Open the setup tools", href: "/app/onboarding" },
    };
  }

  if (error.code === "FORBIDDEN") {
    return {
      tone: "error",
      text: error.message ? `This account cannot ${subject}. ${error.message}` : `This account cannot ${subject}.`,
    };
  }

  if (error.code === "CONFLICT") {
    return {
      tone: "warn",
      text: "Your account moved on before this action finished. Your work is still on this screen.",
      action: { label: "Try again", kind: "retry" },
    };
  }

  if (error.code === "BAD_REQUEST" || error.code === "UNPROCESSABLE") {
    return {
      tone: "error",
      text: error.message || "The server rejected that change.",
    };
  }

  if (error.code === "RATE_LIMITED") {
    return {
      tone: "warn",
      text: "The service is receiving too many requests right now, so nothing changed. Try again shortly.",
      action: { label: "Try again", kind: "retry" },
    };
  }

  const service = error.code === "NETWORK" ? "could not be reached" : "is unavailable";
  return {
    tone: "error",
    text: `The service ${service}, so we could not ${subject}. ${error.message}`,
    action: { label: "Try again", kind: "retry" },
  };
}

/**
 * One notice per distinct message. If a duplicate carries an action and the
 * first copy does not, the actionable copy wins. This keeps a session notice
 * and a section failure from saying the same thing twice.
 */
export function dedupeNotices(notices: LobbyNotice[]): LobbyNotice[] {
  const byText = new Map<string, LobbyNotice>();
  for (const notice of notices) {
    const existing = byText.get(notice.text);
    if (!existing) {
      byText.set(notice.text, notice);
      continue;
    }
    if (!existing.action && notice.action) byText.set(notice.text, notice);
  }
  return Array.from(byText.values());
}
