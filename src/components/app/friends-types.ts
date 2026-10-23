import type { LobbyNotice, LobbyPlayer } from "./lobby-types";

export type FriendsPhase = "booting" | "login" | "profile" | "ready";

export interface FriendEntry {
  friendshipId: string;
  status: "pending" | "accepted";
  incoming: boolean;
  player: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarId: string | null;
  };
  since: string;
}

export interface FriendLists {
  friends: FriendEntry[];
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
}

export interface FriendSearchHit {
  player: FriendEntry["player"];
  status: "none" | "outgoing" | "incoming" | "friends";
  friendshipId: string | null;
}

export interface FriendsApiError {
  code: string;
  message: string;
}

export interface FriendsViewProps {
  phase: FriendsPhase;
  player: LobbyPlayer | null;
  lists: FriendLists;
  listsState: "ready" | "empty" | "unavailable";
  searchQuery: string;
  searchHits: FriendSearchHit[] | null;
  searchState: "idle" | "ready" | "empty" | "unavailable";
  actionId: string | null;
  busy: boolean;
  notices: LobbyNotice[];
  calm: boolean;
  status: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onSend: (playerId: string) => void;
  onAccept: (friendshipId: string) => void;
  onDecline: (friendshipId: string) => void;
  onRemove: (friendshipId: string) => void;
}
