import { describe, it, expect } from "vitest";
import { emptyLists, friendHandle, friendName, listChip, searchAction, searchChip, searchReady } from "./friends-model";
import type { FriendEntry, FriendLists, FriendSearchHit } from "./friends-types";

const entry = (over: Partial<FriendEntry> = {}): FriendEntry => ({
  friendshipId: "f1",
  status: "accepted",
  incoming: false,
  player: { id: "p1", username: "blossom", displayName: "Blossom", avatarId: "chog-1" },
  since: "2026-10-23T00:00:00.000Z",
  ...over,
});

const hit = (over: Partial<FriendSearchHit> = {}): FriendSearchHit => ({
  player: { id: "p2", username: "endychog", displayName: null, avatarId: null },
  status: "none",
  friendshipId: null,
  ...over,
});

describe("friends model", () => {
  it("names and handles fall back honestly", () => {
    expect(friendName(entry())).toBe("Blossom");
    expect(friendName(entry({ player: { id: "p", username: "endychog", displayName: null, avatarId: null } }))).toBe(
      "endychog"
    );
    expect(friendHandle(entry())).toBe("@blossom");
    expect(
      friendHandle(entry({ player: { id: "p", username: null, displayName: null, avatarId: null } }))
    ).toBe("No username yet");
  });

  it("labels list rows by relationship", () => {
    expect(listChip(entry())).toBe("Friends");
    expect(listChip(entry({ status: "pending", incoming: false }))).toBe("Request sent");
    expect(listChip(entry({ status: "pending", incoming: true }))).toBe("Wants to be friends");
  });

  it("maps search hits to actions or honest chips", () => {
    expect(searchAction(hit())).toBe("Add");
    expect(searchAction(hit({ status: "incoming" }))).toBe("Accept");
    expect(searchAction(hit({ status: "outgoing" }))).toBeNull();
    expect(searchAction(hit({ status: "friends" }))).toBeNull();
    expect(searchChip(hit({ status: "outgoing" }))).toBe("Request sent");
    expect(searchChip(hit({ status: "friends" }))).toBe("Friends");
    expect(searchChip(hit())).toBeNull();
  });

  it("detects empty lists and blank searches", () => {
    const empty: FriendLists = { friends: [], incoming: [], outgoing: [] };
    expect(emptyLists(empty)).toBe(true);
    expect(emptyLists({ ...empty, friends: [entry()] })).toBe(false);
    expect(searchReady("  ")).toBe(false);
    expect(searchReady("blo")).toBe(true);
  });
});
