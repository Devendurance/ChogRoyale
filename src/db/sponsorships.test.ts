// P6c Gold-funded upgrade sponsorship. All Gold and XP come from real
// ledger/progress rows; friendship age is backdated server-side for
// determinism. No mocks, no invented balances.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { acceptRequest, removeFriendship, sendRequest } from "@/db/friendships";
import { blockPlayer } from "@/db/blocks";
import {
  getSponsorshipQuote,
  listSponsorshipsReceived,
  listSponsorshipsSent,
  sponsorUpgrade,
} from "@/db/sponsorships";
import { getGoldTotals, upgradeCard } from "@/db/gold";
import { ordinaryCardIds } from "@/db/card-xp";
import { cardLevelForXp } from "@/lib/card-xp";
import {
  cardXpProgress,
  friendships,
  giftSponsorships,
  goldEarnLedger,
  goldSpendLedger,
  matches,
  playerBlocks,
  players,
  type Player,
} from "@/db/schema";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];
const [CARD_A, CARD_B] = ordinaryCardIds().slice(0, 2);
const DAY_MS = 24 * 60 * 60 * 1000;

async function cleanFixtures() {
  const db = getDb();
  if (createdPlayerIds.length > 0) {
    await db.delete(giftSponsorships).where(inArray(giftSponsorships.sponsorId, createdPlayerIds));
    await db.delete(goldSpendLedger).where(inArray(goldSpendLedger.playerId, createdPlayerIds));
  }
  if (matchIds.length > 0) {
    await db.delete(goldEarnLedger).where(inArray(goldEarnLedger.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(friendships);
    await db.delete(playerBlocks);
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
}

beforeAll(async () => {
  await cleanFixtures();
});
afterAll(async () => {
  await cleanFixtures();
  resetDbCache();
});

async function mkPlayer(tag: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:spon_${tag}_${randomUUID().slice(0, 8)}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: tag.slice(0, 20), usernameKey: tag.slice(0, 20), avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
}

async function befriendAt(a: Player, b: Player, acceptedAt: Date | null): Promise<string> {
  const sent = await sendRequest(a.id, b.id);
  await acceptRequest(b.id, sent.friendshipId);
  await getDb().update(friendships).set({ acceptedAt }).where(eq(friendships.id, sent.friendshipId));
  return sent.friendshipId;
}

async function fundGold(p: Player, wins: number): Promise<void> {
  const db = getDb();
  for (let i = 0; i < wins; i += 1) {
    const id = randomUUID();
    matchIds.push(id);
    await db.insert(matches).values({
      id, roomId: `s-${id.slice(0, 8)}`, matchType: "matchmaking", rulesetVersion: "v-test", protocolVersion: "b3.1",
      startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
      outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 0,
      ticks: 1800, liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
    });
    await db.insert(goldEarnLedger).values({ matchId: id, playerId: p.id, amount: 60, result: "win", policyVersion: 1 });
  }
}

async function setXp(p: Player, cardId: string, xp: number, purchasedLevel: number): Promise<void> {
  await getDb()
    .insert(cardXpProgress)
    .values({ playerId: p.id, cardId, xp, level: cardLevelForXp(xp), purchasedLevel })
    .onConflictDoUpdate({
      target: [cardXpProgress.playerId, cardXpProgress.cardId],
      set: { xp, level: cardLevelForXp(xp), purchasedLevel },
    });
}

async function recipientLevel(p: Player, cardId: string): Promise<number> {
  const rows = await getDb().select().from(cardXpProgress)
    .where(eq(cardXpProgress.playerId, p.id));
  return Number(rows.find((r) => r.cardId === cardId)?.purchasedLevel ?? 1);
}

describe("P6c sponsorship mutation", () => {
  it("sponsors exactly one level at the server price with XP untouched", async () => {
    const sponsor = await mkPlayer("happy_s");
    const recipient = await mkPlayer("happy_r");
    await befriendAt(sponsor, recipient, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(sponsor, 2);
    await setXp(recipient, CARD_A, 200, 1);
    const res = await sponsorUpgrade(sponsor.id, { recipientId: recipient.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(res.status).toBe("sponsored");
    expect(res.recipientLevel).toBe(2);
    expect(res.receiptId).toBeTruthy();
    expect(await recipientLevel(recipient, CARD_A)).toBe(2);
    expect(await getGoldTotals(sponsor.id)).toMatchObject({ earned: 120, spent: 100, balance: 20 });
    expect(await getGoldTotals(recipient.id)).toMatchObject({ earned: 0, spent: 0, balance: 0 });
    const xpRows = await getDb().select().from(cardXpProgress).where(eq(cardXpProgress.playerId, recipient.id));
    expect(xpRows.find((r) => r.cardId === CARD_A)?.xp).toBe(200);
  });

  it("accepts exactly 30-day friendships and refuses too-new ones", async () => {
    const s = await mkPlayer("exact_s");
    const r = await mkPlayer("exact_r");
    await befriendAt(s, r, new Date(Date.now() - 30 * DAY_MS));
    await fundGold(s, 2);
    await setXp(r, CARD_A, 200, 1);
    const ok = await sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(ok.status).toBe("sponsored");

    const s2 = await mkPlayer("new_s");
    const r2 = await mkPlayer("new_r");
    await befriendAt(s2, r2, new Date(Date.now() - 29 * DAY_MS));
    await fundGold(s2, 2);
    await setXp(r2, CARD_A, 200, 1);
    const young = await sponsorUpgrade(s2.id, { recipientId: r2.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(young.status).toBe("not-eligible");
    expect(await recipientLevel(r2, CARD_A)).toBe(1);
    expect(await getGoldTotals(s2.id)).toMatchObject({ balance: 120 });
  });

  it("refuses legacy null acceptance dates and resets on re-friending", async () => {
    const s = await mkPlayer("leg_s");
    const r = await mkPlayer("leg_r");
    const fid = await befriendAt(s, r, new Date(Date.now() - 60 * DAY_MS));
    await getDb().update(friendships).set({ acceptedAt: null }).where(eq(friendships.id, fid));
    await fundGold(s, 2);
    await setXp(r, CARD_A, 200, 1);
    expect((await sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() })).status).toBe("not-eligible");

    await removeFriendship(s.id, fid);
    await befriendAt(s, r, new Date());
    expect((await sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() })).status).toBe("not-eligible");
    expect(await getGoldTotals(s.id)).toMatchObject({ balance: 120 });
  });

  it("refuses blocks in either direction without leaking state", async () => {
    const s = await mkPlayer("blk_s");
    const r = await mkPlayer("blk_r");
    await befriendAt(s, r, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(s, 2);
    await setXp(r, CARD_A, 200, 1);
    await blockPlayer(s.id, r.id);
    const res = await sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(res.status).toBe("not-eligible");
    const body = JSON.stringify(res);
    expect(body).not.toContain("wallet");
    expect(body).not.toContain("privy");
    expect(await getGoldTotals(s.id)).toMatchObject({ balance: 120 });
  });

  it("maps recipient XP, funds and maxed level precisely", async () => {
    const s = await mkPlayer("map_s");
    const r = await mkPlayer("map_r");
    await befriendAt(s, r, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(s, 2);
    await setXp(r, CARD_A, 0, 1);
    expect((await sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() })).status).toBe("insufficient-xp");

    const poorSponsor = await mkPlayer("map_ps");
    const poor = await mkPlayer("map_p");
    await befriendAt(poorSponsor, poor, new Date(Date.now() - 31 * DAY_MS));
    await setXp(poor, CARD_A, 200, 1);
    expect((await sponsorUpgrade(poorSponsor.id, { recipientId: poor.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() })).status).toBe("insufficient-gold");

    const maxed = await mkPlayer("map_m");
    await befriendAt(s, maxed, new Date(Date.now() - 31 * DAY_MS));
    await setXp(maxed, CARD_A, 200, 10);
    expect((await sponsorUpgrade(s.id, { recipientId: maxed.id, cardId: CARD_A, expectedLevel: 10, idempotencyKey: randomUUID() })).status).toBe("maxed");
    expect((await sponsorUpgrade(s.id, { recipientId: maxed.id, cardId: CARD_A, expectedLevel: 9, idempotencyKey: randomUUID() })).status).toBe("level-mismatch");
    expect(await getGoldTotals(s.id)).toMatchObject({ balance: 120 });
  });

  it("is idempotent: duplicate keys never double-charge or double-advance", async () => {
    const s = await mkPlayer("idem_s");
    const r = await mkPlayer("idem_r");
    await befriendAt(s, r, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(s, 4);
    await setXp(r, CARD_A, 200, 1);
    const key = randomUUID();
    const first = await sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: key });
    const [second, third] = await Promise.all([
      sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: key }),
      sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: key }),
    ]);
    expect(first.status).toBe("sponsored");
    expect(second.status).toBe("duplicate");
    expect(third.status).toBe("duplicate");
    expect(await recipientLevel(r, CARD_A)).toBe(2);
    expect(await getGoldTotals(s.id)).toMatchObject({ earned: 240, spent: 100, balance: 140 });
  });

  it("two sponsors racing one card produce exactly one upgrade", async () => {
    const a = await mkPlayer("race_a");
    const b = await mkPlayer("race_b");
    const r = await mkPlayer("race_r");
    await befriendAt(a, r, new Date(Date.now() - 31 * DAY_MS));
    await befriendAt(b, r, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(a, 2);
    await fundGold(b, 2);
    await setXp(r, CARD_A, 200, 1);
    const [ra, rb] = await Promise.all([
      sponsorUpgrade(a.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() }),
      sponsorUpgrade(b.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual(["level-mismatch", "sponsored"]);
    expect(await recipientLevel(r, CARD_A)).toBe(2);
    const spentA = (await getGoldTotals(a.id)).spent;
    const spentB = (await getGoldTotals(b.id)).spent;
    expect(spentA + spentB).toBe(100);
  });

  it("self-upgrade racing sponsorship advances exactly once", async () => {
    const s = await mkPlayer("orace_s");
    const r = await mkPlayer("orace_r");
    await befriendAt(s, r, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(s, 2);
    await fundGold(r, 2);
    await setXp(r, CARD_A, 200, 1);
    const [self, gifted] = await Promise.all([
      upgradeCard(r.id, { cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() }),
      sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() }),
    ]);
    const won = [self.status, gifted.status].filter((x) => x === "upgraded" || x === "sponsored");
    expect(won).toHaveLength(1);
    expect(await recipientLevel(r, CARD_A)).toBe(2);
  });

  it("joint overdraw is impossible: sponsor spend plus self spend serialize", async () => {
    const s = await mkPlayer("odraw_s");
    const r = await mkPlayer("odraw_r");
    await befriendAt(s, r, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(s, 2);
    await setXp(s, CARD_B, 200, 1);
    await setXp(r, CARD_A, 200, 1);
    const [self, gifted] = await Promise.all([
      upgradeCard(s.id, { cardId: CARD_B, expectedLevel: 1, idempotencyKey: randomUUID() }),
      sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() }),
    ]);
    const won = [self.status, gifted.status].filter((x) => x === "upgraded" || x === "sponsored");
    expect(won).toHaveLength(1);
    const totals = await getGoldTotals(s.id);
    expect(totals.balance).toBeGreaterThanOrEqual(0);
    expect(totals.spent).toBe(100);
  });

  it("enforces provisional abuse caps server-side", async () => {
    const s = await mkPlayer("cap_s");
    const r1 = await mkPlayer("cap_r1");
    const r2 = await mkPlayer("cap_r2");
    const r3 = await mkPlayer("cap_r3");
    const r4 = await mkPlayer("cap_r4");
    for (const r of [r1, r2, r3, r4]) await befriendAt(s, r, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(s, 20);
    for (const r of [r1, r2, r3, r4]) await setXp(r, CARD_A, 200, 1);
    await setXp(r1, CARD_B, 200, 1);
    for (const r of [r1, r2, r3]) {
      expect((await sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() })).status).toBe("sponsored");
    }
    expect((await sponsorUpgrade(s.id, { recipientId: r4.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() })).status).toBe("cap-sender-week");
    expect((await sponsorUpgrade(s.id, { recipientId: r1.id, cardId: CARD_B, expectedLevel: 1, idempotencyKey: randomUUID() })).status).toBe("cap-recipient-day");
    expect((await sponsorUpgrade(s.id, { recipientId: r2.id, cardId: CARD_A, expectedLevel: 2, idempotencyKey: randomUUID() })).status).toBe("cap-pair-week");
  });

  it("a blocked-after-quote attempt writes nothing", async () => {
    const s = await mkPlayer("mut_s");
    const r = await mkPlayer("mut_r");
    await befriendAt(s, r, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(s, 2);
    await setXp(r, CARD_A, 200, 1);
    const quote = await getSponsorshipQuote(s.id, r.id, CARD_A);
    expect(quote).toMatchObject({ eligible: true, nextLevel: 1, cost: 100 });
    await blockPlayer(r.id, s.id);
    const res = await sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(res.status).toBe("not-eligible");
    expect(await recipientLevel(r, CARD_A)).toBe(1);
    expect(await getGoldTotals(s.id)).toMatchObject({ balance: 120 });
  });

  it("quotes stay safe and receipts attribute both parties", async () => {
    const s = await mkPlayer("q_s");
    const r = await mkPlayer("q_r");
    await befriendAt(s, r, new Date(Date.now() - 31 * DAY_MS));
    await fundGold(s, 2);
    await setXp(r, CARD_A, 200, 1);
    const young = await mkPlayer("q_y");
    await befriendAt(s, young, new Date());
    await setXp(young, CARD_A, 200, 1);
    const denied = await getSponsorshipQuote(s.id, young.id, CARD_A);
    expect(denied.eligible).toBe(false);
    expect(denied.cost).toBeNull();
    expect(denied.nextLevel).toBeNull();
    expect(JSON.stringify(denied)).not.toContain("xp");

    const res = await sponsorUpgrade(s.id, { recipientId: r.id, cardId: CARD_A, expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(res.status).toBe("sponsored");
    const sent = await listSponsorshipsSent(s.id);
    const received = await listSponsorshipsReceived(r.id);
    expect(sent).toHaveLength(1);
    expect(received).toHaveLength(1);
    expect(sent[0]).toMatchObject({ sponsorId: s.id, recipientId: r.id, cardId: CARD_A, fromLevel: 1, toLevel: 2, cost: 100 });
    expect(received[0]).toMatchObject(sent[0]);
    expect(JSON.stringify(sent[0])).not.toContain("wallet");
  });
});
