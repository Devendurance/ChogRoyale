import { describe, it, expect } from "vitest";
import { describeUsername, validateUsername, normalizeUsernameKey } from "@/lib/usernames";
import { listAvatars, getAvatar, isValidAvatarId, DEFAULT_AVATAR_ID } from "@/lib/avatars";
import {
  getOnboardingState,
  parseOnboardBody,
  parseProfilePatch,
  validateDisplayName,
} from "@/lib/onboarding";
import { toPublicProfile } from "@/lib/profiles";
import type { Player } from "@/db/schema";

function playerStub(overrides: Partial<Player> = {}): Player {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    privyDid: "did:privy:u1",
    username: null,
    usernameKey: null,
    displayName: null,
    avatarId: null,
    accountStatus: "active",
    onboardingStatus: "pending",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("username validation", () => {
  it("accepts valid names and normalizes case", () => {
    expect(validateUsername("Hero_01")).toBe("hero_01");
    expect(normalizeUsernameKey("  HERO ")).toBe("hero");
  });

  it("rejects too short, too long, and bad characters", () => {
    for (const bad of ["ab", "a".repeat(21), "has space", "UPPER-OK-BUT-DASH", "dots.no", "emoji😀"]) {
      expect(describeUsername(bad).valid, bad).toBe(false);
    }
    expect(describeUsername("ab")).toMatchObject({ reason: "invalid" });
  });

  it("rejects reserved names case-insensitively", () => {
    for (const r of ["admin", "ADMIN", "Moderator", "support", "chog", "system", "null"]) {
      expect(describeUsername(r), r).toMatchObject({ valid: false, reason: "reserved" });
    }
  });

  it("rejects profanity substrings", () => {
    expect(describeUsername("shitlord")).toMatchObject({ valid: false, reason: "profanity" });
  });

  it("rejects non-string input", () => {
    expect(describeUsername(undefined).valid).toBe(false);
    expect(() => validateUsername(42)).toThrow(/text/i);
  });
});

describe("avatar catalog", () => {
  it("lists stable entries with safe asset urls", () => {
    const avatars = listAvatars();
    expect(avatars.length).toBeGreaterThanOrEqual(8);
    const ids = avatars.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of avatars) {
      expect(a.assetUrl.startsWith("/avatars/")).toBe(true);
      expect(a.assetUrl).not.toMatch(/^https?:/);
    }
    expect(getAvatar(DEFAULT_AVATAR_ID)).not.toBeNull();
  });

  it("rejects unknown ids", () => {
    expect(isValidAvatarId("chog-nope")).toBe(false);
    expect(isValidAvatarId("")).toBe(false);
    expect(isValidAvatarId(undefined)).toBe(false);
    expect(getAvatar("../../etc/passwd")).toBeNull();
  });
});

describe("onboarding state", () => {
  it("walks username -> avatar -> wallet -> done", () => {
    expect(getOnboardingState(playerStub(), 0).nextStep).toBe("username");
    expect(getOnboardingState(playerStub({ usernameKey: "hero" }), 0).nextStep).toBe("avatar");
    expect(
      getOnboardingState(playerStub({ usernameKey: "hero", avatarId: "chog-ember" }), 0)
    ).toMatchObject({ profileReady: true, complete: false, nextStep: "wallet" });
    expect(
      getOnboardingState(
        playerStub({ usernameKey: "hero", avatarId: "chog-ember", onboardingStatus: "complete" }),
        1
      )
    ).toMatchObject({ profileReady: true, complete: true, nextStep: "done" });
  });

  it("never reports complete without a verified wallet", () => {
    const state = getOnboardingState(
      playerStub({ usernameKey: "hero", avatarId: "chog-ember", onboardingStatus: "complete" }),
      0
    );
    expect(state.complete).toBe(false);
    expect(state.profileReady).toBe(true);
  });
});

describe("onboard body parsing", () => {
  it("accepts partial steps for resumability", () => {
    expect(parseOnboardBody({ avatarId: "chog-frost" })).toEqual({ avatarId: "chog-frost" });
    expect(parseOnboardBody({ username: "hero" })).toEqual({ username: "hero" });
  });

  it("rejects empty bodies", () => {
    expect(() => parseOnboardBody({})).toThrow(/at least one/i);
  });

  it("rejects invalid display names", () => {
    expect(() => validateDisplayName("")).toThrow();
    expect(() => validateDisplayName("a".repeat(33))).toThrow();
    expect(validateDisplayName("  Hero  ")).toBe("Hero");
  });
});

describe("profile patch permissions", () => {
  it("allows displayName and avatarId", () => {
    expect(parseProfilePatch({ displayName: "Hero" })).toEqual({ displayName: "Hero" });
    expect(parseProfilePatch({ avatarId: "chog-tide" })).toEqual({ avatarId: "chog-tide" });
  });

  it("forbids privileged fields", () => {
    for (const body of [
      { roles: ["ADMIN"] },
      { accountStatus: "active" },
      { privyDid: "did:privy:evil" },
      { id: "other-id" },
      { username: "steal" },
      { trophies: 9999 },
    ]) {
      expect(() => parseProfilePatch(body), JSON.stringify(body)).toThrow(/cannot be edited/i);
    }
  });
});

describe("public profile separation", () => {
  it("exposes only safe identity fields", () => {
    const profile = toPublicProfile(
      playerStub({ username: "Hero", usernameKey: "hero", displayName: "Hero", avatarId: "chog-ember" })
    );
    expect(profile).not.toBeNull();
    const keys = Object.keys(profile ?? {}).sort();
    expect(keys).toEqual(["avatar", "createdAt", "displayName", "id", "username"]);
    expect(profile?.avatar?.assetUrl).toBe("/avatars/chog-ember.svg");
  });

  it("has no public identity before username claim", () => {
    expect(toPublicProfile(playerStub())).toBeNull();
    expect(toPublicProfile(playerStub({ avatarId: "chog-ember" }))).toBeNull();
  });
});
