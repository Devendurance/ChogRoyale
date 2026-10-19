// B3.3a durable match history. Returns only rows where the verified caller
// is a participant, and only caller-side detail: the opponent's deck,
// commander, wallet, seed, commands and evidence hash are never emitted.
import { and, desc, eq, lt, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { getDb } from "@/db/client";
import { matchParticipants, matches, players } from "@/db/schema";
import { logger } from "@/lib/logger";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const opp = alias(matchParticipants, "opponent");

interface Cursor {
  s: string; // settledAt ISO
  i: string; // match id (uuid tiebreak)
}

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof v.s !== "string" || typeof v.i !== "string" || Number.isNaN(Date.parse(v.s))) return null;
    return v;
  } catch {
    return null;
  }
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    let limit = DEFAULT_LIMIT;
    if (limitParam !== null) {
      limit = Number(limitParam);
      if (!Number.isInteger(limit) || limit < 1) throw new AppError("BAD_REQUEST", "Invalid limit");
      limit = Math.min(limit, MAX_LIMIT);
    }
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodeCursor(rawCursor);
    if (rawCursor && !cursor) throw new AppError("BAD_REQUEST", "Invalid cursor");

    const db = getDb();
    const keyset = cursor
      ? or(lt(matches.settledAt, new Date(cursor.s)), and(eq(matches.settledAt, new Date(cursor.s)), lt(matches.id, cursor.i)))
      : undefined;
    const rows = await db
      .select({
        matchId: matches.id,
        matchType: matches.matchType,
        settledAt: matches.settledAt,
        finishedAt: matches.finishedAt,
        rulesetVersion: matches.rulesetVersion,
        endReason: matches.endReason,
        ticks: matches.ticks,
        liveHash: matches.liveHash,
        crowns0: matches.crowns0,
        crowns1: matches.crowns1,
        mySeat: matchParticipants.seat,
        result: matchParticipants.result,
        myCrowns: matchParticipants.crowns,
        myDeck: matchParticipants.deck,
        myCommander: matchParticipants.commanderIdentity,
        opponentUsername: players.username,
        opponentDisplayName: players.displayName,
      })
      .from(matchParticipants)
      .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
      .innerJoin(opp, and(eq(opp.matchId, matchParticipants.matchId), ne(opp.seat, matchParticipants.seat)))
      .innerJoin(players, eq(players.id, opp.playerId))
      .where(and(eq(matchParticipants.playerId, player.id), keyset))
      .orderBy(desc(matches.settledAt), desc(matches.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length > 0
        ? encodeCursor({ s: page[page.length - 1]!.settledAt.toISOString(), i: page[page.length - 1]!.matchId })
        : null;

    const items = page.map((r) => {
      const mine = r.mySeat === 0 ? r.crowns0 : r.crowns1;
      const theirs = r.mySeat === 0 ? r.crowns1 : r.crowns0;
      return {
        matchId: r.matchId,
        matchType: r.matchType,
        settledAt: r.settledAt.toISOString(),
        finishedAt: r.finishedAt.toISOString(),
        rulesetVersion: r.rulesetVersion,
        endReason: r.endReason,
        ticks: r.ticks,
        mySeat: r.mySeat,
        result: r.result,
        crowns: { mine: mine ?? r.myCrowns, opponent: theirs },
        myDeck: r.myDeck,
        myCommander: r.myCommander,
        opponent: { username: r.opponentUsername ?? r.opponentDisplayName ?? "player" },
        verification: "replay-verified",
        stateHash: r.liveHash,
      };
    });
    return success({ items, nextCursor }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("match history failure", { requestId });
    }
    return failure(err, requestId);
  }
}
