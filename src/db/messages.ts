import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dmConversations, dmMessages, players, type DmMessage } from "@/db/schema";
import { getAcceptedFriendship, pairKey } from "@/db/friendships";
import { blockedIdsFor, canSociallyInteract } from "@/db/blocks";
import { AppError } from "@/lib/errors";

export const DM_MAX_CONTENT = 1000;
export const DM_DEFAULT_LIMIT = 20;
export const DM_MAX_LIMIT = 50;
const CONVERSATION_LIST_LIMIT = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DmPeer {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
}

export interface DmMessageView {
  id: string;
  conversationId: string;
  sender: string;
  content: string;
  status: "sent" | "read";
  createdAt: string;
  readAt: string | null;
}

export interface DmConversationView {
  conversationId: string;
  peer: DmPeer;
  lastMessage: { id: string; sender: string; snippet: string; createdAt: string } | null;
  unread: number;
}

export interface DmPage {
  messages: DmMessageView[];
  nextCursor: string | null;
}

function toPeer(row: { id: string; username: string | null; displayName: string | null; avatarId: string | null }): DmPeer {
  return { id: row.id, username: row.username, displayName: row.displayName, avatarId: row.avatarId };
}

function toMessageView(row: DmMessage): DmMessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    sender: row.sender,
    content: row.content,
    status: row.readAt ? "read" : "sent",
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

function requireUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) throw new AppError("BAD_REQUEST", `${label} must be a valid id`);
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { t: string; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new AppError("BAD_REQUEST", "Cursor is malformed");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { t?: unknown }).t !== "string" ||
    typeof (parsed as { id?: unknown }).id !== "string" ||
    Number.isNaN(Date.parse((parsed as { t: string }).t))
  ) {
    throw new AppError("BAD_REQUEST", "Cursor is malformed");
  }
  return parsed as { t: string; id: string };
}

// Small single-instance send throttle: 20 sends per player per 60 seconds.
// This blunts casual spam scripts. It resets on server restart and does not
// replace edge rate limiting, which this slice deliberately does not add.
const SEND_WINDOW_MS = 60_000;
const SEND_MAX_PER_WINDOW = 20;
const sendTimes = new Map<string, number[]>();

export function checkDmRateLimit(playerId: string, now = Date.now()): void {
  const times = (sendTimes.get(playerId) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
  if (times.length >= SEND_MAX_PER_WINDOW) {
    throw new AppError("RATE_LIMITED", "You are sending too quickly. Slow down and try again.");
  }
  times.push(now);
  sendTimes.set(playerId, times);
  if (sendTimes.size > 5000) {
    const oldest = sendTimes.keys().next();
    if (!oldest.done) sendTimes.delete(oldest.value);
  }
}

async function membership(conversationId: string, playerId: string) {
  const rows = await getDb()
    .select()
    .from(dmConversations)
    .where(eq(dmConversations.id, conversationId))
    .limit(1);
  const row = rows[0];
  if (!row || (row.userA !== playerId && row.userB !== playerId)) {
    throw new AppError("NOT_FOUND", "Conversation not found");
  }
  return row;
}

function peerOf(row: { userA: string; userB: string }, me: string): string {
  return row.userA === me ? row.userB : row.userA;
}

/**
 * Finds the canonical conversation for a pair, creating it when the pair
 * passes every gate. Guards run before the insert; the pair unique index
 * collapses simultaneous creation to one row.
 */
export async function getOrCreateConversation(me: string, peerId: string): Promise<{ conversationId: string; created: boolean }> {
  if (me === peerId) throw new AppError("BAD_REQUEST", "You cannot message yourself");
  requireUuid(peerId, "Player");
  const db = getDb();
  const peer = await db
    .select({ id: players.id, onboardingStatus: players.onboardingStatus, usernameKey: players.usernameKey, avatarId: players.avatarId })
    .from(players)
    .where(eq(players.id, peerId))
    .limit(1);
  if (!peer[0]) throw new AppError("FORBIDDEN", "This player is unavailable.");
  if (peer[0].onboardingStatus !== "complete" || !peer[0].usernameKey || !peer[0].avatarId) {
    throw new AppError("FORBIDDEN", "This player is unavailable.");
  }
  if (!(await getAcceptedFriendship(me, peerId))) {
    throw new AppError("FORBIDDEN", "This player is unavailable.");
  }
  if ((await canSociallyInteract(me, peerId)).allowed === false) {
    throw new AppError("FORBIDDEN", "This player is unavailable.");
  }
  const [userA, userB] = pairKey(me, peerId);
  const inserted = await db.insert(dmConversations).values({ userA, userB }).onConflictDoNothing().returning();
  if (inserted[0]) return { conversationId: inserted[0].id, created: true };
  const existing = await db
    .select({ id: dmConversations.id })
    .from(dmConversations)
    .where(and(eq(dmConversations.userA, userA), eq(dmConversations.userB, userB)))
    .limit(1);
  if (!existing[0]) throw new AppError("FORBIDDEN", "This player is unavailable.");
  return { conversationId: existing[0].id, created: false };
}

/** Active inbox: hides blocked pairs, keeps unfriended history visible. */
export async function listConversations(me: string): Promise<DmConversationView[]> {
  const db = getDb();
  const hidden = await blockedIdsFor(me);
  const rows = await db
    .select()
    .from(dmConversations)
    .where(or(eq(dmConversations.userA, me), eq(dmConversations.userB, me)))
    .orderBy(desc(dmConversations.createdAt))
    .limit(CONVERSATION_LIST_LIMIT);
  const visible = rows.filter((r) => !hidden.has(peerOf(r, me)));
  if (visible.length === 0) return [];
  const peerIds = [...new Set(visible.map((r) => peerOf(r, me)))];
  const profiles = await db
    .select({ id: players.id, username: players.username, displayName: players.displayName, avatarId: players.avatarId })
    .from(players)
    .where(inArray(players.id, peerIds));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const convoIds = visible.map((r) => r.id);
  for (const cid of convoIds) requireUuid(cid, "Conversation");
  const idList = sql.join(
    convoIds.map((cid) => sql`${cid}::uuid`),
    sql`, `
  );
  // Exact per-conversation newest row, independent of inbox volume. Columns
  // are aliased because raw SQL returns snake_case, not drizzle camelCase.
  const lastRows = await db.execute(sql`select distinct on ("conversation_id")
    "id", "conversation_id" as "conversationId", "sender", "content",
    "created_at" as "createdAt", "read_at" as "readAt" from "dm_messages"
    where "conversation_id" in (${idList}) order by "conversation_id", "created_at" desc, "id" desc`);
  const unreadRows = await db
    .select({ conversationId: dmMessages.conversationId, unread: sql<number>`count(*)::int` })
    .from(dmMessages)
    .where(and(inArray(dmMessages.conversationId, convoIds), sql`${dmMessages.sender} != ${me}`, isNull(dmMessages.readAt)))
    .groupBy(dmMessages.conversationId);
  const lastByConvo = new Map<string, DmMessage>();
  for (const m of lastRows.rows as DmMessage[]) lastByConvo.set(m.conversationId, m);
  const unreadByConvo = new Map(unreadRows.map((r) => [r.conversationId, r.unread]));
  const views: DmConversationView[] = [];
  for (const row of visible) {
    const peer = byId.get(peerOf(row, me));
    if (!peer) continue;
    const last = lastByConvo.get(row.id) ?? null;
    views.push({
      conversationId: row.id,
      peer: toPeer(peer),
      lastMessage: last
        ? { id: last.id, sender: last.sender, snippet: last.content.slice(0, 120), createdAt: new Date(last.createdAt).toISOString() }
        : null,
      unread: unreadByConvo.get(row.id) ?? 0,
    });
  }
  views.sort((a, b) => (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? ""));
  return views;
}

export async function fetchMessages(me: string, conversationId: string, cursor: string | null, limit = DM_DEFAULT_LIMIT): Promise<DmPage> {
  requireUuid(conversationId, "Conversation");
  const take = Math.min(Math.max(Math.floor(limit), 1), DM_MAX_LIMIT);
  await membership(conversationId, me);
  const db = getDb();
  const conds = [eq(dmMessages.conversationId, conversationId)];
  if (cursor !== null && cursor !== "") {
    const { id } = decodeCursor(cursor);
    // Resolve the boundary in the database: JS Dates lose the stored
    // microsecond precision, so a round-tripped timestamp would re-match
    // its own row. The subquery compares at full stored precision.
    const bound = await db
      .select({ id: dmMessages.id })
      .from(dmMessages)
      .where(and(eq(dmMessages.conversationId, conversationId), eq(dmMessages.id, id)))
      .limit(1);
    if (!bound[0]) throw new AppError("BAD_REQUEST", "Cursor is malformed");
    conds.push(
      sql`(${dmMessages.createdAt}, ${dmMessages.id}) > (select "created_at", "id" from "dm_messages" where "id" = ${id}::uuid)`
    );
  }
  const rows = await db
    .select()
    .from(dmMessages)
    .where(and(...conds))
    .orderBy(asc(dmMessages.createdAt), asc(dmMessages.id))
    .limit(take + 1);
  const page = rows.slice(0, take);
  const last = page[page.length - 1] ?? null;
  return {
    messages: page.map(toMessageView),
    nextCursor: rows.length > take && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/**
 * Sends one message. Friendship and both block directions are validated at
 * the write boundary; a block that lands between validation and insert is
 * caught by the post-write re-check, which removes only a message this call
 * created (retries of an older key return the durable original instead).
 * Receipt means stored by the server, never delivered to a device.
 */
export async function sendMessage(
  me: string,
  conversationId: string,
  content: string,
  idempotencyKey: string
): Promise<{ message: DmMessageView; duplicate: boolean }> {
  requireUuid(conversationId, "Conversation");
  requireUuid(idempotencyKey, "Idempotency key");
  const text = content.trim();
  if (text.length === 0) throw new AppError("BAD_REQUEST", "Message cannot be empty");
  if (text.length > DM_MAX_CONTENT) throw new AppError("BAD_REQUEST", `Message must be ${DM_MAX_CONTENT} characters or fewer`);
  checkDmRateLimit(me);
  const convo = await membership(conversationId, me);
  const peerId = peerOf(convo, me);
  if (!(await getAcceptedFriendship(me, peerId))) {
    throw new AppError("FORBIDDEN", "This player is unavailable.");
  }
  if ((await canSociallyInteract(me, peerId)).allowed === false) {
    throw new AppError("FORBIDDEN", "This player is unavailable.");
  }
  const db = getDb();
  const inserted = await db
    .insert(dmMessages)
    .values({ conversationId, sender: me, idempotencyKey, content: text })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) {
    if ((await canSociallyInteract(me, peerId)).allowed === false) {
      await db.delete(dmMessages).where(eq(dmMessages.id, inserted[0].id));
      throw new AppError("FORBIDDEN", "This player is unavailable.");
    }
    return { message: toMessageView(inserted[0]), duplicate: false };
  }
  const existing = await db
    .select()
    .from(dmMessages)
    .where(and(eq(dmMessages.sender, me), eq(dmMessages.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (!existing[0]) throw new AppError("CONFLICT", "Message is being recorded. Retry to read it.");
  return { message: toMessageView(existing[0]), duplicate: true };
}

/**
 * Recipient-only read acknowledgement. The target must be a real message in
 * this conversation, so forged future positions are impossible; positions
 * are server timestamps, and readAt is set once and never rewritten.
 */
export async function ackRead(me: string, conversationId: string, messageId: string): Promise<{ read: true }> {
  requireUuid(conversationId, "Conversation");
  requireUuid(messageId, "Message");
  const convo = await membership(conversationId, me);
  const db = getDb();
  const target = await db
    .select()
    .from(dmMessages)
    .where(and(eq(dmMessages.id, messageId), eq(dmMessages.conversationId, convo.id)))
    .limit(1);
  if (!target[0]) throw new AppError("BAD_REQUEST", "Message not found in this conversation");
  const point = target[0];
  if (point.sender === me) throw new AppError("BAD_REQUEST", "Only received messages can be acknowledged");
  // Boundary resolves in the database: JS Dates lose the stored microsecond
  // precision, so a round-tripped timestamp would miss its own row.
  await db.execute(sql`update "dm_messages" set "read_at" = now()
    where "conversation_id" = ${convo.id} and "sender" != ${me} and "read_at" is null
    and ("created_at", "id") <= (select "created_at", "id" from "dm_messages" where "id" = ${point.id}::uuid)`);
  return { read: true as const };
}
