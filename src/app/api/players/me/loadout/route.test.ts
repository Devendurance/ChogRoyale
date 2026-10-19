import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { players, type Player, type PlayerLoadout } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GET, PUT } from "./route";
import { PRESETS } from "@/server/battle/session";
import { CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT } from "@/lib/battle-protocol";
import * as loadoutDal from "@/db/loadouts";

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

const URL_ = "http://localhost/api/players/me/loadout";
const createdPlayerIds: string[] = [];

const cards = PRESETS["swarm"]!.cards;
const altCards = PRESETS["siege"]!.cards;
const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, cards, commander: { kind: "free", class: "scout" }, expectedRevision: null, ...over });

const req = (name: string | null, init?: RequestInit) =>
  new Request(URL_, {
    ...init,
    headers: { ...(name ? { authorization: `Bearer tok-${name}` } : {}), ...(init?.headers ?? {}) },
  });

async function onboarded(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:${name}` });
  const db = getDb();
  const [row] = await db
    .update(players)
    .set({ username: name, usernameKey: name, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(inArray(players.id, [p.id]))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
}

type LoadoutView = {
  revision: number;
  cards: string[];
  commander: { kind: string; class?: string; tokenId?: string };
  updatedAt: string;
};
const json = async (res: Response) =>
  (await res.json()) as {
    success: boolean;
    data: { loadout: LoadoutView; invalidSaved?: { revision: number; reason: string } };
    error: { code: string; message: string; details: { loadout: LoadoutView } };
  };

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
  vi.restoreAllMocks();
});

describe("loadout route auth", () => {
  it("rejects missing and forged tokens with 401", async () => {
    expect((await GET(req(null))).status).toBe(401);
    expect((await GET(req("x", { headers: { authorization: "Bearer forged" } }))).status).toBe(401);
  });
});

describe("loadout route", () => {
  it("GET returns null with no saved deck", async () => {
    const name = `rt0_${randomUUID().slice(0, 6)}`;
    await onboarded(name);
    const res = await GET(req(name));
    expect(res.status).toBe(200);
    expect((await json(res)).data.loadout).toBeNull();
  });

  it("PUT then GET returns the saved deck in a separate request", async () => {
    const name = `rt1_${randomUUID().slice(0, 6)}`;
    await onboarded(name);
    const put = await PUT(req(name, { method: "PUT", headers: { "content-type": "application/json" }, body: body() }));
    expect(put.status).toBe(200);
    const putJ = await json(put);
    expect(putJ.data.loadout.revision).toBe(1);
    const get = await GET(req(name));
    const getJ = await json(get);
    expect(get.status).toBe(200);
    expect(getJ.data.loadout.cards).toEqual(cards);
    expect(getJ.data.loadout.commander).toEqual({ kind: "free", class: "scout" });
    expect(getJ.data.loadout.revision).toBe(1);
  });

  it("accepts an NFT claim", async () => {
    const name = `rt2_${randomUUID().slice(0, 6)}`;
    await onboarded(name);
    const res = await PUT(
      req(name, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: body({ commander: { kind: "nft", chainId: CHOG_GENESIS_CHAIN_ID, contract: CHOG_GENESIS_CONTRACT, tokenId: "1462" } }),
      })
    );
    expect(res.status).toBe(200);
    const j = await json(res);
    expect(j.data.loadout.commander.tokenId).toBe("1462");
  });

  it("rejects invalid decks and claims without writing anything", async () => {
    const name = `rt3_${randomUUID().slice(0, 6)}`;
    await onboarded(name);
    const put = (b: string) => PUT(req(name, { method: "PUT", headers: { "content-type": "application/json" }, body: b }));
    const cases: string[] = [
      body({ cards: [...cards.slice(0, 6), cards[0]] }), // duplicate
      body({ cards: [...cards.slice(0, 6), "bogus-card"] }), // unknown
      body({ cards: cards.slice(0, 6) }), // too few (schema)
      body({ cards: [...cards.slice(0, 6), "cmdr:free-scout"] }), // commander among the 7
      body({ commander: { kind: "free", class: "paladin" } }), // bad class
      body({ commander: { kind: "nft", chainId: 1, contract: CHOG_GENESIS_CONTRACT, tokenId: "5" } }),
      body({ commander: { kind: "nft", chainId: 143, contract: "0x0000000000000000000000000000000000000000", tokenId: "5" } }),
      body({ commander: { kind: "nft", chainId: 143, contract: CHOG_GENESIS_CONTRACT, tokenId: "007" } }),
      body({ schemaVersion: 2 }),
      body({ playerId: "00000000-0000-0000-0000-000000000000" }), // unknown extra key
      "not json",
      "x".repeat(5000),
    ];
    for (const b of cases) {
      const res = await put(b);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    const get = await GET(req(name));
    expect((await json(get)).data.loadout).toBeNull();
  });

  it("returns 409 with the current copy on a stale revision, never auto-overwrites", async () => {
    const name = `rt4_${randomUUID().slice(0, 6)}`;
    await onboarded(name);
    await PUT(req(name, { method: "PUT", headers: { "content-type": "application/json" }, body: body() }));
    await PUT(req(name, { method: "PUT", headers: { "content-type": "application/json" }, body: body({ cards: altCards, expectedRevision: 1 }) }));
    const stale = await PUT(
      req(name, { method: "PUT", headers: { "content-type": "application/json" }, body: body({ commander: { kind: "free", class: "warden" }, expectedRevision: 1 }) })
    );
    expect(stale.status).toBe(409);
    const j = await json(stale);
    expect(j.error.details.loadout.revision).toBe(2);
    expect(j.error.details.loadout.cards).toEqual(altCards);
    const get = await GET(req(name));
    expect((await json(get)).data.loadout.cards).toEqual(altCards);
    // Overwrite succeeds with the correct revision.
    const ow = await PUT(
      req(name, { method: "PUT", headers: { "content-type": "application/json" }, body: body({ commander: { kind: "free", class: "warden" }, expectedRevision: 2 }) })
    );
    expect(ow.status).toBe(200);
    expect((await json(ow)).data.loadout.revision).toBe(3);
  });

  it("identity comes from the token only; another player never sees the row", async () => {
    const a = `rt5a_${randomUUID().slice(0, 6)}`;
    const b = `rt5b_${randomUUID().slice(0, 6)}`;
    await onboarded(a);
    await onboarded(b);
    await PUT(req(a, { method: "PUT", headers: { "content-type": "application/json" }, body: body() }));
    const getB = await GET(req(b));
    expect((await json(getB)).data.loadout).toBeNull();
    const putB = await PUT(req(b, { method: "PUT", headers: { "content-type": "application/json" }, body: body({ expectedRevision: 1 }) }));
    expect(putB.status).toBe(409); // b has no deck, expectedRevision 1 is meaningless for b
  });

  it("reports invalidSaved for an unsupported stored version", async () => {
    const name = `rt6_${randomUUID().slice(0, 6)}`;
    const p = await onboarded(name);
    const fakeRow = {
      schemaVersion: 2,
      cards,
      commanderKind: "free",
      commanderClass: "scout",
      revision: 4,
      updatedAt: new Date(),
    } as unknown as PlayerLoadout;
    const spy = vi.spyOn(loadoutDal, "getLoadout").mockResolvedValueOnce(fakeRow);
    const get = await GET(req(name));
    expect(spy).toHaveBeenCalledWith(p.id);
    const j = await json(get);
    expect(j.data.loadout).toBeNull();
    expect(j.data.invalidSaved).toMatchObject({ revision: 4 });
  });

  it("maps a DB failure to 500", async () => {
    const name = `rt7_${randomUUID().slice(0, 6)}`;
    await onboarded(name);
    vi.spyOn(loadoutDal, "getLoadout").mockRejectedValueOnce(new Error("db down"));
    const res = await GET(req(name));
    expect(res.status).toBe(500);
    expect((await json(res)).error.code).toBe("INTERNAL_ERROR");
  });
});
