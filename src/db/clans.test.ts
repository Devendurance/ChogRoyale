import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { acceptRequest, listFriendships, removeFriendship, sendRequest } from "@/db/friendships";
import { blockPlayer } from "@/db/blocks";
import {
  acceptInvite,
  archiveClan,
  createClan,
  declineInvite,
  getClan,
  getMyClan,
  invitePlayer,
  leaveClan,
  listMyInvites,
  removeMember,
  setMemberRole,
  transferOwnership,
  updateClan,
  CLAN_MAX_MEMBERS,
} from "@/db/clans";
import { clanInvites, clanMembers, clans, players, type Player } from "@/db/schema";

// Write suite: must target the isolated TEST branch, never DATABASE_URL.
beforeAll(() => {
  routeDalToTestDb();
}, 60000);

beforeAll(async () => {
  await getDb().delete(clanInvites);
  await getDb().delete(clanMembers);
  await getDb().delete(clans);
}, 60000);

const createdPlayerIds: string[] = [];
// Fixture-only member rows: no username/onboarding needed since fixtures
// never invite or get invited. Saves one round trip per filler.
const mkRawPlayer = async (name: string): Promise<Player> => {
  const tag = `clan_${name}_${randomUUID().slice(0, 8)}`;
  const p = await provisionPlayer({ privyDid: `did:privy:${tag}` });
  createdPlayerIds.push(p.id);
  return p;
};
const mkPlayer = async (name: string): Promise<Player> => {
  const tag = `clan_${name}_${randomUUID().slice(0, 8)}`;
  const p = await provisionPlayer({ privyDid: `did:privy:${tag}` });
  await getDb()
    .update(players)
    .set({ username: tag.slice(0, 20), usernameKey: tag.slice(0, 20), avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id));
  createdPlayerIds.push(p.id);
  return p;
};

const befriend = async (a: Player, b: Player) => {
  const sent = await sendRequest(a.id, b.id);
  await acceptRequest(b.id, sent.friendshipId);
};

const mkClan = (owner: Player, suffix: string) =>
  createClan(owner.id, { name: `Clan ${suffix}`, tag: `C${suffix.slice(0, 5).toUpperCase()}`, description: null });

afterAll(async () => {
  await getDb().delete(clanInvites);
  await getDb().delete(clanMembers);
  await getDb().delete(clans);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
}, 60000);

describe("clans", () => {
  it("creates a clan with the founder as owner", async () => {
    const owner = await mkPlayer("own");
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const { clan, role } = await createClan(owner.id, { name: " Ember Guard ", tag, description: "  Defenders  " });
    expect(role).toBe("owner");
    expect(clan.name).toBe("Ember Guard");
    expect(clan.tag).toBe(tag);
    expect(clan.ownerId).toBe(owner.id);
    expect(clan.status).toBe("active");
    expect(clan.memberCount).toBe(1);
    expect(clan.description).toBe("Defenders");
    const mine = await getMyClan(owner.id);
    expect(mine.clan && mine.clan.id).toBe(clan.id);
  });

  it("validates name, tag and description", async () => {
    const owner = await mkPlayer("val");
    await expect(createClan(owner.id, { name: "ab", tag: "OK12" })).rejects.toThrow();
    await expect(createClan(owner.id, { name: "x".repeat(33), tag: "OK13" })).rejects.toThrow();
    await expect(createClan(owner.id, { name: "Bad <name>", tag: "OK14" })).rejects.toThrow();
    await expect(createClan(owner.id, { name: "Valid Name", tag: "x" })).rejects.toThrow();
    await expect(createClan(owner.id, { name: "Valid Name", tag: "toolong7" })).rejects.toThrow();
    await expect(createClan(owner.id, { name: "Valid Name", tag: "bad tag" })).rejects.toThrow();
    await expect(createClan(owner.id, { name: "Valid Name", tag: "OK15", description: "y".repeat(281) })).rejects.toThrow();
  });

  it("rejects duplicate tags case-insensitively but allows duplicate names", async () => {
    const a = await mkPlayer("taga");
    const b = await mkPlayer("tagb");
    const tag = randomUUID().slice(0, 5).toUpperCase();
    await createClan(a.id, { name: "Same Name", tag });
    await expect(createClan(b.id, { name: "Other", tag: tag.toLowerCase() })).rejects.toThrowError(/taken/i);
    const second = await createClan(b.id, { name: "Same Name", tag: `Z${tag.slice(0, 4)}` });
    expect(second.clan.name).toBe("Same Name");
  });

  it("enforces one active clan per player, including simultaneous creation", async () => {
    const owner = await mkPlayer("one");
    await mkClan(owner, randomUUID().slice(0, 6));
    await expect(mkClan(owner, randomUUID().slice(0, 6))).rejects.toThrowError(/already in a clan/i);
    const racer = await mkPlayer("onerace");
    const t1 = randomUUID().slice(0, 5).toUpperCase();
    const t2 = `Q${t1.slice(0, 4)}`;
    const [r1, r2] = await Promise.allSettled([
      createClan(racer.id, { name: "Race One", tag: t1 }),
      createClan(racer.id, { name: "Race Two", tag: t2 }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual(["fulfilled", "rejected"]);
    const mine = await getMyClan(racer.id);
    expect(mine.clan !== null && mine.clan).toBeTruthy();
    const rows = await getDb().select().from(clanMembers).where(eq(clanMembers.playerId, racer.id));
    expect(rows).toHaveLength(1);
  });

  it("runs the invite lifecycle with idempotent accept and decline", async () => {
    const owner = await mkPlayer("inv_o");
    const target = await mkPlayer("inv_t");
    await befriend(owner, target);
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    const first = await invitePlayer(owner.id, clan.id, target.id);
    expect(first.invite.status).toBe("pending");
    const repeat = await invitePlayer(owner.id, clan.id, target.id);
    expect(repeat.invite.id).toBe(first.invite.id);
    expect((await listMyInvites(target.id)).invites).toHaveLength(1);
    const accepted = await acceptInvite(target.id, first.invite.id);
    expect(accepted.role).toBe("member");
    expect((await getMyClan(target.id)).clan?.id).toBe(clan.id);
    const again = await acceptInvite(target.id, first.invite.id);
    expect(again.clan.id).toBe(clan.id);
    const other = await mkPlayer("inv_o2");
    const otherTarget = await mkPlayer("inv_t2");
    await befriend(other, otherTarget);
    const c2 = await mkClan(other, randomUUID().slice(0, 6));
    const inv2 = await invitePlayer(other.id, c2.clan.id, otherTarget.id);
    expect(await declineInvite(otherTarget.id, inv2.invite.id)).toEqual({ declined: true });
    expect(await declineInvite(otherTarget.id, inv2.invite.id)).toEqual({ declined: true });
    await expect(acceptInvite(otherTarget.id, inv2.invite.id)).rejects.toThrow();
  });

  it("requires an accepted friendship for invites", async () => {
    const owner = await mkPlayer("fri_o");
    const stranger = await mkPlayer("fri_s");
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    await expect(invitePlayer(owner.id, clan.id, stranger.id)).rejects.toThrowError(/unavailable/i);
    await sendRequest(owner.id, stranger.id);
    await expect(invitePlayer(owner.id, clan.id, stranger.id)).rejects.toThrowError(/unavailable/i);
  });

  it("enforces blocks in both directions on invite and accept", async () => {
    const owner = await mkPlayer("blk_o");
    const target = await mkPlayer("blk_t");
    await befriend(owner, target);
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    await blockPlayer(owner.id, target.id);
    await expect(invitePlayer(owner.id, clan.id, target.id)).rejects.toThrowError(/unavailable/i);

    const o2 = await mkPlayer("blk_o2");
    const t2 = await mkPlayer("blk_t2");
    await befriend(o2, t2);
    const c2 = await mkClan(o2, randomUUID().slice(0, 6));
    const inv = await invitePlayer(o2.id, c2.clan.id, t2.id);
    await blockPlayer(t2.id, o2.id);
    await expect(acceptInvite(t2.id, inv.invite.id)).rejects.toThrowError(/unavailable/i);
  });

  it("refuses accept after friendship removal", async () => {
    const owner = await mkPlayer("unf_o");
    const target = await mkPlayer("unf_t");
    await befriend(owner, target);
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    const inv = await invitePlayer(owner.id, clan.id, target.id);
    const lists = await listFriendships(owner.id);
    expect(lists.friends).toHaveLength(1);
    await removeFriendship(owner.id, lists.friends[0].friendshipId);
    await expect(acceptInvite(target.id, inv.invite.id)).rejects.toThrowError(/unavailable/i);
  });

  it("expires invitations after the provisional window", async () => {
    const owner = await mkPlayer("exp_o");
    const target = await mkPlayer("exp_t");
    await befriend(owner, target);
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    const inv = await invitePlayer(owner.id, clan.id, target.id);
    await getDb()
      .update(clanInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(clanInvites.id, inv.invite.id));
    await expect(acceptInvite(target.id, inv.invite.id)).rejects.toThrowError(/expired/i);
    expect((await listMyInvites(target.id)).invites).toHaveLength(0);
  });

  it("enforces officer and member permissions", async () => {
    const owner = await mkPlayer("perm_o");
    const officer = await mkPlayer("perm_f");
    const member = await mkPlayer("perm_m");
    const outsider = await mkPlayer("perm_x");
    await befriend(owner, officer);
    await befriend(owner, member);
    await befriend(owner, outsider);
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    const io = await invitePlayer(owner.id, clan.id, officer.id);
    await acceptInvite(officer.id, io.invite.id);
    const im = await invitePlayer(owner.id, clan.id, member.id);
    await acceptInvite(member.id, im.invite.id);

    await expect(invitePlayer(member.id, clan.id, outsider.id)).rejects.toThrowError(/owners and officers/i);
    await setMemberRole(owner.id, clan.id, officer.id, "officer");
    await befriend(officer, outsider);
    const io2 = await invitePlayer(officer.id, clan.id, outsider.id);
    expect(io2.invite.status).toBe("pending");

    await expect(updateClan(member.id, clan.id, { name: "Hijack" })).rejects.toThrow();
    await expect(updateClan(officer.id, clan.id, { name: "Hijack" })).rejects.toThrow();
    const updated = await updateClan(owner.id, clan.id, { name: "New Name" });
    expect(updated.clan.name).toBe("New Name");

    await expect(setMemberRole(officer.id, clan.id, member.id, "officer")).rejects.toThrow();
    await expect(setMemberRole(owner.id, clan.id, owner.id, "member")).rejects.toThrow();
    await expect(setMemberRole(owner.id, clan.id, member.id, "owner" as never)).rejects.toThrow();
    const promoted = await setMemberRole(owner.id, clan.id, member.id, "officer");
    expect(promoted.member.role).toBe("officer");

    await expect(removeMember(officer.id, clan.id, member.id)).rejects.toThrow();
    await expect(removeMember(member.id, clan.id, officer.id)).rejects.toThrow();
    const removed = await removeMember(owner.id, clan.id, member.id);
    expect(removed).toEqual({ removed: true });
    expect((await getMyClan(member.id)).clan).toBeNull();

    await expect(removeMember(owner.id, clan.id, owner.id)).rejects.toThrow();
    await expect(leaveClan(owner.id, clan.id)).rejects.toThrowError(/transfer|archive/i);
    expect(await leaveClan(officer.id, clan.id)).toEqual({ left: true });
  });

  it("transfers ownership with exactly one owner", async () => {
    const owner = await mkPlayer("tr_o");
    const next = await mkPlayer("tr_n");
    await befriend(owner, next);
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    const inv = await invitePlayer(owner.id, clan.id, next.id);
    await acceptInvite(next.id, inv.invite.id);
    const moved = await transferOwnership(owner.id, clan.id, next.id);
    expect(moved.clan.ownerId).toBe(next.id);
    const roster = await getClan(next.id, clan.id);
    expect(roster.members.find((m) => m.player.id === next.id)?.role).toBe("owner");
    expect(roster.members.find((m) => m.player.id === owner.id)?.role).toBe("member");
    await expect(transferOwnership(owner.id, clan.id, owner.id)).rejects.toThrow();
    const back = await transferOwnership(next.id, clan.id, owner.id);
    expect(back.clan.ownerId).toBe(owner.id);
  });

  it("keeps a single owner under concurrent transfers", async () => {
    const owner = await mkPlayer("ctr_o");
    const a = await mkPlayer("ctr_a");
    const b = await mkPlayer("ctr_b");
    await befriend(owner, a);
    await befriend(owner, b);
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    const ia = await invitePlayer(owner.id, clan.id, a.id);
    await acceptInvite(a.id, ia.invite.id);
    const ib = await invitePlayer(owner.id, clan.id, b.id);
    await acceptInvite(b.id, ib.invite.id);
    const [r1, r2] = await Promise.allSettled([
      transferOwnership(owner.id, clan.id, a.id),
      transferOwnership(owner.id, clan.id, b.id),
    ]);
    expect([r1.status, r2.status].sort()).toEqual(["fulfilled", "rejected"]);
    const owners = await getDb()
      .select()
      .from(clanMembers)
      .where(and(eq(clanMembers.clanId, clan.id), eq(clanMembers.role, "owner")));
    expect(owners).toHaveLength(1);
  });

  it("archives with history retained and pointers cleared", async () => {
    const owner = await mkPlayer("arc_o");
    const member = await mkPlayer("arc_m");
    await befriend(owner, member);
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    const inv = await invitePlayer(owner.id, clan.id, member.id);
    await acceptInvite(member.id, inv.invite.id);
    const archived = await archiveClan(owner.id, clan.id);
    expect(archived.clan.status).toBe("archived");
    expect((await getMyClan(owner.id)).clan).toBeNull();
    expect((await getMyClan(member.id)).clan).toBeNull();
    const details = await getClan(member.id, clan.id);
    expect(details.clan.status).toBe("archived");
    expect(details.members).toHaveLength(2);
    await expect(updateClan(owner.id, clan.id, { name: "Nope" })).rejects.toThrow();
    const stranger = await mkPlayer("arc_s");
    await befriend(owner, stranger);
    await expect(invitePlayer(owner.id, clan.id, stranger.id)).rejects.toThrow();
    await expect(archiveClan(owner.id, clan.id)).rejects.toThrow();
  });

  it("holds the member cap under a last-slot race", async () => {
    const owner = await mkPlayer("cap_o");
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    const fillerIds: string[] = [];
    for (let i = 0; i < CLAN_MAX_MEMBERS - 2; i++) {
      const m = await mkRawPlayer(`capf${i}`);
      fillerIds.push(m.id);
    }
    await getDb().insert(clanMembers).values(fillerIds.map((id) => ({ clanId: clan.id, playerId: id, role: "member" as const })));
    await getDb().update(players).set({ activeClanId: clan.id }).where(inArray(players.id, fillerIds));
    const t1 = await mkPlayer("cap_t1");
    const t2 = await mkPlayer("cap_t2");
    await befriend(owner, t1);
    await befriend(owner, t2);
    const i1 = await invitePlayer(owner.id, clan.id, t1.id);
    const i2 = await invitePlayer(owner.id, clan.id, t2.id);
    const [r1, r2] = await Promise.allSettled([acceptInvite(t1.id, i1.invite.id), acceptInvite(t2.id, i2.invite.id)]);
    expect([r1.status, r2.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rows = await getDb().select().from(clanMembers).where(eq(clanMembers.clanId, clan.id));
    expect(rows).toHaveLength(CLAN_MAX_MEMBERS);
  });

  it("refuses a 31st member outside any race", async () => {
    const owner = await mkPlayer("cap2_o");
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    const fillerIds: string[] = [];
    for (let i = 0; i < CLAN_MAX_MEMBERS - 1; i++) {
      const m = await mkRawPlayer(`cap2f${i}`);
      fillerIds.push(m.id);
    }
    await getDb().insert(clanMembers).values(fillerIds.map((id) => ({ clanId: clan.id, playerId: id, role: "member" as const })));
    await getDb().update(players).set({ activeClanId: clan.id }).where(inArray(players.id, fillerIds));
    const extra = await mkPlayer("cap2_x");
    await befriend(owner, extra);
    await expect(invitePlayer(owner.id, clan.id, extra.id)).rejects.toThrowError(/full/i);
  });

  it("hides clan details from strangers", async () => {
    const owner = await mkPlayer("hid_o");
    const stranger = await mkPlayer("hid_s");
    const { clan } = await mkClan(owner, randomUUID().slice(0, 6));
    await expect(getClan(stranger.id, clan.id)).rejects.toThrowError(/not found/i);
    await expect(getClan(stranger.id, randomUUID())).rejects.toThrowError(/not found|valid/i);
  });
});
