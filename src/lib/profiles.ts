import { getAvatar, listAvatars } from "@/lib/avatars";
import type { Player } from "@/db/schema";

export interface PublicAvatar {
  id: string;
  name: string;
  assetUrl: string;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatar: PublicAvatar | null;
  createdAt: Date;
}

export function resolveAvatar(avatarId: string | null): PublicAvatar | null {
  if (!avatarId) return null;
  const entry = getAvatar(avatarId);
  if (!entry) return null;
  return { id: entry.id, name: entry.name, assetUrl: entry.assetUrl };
}

// Only players with a claimed username have a public identity. Everything
// else (privyDid, status, wallets, roles, timestamps beyond creation) stays out.
export function toPublicProfile(player: Player): PublicProfile | null {
  if (!player.username) return null;
  return {
    id: player.id,
    username: player.username,
    displayName: player.displayName,
    avatar: resolveAvatar(player.avatarId),
    createdAt: player.createdAt,
  };
}

export { listAvatars };
