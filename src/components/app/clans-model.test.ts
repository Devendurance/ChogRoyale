import { describe, expect, it } from "vitest";
import {
  ClanError,
  clanErrorMessage,
  clanPeerName,
  isClan,
  permissionsFor,
  validClanFields,
} from "./clans-model";

const clan = {
  id: "clan-1",
  name: "Chaos Crossing",
  tag: "CHOG",
  description: null,
  ownerId: "player-1",
  status: "active" as const,
  memberCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("clan model", () => {
  it("validates server clan payloads and rejects malformed dates", () => {
    expect(isClan(clan)).toBe(true);
    expect(isClan({ ...clan, memberCount: 2.5 })).toBe(false);
    expect(isClan({ ...clan, createdAt: "yesterday" })).toBe(false);
  });

  it("keeps creation constraints aligned with the server", () => {
    expect(validClanFields("Chaos Crossing", "A friendly place", "chog")).toBe(true);
    expect(validClanFields("No", "", "CHOG")).toBe(false);
    expect(validClanFields("Chaos Crossing", "<unsafe>", "CHOG")).toBe(false);
    expect(validClanFields("Chaos Crossing", "ok", "TOO-LONG")).toBe(false);
  });

  it("exposes only role-appropriate management actions", () => {
    expect(permissionsFor("owner", "member")).toMatchObject({ invite: true, edit: true, remove: true, changeRole: true, transfer: true, leave: false });
    expect(permissionsFor("officer", "member")).toMatchObject({ invite: true, edit: false, remove: true, changeRole: false, transfer: false, leave: true });
    expect(permissionsFor("officer", "officer").remove).toBe(false);
    expect(permissionsFor("member").invite).toBe(false);
  });

  it("uses neutral, actionable error copy for server outcomes", () => {
    expect(new ClanError(409, "CONFLICT", "That clan tag is taken").message).toContain("tag is taken");
    expect(clanErrorMessage(500)).toContain("unavailable");
    expect(clanPeerName({ id: "p", username: "chog", displayName: null, avatarId: null })).toBe("chog");
  });
});
