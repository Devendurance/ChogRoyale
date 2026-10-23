import type { FriendEntry, FriendLists, FriendSearchHit } from "./friends-types";

export function friendName(entry: Pick<FriendEntry, "player">): string {
  return entry.player.displayName || entry.player.username || "Player";
}

export function friendHandle(entry: Pick<FriendEntry, "player">): string {
  return entry.player.username ? `@${entry.player.username}` : "No username yet";
}

export function listChip(entry: FriendEntry): string {
  if (entry.status === "accepted") return "Friends";
  return entry.incoming ? "Wants to be friends" : "Request sent";
}

/** Primary action label for a search hit, or null when no action applies. */
export function searchAction(hit: FriendSearchHit): "Add" | "Accept" | null {
  if (hit.status === "none") return "Add";
  if (hit.status === "incoming") return "Accept";
  return null;
}

export function searchChip(hit: FriendSearchHit): string | null {
  if (hit.status === "outgoing") return "Request sent";
  if (hit.status === "friends") return "Friends";
  return null;
}

export function emptyLists(lists: FriendLists): boolean {
  return lists.friends.length === 0 && lists.incoming.length === 0 && lists.outgoing.length === 0;
}

export function searchReady(query: string): boolean {
  return query.trim().length > 0;
}
