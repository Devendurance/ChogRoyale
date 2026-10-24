import type { ClanInviteView, ClanMemberView, ClanPeer as ServerClanPeer, ClanRole as ServerClanRole, ClanView } from "@/db/clans";

// Keep client models tied to the server-owned route contract. Runtime guards
// below validate untrusted JSON before it reaches the view.
export type ClanRole = ServerClanRole;
export type ClanPeer = ServerClanPeer;
export type Clan = ClanView;
export type ClanMember = ClanMemberView;
export type ClanInvite = ClanInviteView;
export type MyClan = { clan: null } | { clan: Clan; role: ClanRole };
export interface ClanDetail { clan: Clan; members: ClanMember[]; myRole: ClanRole }
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const textOrNull = (value: unknown) => value === null || typeof value === "string";
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
export const isClanRole = (value: unknown): value is ClanRole => value === "owner" || value === "officer" || value === "member";
export function isClanPeer(value: unknown): value is ClanPeer {
  return object(value) && typeof value.id === "string" && textOrNull(value.username) && textOrNull(value.displayName) && textOrNull(value.avatarId);
}
export function isClan(value: unknown): value is Clan {
  return object(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.tag === "string" && textOrNull(value.description) && typeof value.ownerId === "string" && (value.status === "active" || value.status === "archived") && typeof value.memberCount === "number" && Number.isInteger(value.memberCount) && value.memberCount >= 0 && date(value.createdAt) && date(value.updatedAt);
}
export function isMyClan(value: unknown): value is MyClan {
  return object(value) && (value.clan === null || (isClan(value.clan) && isClanRole(value.role)));
}
export function isClanDetail(value: unknown): value is ClanDetail {
  return object(value) && isClan(value.clan) && isClanRole(value.myRole) && Array.isArray(value.members) && value.members.every((row: unknown) => object(row) && isClanPeer(row.player) && isClanRole(row.role) && date(row.joinedAt));
}
export function isClanInvite(value: unknown): value is ClanInvite {
  return object(value) && typeof value.id === "string" && object(value.clan) && typeof value.clan.id === "string" && typeof value.clan.name === "string" && typeof value.clan.tag === "string" && isClanPeer(value.inviter) && ["pending", "accepted", "declined", "expired"].includes(String(value.status)) && date(value.expiresAt) && date(value.createdAt);
}
export function permissionsFor(role: ClanRole, targetRole?: ClanRole, self = false) {
  return {
    invite: role === "owner" || role === "officer",
    edit: role === "owner",
    leave: role !== "owner",
    archive: role === "owner",
    remove: !self && targetRole !== undefined && targetRole !== "owner" && (role === "owner" || (role === "officer" && targetRole === "member")),
    changeRole: !self && role === "owner" && targetRole !== undefined && targetRole !== "owner",
    transfer: !self && role === "owner" && targetRole !== undefined && targetRole !== "owner",
  };
}
export function validClanFields(name: string, description: string, tag?: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  return normalized.length >= 3 && normalized.length <= 32 && !/[<>]/.test(normalized) && description.trim().length <= 280 && !/[<>]/.test(description) && (tag === undefined || /^[A-Z0-9]{2,6}$/i.test(tag.trim()));
}
export function clanPeerName(peer: ClanPeer) { return peer.displayName?.trim() || peer.username?.trim() || "Player"; }
export class ClanError extends Error {
  constructor(public status: number, public code = "", serverMessage = "") {
    super(clanErrorMessage(status, serverMessage));
  }
}
export function clanErrorMessage(status: number, serverMessage = "") {
  if (status === 401) return "Your session expired. Sign in again to open clans.";
  if (status === 403) return "This action is unavailable. Refresh your clan or finish your account setup.";
  if (status === 404) return "This clan, member or invitation is no longer available. Refresh to check your membership.";
  if (status === 409) {
    if (serverMessage === "That clan tag is taken") return "That clan tag is taken. Choose another tag.";
    if (serverMessage === "This clan is full") return "This clan is full. Refresh to check its membership.";
    return "Your clan or membership changed. Refresh and review the current state before trying again.";
  }
  if (status === 400) return "This change couldn't be accepted. Check the form and refresh expired invitations.";
  if (status === 429) return "Too many requests. Wait a moment before trying again.";
  return "Clans are unavailable right now. Refresh to check the server. Your form entries are still here.";
}
export async function clanRequest<T>(path: string, getToken: () => Promise<string | null>, method = "GET", body?: unknown): Promise<T> {
  try {
    const token = await getToken();
    if (!token) throw new ClanError(401);
    const response = await fetch(path, { method, cache: "no-store", headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const envelope: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = object(envelope) && object(envelope.error) ? envelope.error : {};
      throw new ClanError(response.status, typeof error.code === "string" ? error.code : "", typeof error.message === "string" ? error.message : "");
    }
    if (!object(envelope) || envelope.success !== true || !object(envelope.data)) throw new ClanError(503);
    return envelope.data as T;
  } catch (error) { throw error instanceof ClanError ? error : new ClanError(503); }
}
