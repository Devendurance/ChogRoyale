import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { clanInvites, clanMembers, clans, players } from "@/db/schema";
import { getAcceptedFriendship } from "@/db/friendships";
import { canSociallyInteract } from "@/db/blocks";
import { AppError } from "@/lib/errors";

/** Provisional TEST policy: 30 members including the owner. */
export const CLAN_MAX_MEMBERS = 30;
export const CLAN_NAME_MIN = 3;
export const CLAN_NAME_MAX = 32;
export const CLAN_TAG_MIN = 2;
export const CLAN_TAG_MAX = 6;
export const CLAN_DESC_MAX = 280;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_RE = /^[A-Z0-9]{2,6}$/;

export type ClanRole = "owner" | "officer" | "member";

export interface ClanPeer {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
}

export interface ClanView {
  id: string;
  name: string;
  tag: string;
  description: string | null;
  ownerId: string;
  status: "active" | "archived";
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClanMemberView {
  player: ClanPeer;
  role: ClanRole;
  joinedAt: string;
}

export interface ClanInviteView {
  id: string;
  clan: { id: string; name: string; tag: string };
  inviter: ClanPeer;
  status: "pending" | "accepted" | "declined" | "expired";
  expiresAt: string;
  createdAt: string;
}

function toPeer(row: { id: string; username: string | null; displayName: string | null; avatarId: string | null }): ClanPeer {
  return { id: row.id, username: row.username, displayName: row.displayName, avatarId: row.avatarId };
}

function requireUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) throw new AppError("BAD_REQUEST", `${label} must be a valid id`);
}

export function normalizeClanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < CLAN_NAME_MIN || trimmed.length > CLAN_NAME_MAX) {
    throw new AppError("BAD_REQUEST", `Clan name must be ${CLAN_NAME_MIN}-${CLAN_NAME_MAX} characters`);
  }
  if (/[<>]/.test(trimmed)) throw new AppError("BAD_REQUEST", "Clan name cannot contain < or >");
  return trimmed;
}

export function normalizeClanTag(tag: string): { tag: string; tagKey: string } {
  const normalized = tag.trim().toUpperCase();
  if (!TAG_RE.test(normalized)) {
    throw new AppError("BAD_REQUEST", `Clan tag must be ${CLAN_TAG_MIN}-${CLAN_TAG_MAX} letters or digits`);
  }
  return { tag: normalized, tagKey: normalized };
}

export function normalizeClanDescription(description: string | null | undefined): string | null {
  if (description === null || description === undefined) return null;
  const trimmed = description.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > CLAN_DESC_MAX) throw new AppError("BAD_REQUEST", `Description must be ${CLAN_DESC_MAX} characters or fewer`);
  if (/[<>]/.test(trimmed)) throw new AppError("BAD_REQUEST", "Description cannot contain < or >");
  return trimmed;
}

async function onboardedPlayer(playerId: string): Promise<{ id: string } | null> {
  const rows = await getDb()
    .select({ id: players.id, onboardingStatus: players.onboardingStatus, usernameKey: players.usernameKey, avatarId: players.avatarId })
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1);
  const row = rows[0];
  if (!row || row.onboardingStatus !== "complete" || !row.usernameKey || !row.avatarId) return null;
  return { id: row.id };
}

async function memberCount(clanId: string): Promise<number> {
  const rows = await getDb()
    .select({ n: count() })
    .from(clanMembers)
    .where(eq(clanMembers.clanId, clanId));
  return rows[0]?.n ?? 0;
}

async function fetchClan(clanId: string) {
  const rows = await getDb().select().from(clans).where(eq(clans.id, clanId)).limit(1);
  return rows[0] ?? null;
}

async function myMembership(me: string, clanId: string) {
  const rows = await getDb()
    .select()
    .from(clanMembers)
    .where(and(eq(clanMembers.clanId, clanId), eq(clanMembers.playerId, me)))
    .limit(1);
  return rows[0] ?? null;
}

function toClanView(row: typeof clans.$inferSelect, members: number): ClanView {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    description: row.description,
    ownerId: row.ownerId,
    status: row.status as "active" | "archived",
    memberCount: members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Marks my stale pending invites expired. Expiry is time-based, not an action. */
async function touchExpiredInvites(me: string): Promise<void> {
  await getDb()
    .update(clanInvites)
    .set({ status: "expired", decidedAt: new Date() })
    .where(and(eq(clanInvites.target, me), eq(clanInvites.status, "pending"), sql`${clanInvites.expiresAt} < now()`));
}

/**
 * Creates a clan with the caller as owner. The clan row, owner membership
 * and active-clan pointer are written in order; the conditional pointer
 * claim (activeClanId is null) is the atomic one-active-clan check. A lost
 * race cleans up its own clan row, so no orphaned membership survives.
 */
export async function createClan(me: string, input: { name: string; tag: string; description?: string | null }): Promise<{ clan: ClanView; role: ClanRole }> {
  const name = normalizeClanName(input.name);
  const { tag, tagKey } = normalizeClanTag(input.tag);
  const description = normalizeClanDescription(input.description);
  const db = getDb();
  const mine = await db.select({ activeClanId: players.activeClanId }).from(players).where(eq(players.id, me)).limit(1);
  if (mine[0]?.activeClanId) throw new AppError("CONFLICT", "You are already in a clan");
  const taken = await db.select({ id: clans.id }).from(clans).where(eq(clans.tagKey, tagKey)).limit(1);
  if (taken[0]) throw new AppError("CONFLICT", "That clan tag is taken");
  let clanId: string;
  try {
    const inserted = await db.insert(clans).values({ name, tag, tagKey, description, ownerId: me }).returning({ id: clans.id });
    clanId = inserted[0].id;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError("CONFLICT", "That clan tag is taken");
    }
    throw err;
  }
  await db.insert(clanMembers).values({ clanId, playerId: me, role: "owner" }).onConflictDoNothing();
  const claimed = await db
    .update(players)
    .set({ activeClanId: clanId })
    .where(and(eq(players.id, me), isNull(players.activeClanId)))
    .returning({ id: players.id });
  if (claimed.length === 0) {
    await db.delete(clans).where(eq(clans.id, clanId));
    throw new AppError("CONFLICT", "You are already in a clan");
  }
  const clan = await fetchClan(clanId);
  if (!clan) throw new AppError("CONFLICT", "You are already in a clan");
  return { clan: toClanView(clan, 1), role: "owner" };
}

/** The caller's active clan, or a null clan when clanless. */
export async function getMyClan(me: string): Promise<{ clan: ClanView; role: ClanRole } | { clan: null }> {
  const db = getDb();
  const mine = await db.select({ activeClanId: players.activeClanId }).from(players).where(eq(players.id, me)).limit(1);
  const clanId = mine[0]?.activeClanId;
  if (!clanId) return { clan: null };
  const clan = await fetchClan(clanId);
  const membership = await myMembership(me, clanId);
  if (!clan || clan.status !== "active" || !membership) return { clan: null };
  return { clan: toClanView(clan, await memberCount(clanId)), role: membership.role as ClanRole };
}

/** Clan details with roster. Members only; everyone else gets NOT_FOUND. */
export async function getClan(me: string, clanId: string): Promise<{ clan: ClanView; members: ClanMemberView[]; myRole: ClanRole }> {
  requireUuid(clanId, "Clan");
  const clan = await fetchClan(clanId);
  if (!clan) throw new AppError("NOT_FOUND", "Clan not found");
  const membership = await myMembership(me, clanId);
  if (!membership) throw new AppError("NOT_FOUND", "Clan not found");
  const db = getDb();
  const rows = await db.select().from(clanMembers).where(eq(clanMembers.clanId, clanId)).orderBy(desc(clanMembers.joinedAt)).limit(CLAN_MAX_MEMBERS + 5);
  const profiles = await db
    .select({ id: players.id, username: players.username, displayName: players.displayName, avatarId: players.avatarId })
    .from(players)
    .where(inArray(players.id, rows.map((r) => r.playerId)));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const members: ClanMemberView[] = [];
  for (const row of rows) {
    const peer = byId.get(row.playerId);
    if (!peer) continue;
    members.push({ player: toPeer(peer), role: row.role as ClanRole, joinedAt: row.joinedAt.toISOString() });
  }
  return { clan: toClanView(clan, rows.length), members, myRole: membership.role as ClanRole };
}

/** Owner-only rename/description edit on an active clan. Tags are immutable. */
export async function updateClan(me: string, clanId: string, input: { name?: string; description?: string | null }): Promise<{ clan: ClanView }> {
  requireUuid(clanId, "Clan");
  if (input.name === undefined && input.description === undefined) throw new AppError("BAD_REQUEST", "Nothing to update");
  const clan = await fetchClan(clanId);
  if (!clan) throw new AppError("NOT_FOUND", "Clan not found");
  if (clan.status !== "active") throw new AppError("BAD_REQUEST", "This clan is archived");
  if (clan.ownerId !== me) throw new AppError("FORBIDDEN", "Only the clan owner can do that");
  const patch: { name?: string; description?: string | null; updatedAt?: Date } = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = normalizeClanName(input.name);
  if (input.description !== undefined) patch.description = normalizeClanDescription(input.description);
  const updated = await getDb().update(clans).set(patch).where(eq(clans.id, clanId)).returning();
  return { clan: toClanView(updated[0], await memberCount(clanId)) };
}

/**
 * Owner/officer invites a friend. Requires an accepted friendship with the
 * inviter and a clear block check in both directions; violations stay
 * neutral so nobody learns who blocked whom. One pending invite per
 * (clan, target); repeat invites return the existing one.
 */
export async function invitePlayer(me: string, clanId: string, targetId: string): Promise<{ invite: ClanInviteView }> {
  requireUuid(clanId, "Clan");
  requireUuid(targetId, "Player");
  if (me === targetId) throw new AppError("BAD_REQUEST", "You cannot invite yourself");
  const clan = await fetchClan(clanId);
  if (!clan) throw new AppError("NOT_FOUND", "Clan not found");
  if (clan.status !== "active") throw new AppError("BAD_REQUEST", "This clan is archived");
  const mine = await myMembership(me, clanId);
  if (!mine || (mine.role !== "owner" && mine.role !== "officer")) {
    throw new AppError("FORBIDDEN", "Only clan owners and officers can invite");
  }
  if (!(await onboardedPlayer(targetId))) throw new AppError("NOT_FOUND", "Player not found");
  if (!(await getAcceptedFriendship(me, targetId))) throw new AppError("FORBIDDEN", "This player is unavailable.");
  if ((await canSociallyInteract(me, targetId)).allowed === false) throw new AppError("FORBIDDEN", "This player is unavailable.");
  const db = getDb();
  if (await myMembership(targetId, clanId)) throw new AppError("BAD_REQUEST", "That player is already in this clan");
  const active = await db.select({ activeClanId: players.activeClanId }).from(players).where(eq(players.id, targetId)).limit(1);
  if (active[0]?.activeClanId) throw new AppError("FORBIDDEN", "This player is unavailable.");
  if ((await memberCount(clanId)) >= CLAN_MAX_MEMBERS) throw new AppError("CONFLICT", "This clan is full");
  await db.insert(clanInvites).values({ clanId, inviter: me, target: targetId }).onConflictDoNothing();
  const pending = await db
    .select()
    .from(clanInvites)
    .where(and(eq(clanInvites.clanId, clanId), eq(clanInvites.target, targetId), eq(clanInvites.status, "pending")))
    .limit(1);
  if (!pending[0]) throw new AppError("CONFLICT", "This clan is full");
  return { invite: await toInviteView(pending[0]) };
}

async function toInviteView(row: typeof clanInvites.$inferSelect): Promise<ClanInviteView> {
  const db = getDb();
  const [clan, inviter] = await Promise.all([
    fetchClan(row.clanId),
    db
      .select({ id: players.id, username: players.username, displayName: players.displayName, avatarId: players.avatarId })
      .from(players)
      .where(eq(players.id, row.inviter))
      .limit(1),
  ]);
  if (!clan || !inviter[0]) throw new AppError("NOT_FOUND", "Clan not found");
  return {
    id: row.id,
    clan: { id: clan.id, name: clan.name, tag: clan.tag },
    inviter: toPeer(inviter[0]),
    status: row.status as ClanInviteView["status"],
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** My pending, unexpired invitations with clan and inviter context. */
export async function listMyInvites(me: string): Promise<{ invites: ClanInviteView[] }> {
  await touchExpiredInvites(me);
  const db = getDb();
  const rows = await db
    .select()
    .from(clanInvites)
    .where(and(eq(clanInvites.target, me), eq(clanInvites.status, "pending")))
    .orderBy(desc(clanInvites.createdAt))
    .limit(50);
  const views: ClanInviteView[] = [];
  for (const row of rows) {
    try {
      views.push(await toInviteView(row));
    } catch {
      continue;
    }
  }
  return { invites: views.filter((v) => v.clan.id !== undefined) };
}

/**
 * Accepts an invitation. Re-validates friendship, both block directions,
 * clan capacity and the one-active-clan rule at the mutation boundary, so a
 * block, unfriend or competing accept that lands first wins. The membership
 * is secured before the invite is marked accepted; a lost last-slot race
 * repairs its own row.
 */
export async function acceptInvite(me: string, inviteId: string): Promise<{ clan: ClanView; role: ClanRole }> {
  requireUuid(inviteId, "Invitation");
  const db = getDb();
  const rows = await db.select().from(clanInvites).where(eq(clanInvites.id, inviteId)).limit(1);
  const invite = rows[0];
  if (!invite || invite.target !== me) throw new AppError("NOT_FOUND", "Invitation not found");
  if (invite.status === "accepted") {
    const current = await getMyClan(me);
    if (!current.clan || current.clan.id !== invite.clanId) throw new AppError("CONFLICT", "You are already in a clan");
    return { clan: current.clan, role: current.role };
  }
  if (invite.status !== "pending") throw new AppError("BAD_REQUEST", "This invitation is no longer pending");
  await touchExpiredInvites(me);
  const fresh = (await db.select().from(clanInvites).where(eq(clanInvites.id, inviteId)).limit(1))[0];
  if (!fresh || fresh.status !== "pending") throw new AppError("BAD_REQUEST", "This invitation has expired");
  const clan = await fetchClan(fresh.clanId);
  if (!clan || clan.status !== "active") throw new AppError("BAD_REQUEST", "This clan is unavailable");
  if (!(await getAcceptedFriendship(me, fresh.inviter))) throw new AppError("FORBIDDEN", "This player is unavailable.");
  if ((await canSociallyInteract(me, fresh.inviter)).allowed === false) throw new AppError("FORBIDDEN", "This player is unavailable.");
  if ((await memberCount(fresh.clanId)) >= CLAN_MAX_MEMBERS) throw new AppError("CONFLICT", "This clan is full");
  await db.insert(clanMembers).values({ clanId: fresh.clanId, playerId: me, role: "member" }).onConflictDoNothing();
  const claimed = await db
    .update(players)
    .set({ activeClanId: fresh.clanId })
    .where(and(eq(players.id, me), isNull(players.activeClanId)))
    .returning({ id: players.id });
  if (claimed.length === 0) {
    await db.delete(clanMembers).where(and(eq(clanMembers.clanId, fresh.clanId), eq(clanMembers.playerId, me)));
    throw new AppError("CONFLICT", "You are already in a clan");
  }
  if ((await memberCount(fresh.clanId)) > CLAN_MAX_MEMBERS) {
    await db.delete(clanMembers).where(and(eq(clanMembers.clanId, fresh.clanId), eq(clanMembers.playerId, me)));
    await db.update(players).set({ activeClanId: null }).where(and(eq(players.id, me), eq(players.activeClanId, fresh.clanId)));
    throw new AppError("CONFLICT", "This clan is full");
  }
  await db.update(clanInvites).set({ status: "accepted", decidedAt: new Date() }).where(eq(clanInvites.id, inviteId));
  const full = await fetchClan(fresh.clanId);
  if (!full) throw new AppError("NOT_FOUND", "Clan not found");
  return { clan: toClanView(full, await memberCount(fresh.clanId)), role: "member" };
}

/** Declines a pending invitation. Repeat declines succeed; accepted ones refuse. */
export async function declineInvite(me: string, inviteId: string): Promise<{ declined: true }> {
  requireUuid(inviteId, "Invitation");
  const db = getDb();
  const rows = await db.select().from(clanInvites).where(eq(clanInvites.id, inviteId)).limit(1);
  const invite = rows[0];
  if (!invite || invite.target !== me) throw new AppError("NOT_FOUND", "Invitation not found");
  if (invite.status === "declined" || invite.status === "expired") return { declined: true };
  if (invite.status !== "pending") throw new AppError("BAD_REQUEST", "This invitation is no longer pending");
  await db.update(clanInvites).set({ status: "declined", decidedAt: new Date() }).where(eq(clanInvites.id, inviteId));
  return { declined: true };
}

/** Leaves an active clan. Owners must transfer ownership or archive first. */
export async function leaveClan(me: string, clanId: string): Promise<{ left: true }> {
  requireUuid(clanId, "Clan");
  const membership = await myMembership(me, clanId);
  if (!membership) throw new AppError("NOT_FOUND", "Clan not found");
  if (membership.role === "owner") throw new AppError("BAD_REQUEST", "Transfer ownership or archive the clan first");
  const db = getDb();
  await db.delete(clanMembers).where(and(eq(clanMembers.clanId, clanId), eq(clanMembers.playerId, me)));
  await db.update(players).set({ activeClanId: null }).where(and(eq(players.id, me), eq(players.activeClanId, clanId)));
  return { left: true };
}

/**
 * Removes a member. Owners can remove officers and members; officers can
 * remove members only. The owner and self-removal (use leave) are refused.
 */
export async function removeMember(me: string, clanId: string, targetId: string): Promise<{ removed: true }> {
  requireUuid(clanId, "Clan");
  requireUuid(targetId, "Player");
  if (me === targetId) throw new AppError("BAD_REQUEST", "Use leave to exit your clan");
  const clan = await fetchClan(clanId);
  if (!clan) throw new AppError("NOT_FOUND", "Clan not found");
  if (clan.status !== "active") throw new AppError("BAD_REQUEST", "This clan is archived");
  const mine = await myMembership(me, clanId);
  if (!mine || (mine.role !== "owner" && mine.role !== "officer")) {
    throw new AppError("FORBIDDEN", "Only clan owners and officers can do that");
  }
  const target = await myMembership(targetId, clanId);
  if (!target) throw new AppError("NOT_FOUND", "Member not found");
  if (target.role === "owner") throw new AppError("BAD_REQUEST", "The owner cannot be removed");
  if (mine.role === "officer" && target.role !== "member") {
    throw new AppError("FORBIDDEN", "Officers can only remove members");
  }
  const db = getDb();
  await db.delete(clanMembers).where(and(eq(clanMembers.clanId, clanId), eq(clanMembers.playerId, targetId)));
  await db.update(players).set({ activeClanId: null }).where(and(eq(players.id, targetId), eq(players.activeClanId, clanId)));
  return { removed: true };
}

/** Owner-only officer promote/demote. No self changes, never touches the owner. */
export async function setMemberRole(me: string, clanId: string, targetId: string, role: ClanRole): Promise<{ member: ClanMemberView }> {
  requireUuid(clanId, "Clan");
  requireUuid(targetId, "Player");
  if (role !== "officer" && role !== "member") throw new AppError("BAD_REQUEST", "Role must be officer or member");
  if (me === targetId) throw new AppError("BAD_REQUEST", "You cannot change your own role");
  const clan = await fetchClan(clanId);
  if (!clan) throw new AppError("NOT_FOUND", "Clan not found");
  if (clan.status !== "active") throw new AppError("BAD_REQUEST", "This clan is archived");
  if (clan.ownerId !== me) throw new AppError("FORBIDDEN", "Only the clan owner can do that");
  const target = await myMembership(targetId, clanId);
  if (!target) throw new AppError("NOT_FOUND", "Member not found");
  if (target.role === "owner") throw new AppError("BAD_REQUEST", "The owner role transfers, it is never assigned");
  const db = getDb();
  if (target.role === role) {
    const peer = await db
      .select({ id: players.id, username: players.username, displayName: players.displayName, avatarId: players.avatarId })
      .from(players)
      .where(eq(players.id, targetId))
      .limit(1);
    if (!peer[0]) throw new AppError("NOT_FOUND", "Member not found");
    return { member: { player: toPeer(peer[0]), role: target.role as ClanRole, joinedAt: target.joinedAt.toISOString() } };
  }
  const updated = await db
    .update(clanMembers)
    .set({ role })
    .where(and(eq(clanMembers.clanId, clanId), eq(clanMembers.playerId, targetId), ne(clanMembers.role, "owner")))
    .returning();
  if (updated.length === 0) throw new AppError("CONFLICT", "That member changed. Refresh and try again.");
  const peer = await db
    .select({ id: players.id, username: players.username, displayName: players.displayName, avatarId: players.avatarId })
    .from(players)
    .where(eq(players.id, targetId))
    .limit(1);
  if (!peer[0]) throw new AppError("NOT_FOUND", "Member not found");
  return { member: { player: toPeer(peer[0]), role, joinedAt: updated[0].joinedAt.toISOString() } };
}

/**
 * Owner-only ownership transfer. The two role changes happen in one
 * statement guarded by both preconditions (affected must be exactly 2), so
 * concurrent transfers cannot strand zero or two owners. The clan owner
 * pointer follows; if it loses its own race the roles are repaired.
 */
export async function transferOwnership(me: string, clanId: string, targetId: string): Promise<{ clan: ClanView }> {
  requireUuid(clanId, "Clan");
  requireUuid(targetId, "Player");
  if (me === targetId) throw new AppError("BAD_REQUEST", "You already own this clan");
  const clan = await fetchClan(clanId);
  if (!clan) throw new AppError("NOT_FOUND", "Clan not found");
  if (clan.status !== "active") throw new AppError("BAD_REQUEST", "This clan is archived");
  if (clan.ownerId !== me) throw new AppError("FORBIDDEN", "Only the clan owner can do that");
  const db = getDb();
  const swapped = await db.execute(sql`update "clan_members" set "role" = case when "player_id" = ${me} then 'member' else 'owner' end
    where "clan_id" = ${clanId} and (("player_id" = ${me} and "role" = 'owner') or ("player_id" = ${targetId} and "role" in ('officer','member')))
    returning "player_id"`);
  const affected = (swapped.rows as unknown[]).length;
  if (affected !== 2) {
    throw new AppError("CONFLICT", "That member changed. Refresh and try again.");
  }
  const pointed = await db
    .update(clans)
    .set({ ownerId: targetId, updatedAt: new Date() })
    .where(and(eq(clans.id, clanId), eq(clans.ownerId, me)))
    .returning({ id: clans.id });
  if (pointed.length === 0) {
    await db.execute(sql`update "clan_members" set "role" = case when "player_id" = ${me} then 'owner' else 'member' end
      where "clan_id" = ${clanId} and "player_id" in (${me}, ${targetId})`);
    throw new AppError("CONFLICT", "Ownership changed. Refresh and try again.");
  }
  const full = await fetchClan(clanId);
  if (!full) throw new AppError("NOT_FOUND", "Clan not found");
  return { clan: toClanView(full, await memberCount(clanId)) };
}

/**
 * Owner-only archive. Membership and invite rows are kept, so the clan
 * stays auditable; every member's active pointer is cleared in one pass.
 */
export async function archiveClan(me: string, clanId: string): Promise<{ clan: ClanView }> {
  requireUuid(clanId, "Clan");
  const clan = await fetchClan(clanId);
  if (!clan) throw new AppError("NOT_FOUND", "Clan not found");
  if (clan.status !== "active") throw new AppError("BAD_REQUEST", "This clan is already archived");
  if (clan.ownerId !== me) throw new AppError("FORBIDDEN", "Only the clan owner can do that");
  const db = getDb();
  const archived = await db
    .update(clans)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(clans.id, clanId), eq(clans.status, "active")))
    .returning();
  if (archived.length === 0) throw new AppError("CONFLICT", "This clan changed. Refresh and try again.");
  await db.execute(sql`update "players" set "active_clan_id" = null where "active_clan_id" = ${clanId}::uuid`);
  return { clan: toClanView(archived[0], await memberCount(clanId)) };
}
