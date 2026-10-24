import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { sendRequest, acceptRequest } from "@/db/friendships";
import { clanInvites, clanMembers, clans, players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GET as myGet, POST as createPost } from "./route";
import { GET as detailsGet, PATCH as updatePatch } from "./[id]/route";
import { POST as invitePost } from "./[id]/invites/route";
import { GET as invitesGet } from "./invites/route";
import { POST as acceptPost } from "./invites/[inviteId]/accept/route";
import { POST as declinePost } from "./invites/[inviteId]/decline/route";
import { POST as leavePost } from "./[id]/leave/route";
import { DELETE as removeDelete } from "./[id]/members/[playerId]/route";
import { POST as rolePost } from "./[id]/members/[playerId]/role/route";
import { POST as transferPost } from "./[id]/transfer/route";
import { POST as archivePost } from "./[id]/archive/route";

// Identity comes only from the verified token: tok-<name> -> did:privy:<name>.
vi.mock("@/lib/privy-server", async (orig) => {
  const mod = await orig<typeof import("@/lib/privy-server")>();
  return {
    ...mod,
    verifyPrivyToken: async (token: string) => {
      if (!token.startsWith("tok-")) throw new AppError("UNAUTHORIZED", "Invalid or expired credentials");
      return { privyDid: `did:privy:${token.slice(4)}`, sessionId: "s", appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test" };
    },
  };
});

const BASE = "http://localhost/api/players/me/clans";
const createdPlayerIds: string[] = [];

const req = (url: string, name: string | null, init?: RequestInit) =>
  new Request(url, {
    ...init,
    headers: { ...(name ? { authorization: `Bearer tok-${name}` } : {}), ...(init?.headers ?? {}) },
  });

async function onboarded(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:${name}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: name, usernameKey: name, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(inArray(players.id, [p.id]))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
}

async function befriend(a: Player, b: Player) {
  const sent = await sendRequest(a.id, b.id);
  await acceptRequest(b.id, sent.friendshipId);
}

type ApiBody = { success: boolean; data: any; error: { code: string; message: string } };
const json = async (res: Response): Promise<ApiBody> => (await res.json()) as ApiBody;
const post = (url: string, name: string | null, body?: unknown) =>
  req(url, name, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(() => {
  routeDalToTestDb();
}, 60000);

afterAll(async () => {
  await getDb().delete(clanInvites);
  await getDb().delete(clanMembers);
  await getDb().delete(clans);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
  vi.restoreAllMocks();
}, 60000);

describe("clans routes", () => {
  it("rejects unauthenticated access", async () => {
    expect((await json(await myGet(req(BASE, null)))).error.code).toBe("UNAUTHORIZED");
    const created = await json(await createPost(post(BASE, null, { name: "Nope", tag: "NOPE" })));
    expect(created.success).toBe(false);
    expect(created.error.code).toBe("UNAUTHORIZED");
    const listed = await json(await invitesGet(req(`${BASE}/invites`, null)));
    expect(listed.error.code).toBe("UNAUTHORIZED");
  });

  it("runs create, invite, accept, roster, transfer and archive over HTTP", async () => {
    const tag = randomUUID().slice(0, 6);
    const owner = await onboarded(`co${tag}`);
    const member = await onboarded(`cm${tag}`);
    await befriend(owner, member);
    const clanTag = `T${tag.replace(/-/g, "").slice(0, 5).toUpperCase()}`;

    const created = await json(await createPost(post(BASE, owner.username!, { name: "Route Clan", tag: clanTag, description: "hi" })));
    expect(created.success).toBe(true);
    const clanId: string = created.data.clan.id;
    expect(created.data.role).toBe("owner");

    const mine = await json(await myGet(req(BASE, owner.username!)));
    expect(mine.data.clan.id).toBe(clanId);

    const invited = await json(await invitePost(post(`${BASE}/${clanId}/invites`, owner.username!, { playerId: member.id }), { params: Promise.resolve({ id: clanId }) }));
    expect(invited.success).toBe(true);
    const inviteId: string = invited.data.invite.id;

    const pending = await json(await invitesGet(req(`${BASE}/invites`, member.username!)));
    expect(pending.data.invites).toHaveLength(1);
    expect(pending.data.invites[0].clan.id).toBe(clanId);

    const accepted = await json(await acceptPost(post(`${BASE}/invites/${inviteId}/accept`, member.username!), { params: Promise.resolve({ inviteId }) }));
    expect(accepted.data.role).toBe("member");

    const details = await json(await detailsGet(req(`${BASE}/${clanId}`, member.username!), { params: Promise.resolve({ id: clanId }) }));
    expect(details.data.members).toHaveLength(2);
    expect(details.data.clan.memberCount).toBe(2);

    const transferred = await json(await transferPost(post(`${BASE}/${clanId}/transfer`, owner.username!, { playerId: member.id }), { params: Promise.resolve({ id: clanId }) }));
    expect(transferred.data.clan.ownerId).toBe(member.id);

    const archived = await json(await archivePost(post(`${BASE}/${clanId}/archive`, member.username!), { params: Promise.resolve({ id: clanId }) }));
    expect(archived.data.clan.status).toBe("archived");
    expect((await json(await myGet(req(BASE, member.username!)))).data.clan).toBeNull();
  });

  it("enforces privileges and keeps responses free of private fields", async () => {
    const tag = randomUUID().slice(0, 6);
    const owner = await onboarded(`co${tag}`);
    const member = await onboarded(`cm${tag}`);
    const stranger = await onboarded(`cs${tag}`);
    await befriend(owner, member);
    const clanTag = `U${tag.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
    const created = await json(await createPost(post(BASE, owner.username!, { name: "Priv Clan", tag: clanTag })));
    const clanId: string = created.data.clan.id;

    const strangerDetails = await json(await detailsGet(req(`${BASE}/${clanId}`, stranger.username!), { params: Promise.resolve({ id: clanId }) }));
    expect(strangerDetails.success).toBe(false);
    expect(strangerDetails.error.code).toBe("NOT_FOUND");

    const memberInvite = await json(await invitePost(post(`${BASE}/${clanId}/invites`, stranger.username!, { playerId: member.id }), { params: Promise.resolve({ id: clanId }) }));
    expect(memberInvite.error.code).toBe("FORBIDDEN");

    const invited = await json(await invitePost(post(`${BASE}/${clanId}/invites`, owner.username!, { playerId: member.id }), { params: Promise.resolve({ id: clanId }) }));
    const inviteId: string = invited.data.invite.id;
    await json(await acceptPost(post(`${BASE}/invites/${inviteId}/accept`, member.username!), { params: Promise.resolve({ inviteId }) }));

    const selfPromote = await json(await rolePost(post(`${BASE}/${clanId}/members/${member.id}/role`, member.username!, { role: "officer" }), { params: Promise.resolve({ id: clanId, playerId: member.id }) }));
    expect(selfPromote.error.code).toBe("BAD_REQUEST");
    const memberPromotesOwner = await json(await rolePost(post(`${BASE}/${clanId}/members/${owner.id}/role`, member.username!, { role: "member" }), { params: Promise.resolve({ id: clanId, playerId: owner.id }) }));
    expect(memberPromotesOwner.error.code).toBe("FORBIDDEN");

    const updated = await json(await updatePatch(req(`${BASE}/${clanId}`, owner.username!, { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }), { params: Promise.resolve({ id: clanId }) }));
    expect(updated.data.clan.name).toBe("Renamed");

    const details = await json(await detailsGet(req(`${BASE}/${clanId}`, owner.username!), { params: Promise.resolve({ id: clanId }) }));
    const dump = JSON.stringify(details.data);
    expect(dump).not.toMatch(/privy|wallet|address|did:/i);
    for (const m of details.data.members) {
      expect(Object.keys(m.player).sort()).toEqual(["avatarId", "displayName", "id", "username"]);
    }

    const leaveOwner = await json(await leavePost(post(`${BASE}/${clanId}/leave`, owner.username!), { params: Promise.resolve({ id: clanId }) }));
    expect(leaveOwner.error.code).toBe("BAD_REQUEST");

    const removed = await json(await removeDelete(req(`${BASE}/${clanId}/members/${member.id}`, owner.username!, { method: "DELETE" }), { params: Promise.resolve({ id: clanId, playerId: member.id }) }));
    expect(removed.data).toEqual({ removed: true });

    const declined = await json(await declinePost(post(`${BASE}/invites/${inviteId}/decline`, member.username!), { params: Promise.resolve({ inviteId }) }));
    expect(declined.error.code).toBe("BAD_REQUEST");
  });

  it("rejects bad input and unknown clans neutrally", async () => {
    const tag = randomUUID().slice(0, 6);
    const owner = await onboarded(`co${tag}`);
    const bad = await json(await createPost(post(BASE, owner.username!, { name: "x", tag: "!!" })));
    expect(bad.error.code).toBe("BAD_REQUEST");
    const missing = await json(await detailsGet(req(`${BASE}/${randomUUID()}`, owner.username!), { params: Promise.resolve({ id: randomUUID() }) }));
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
