// P1b.2 ranked trophy persistence (Season 1 provisional policy).
//
// Source of truth is durable B3.3a settlement: awards run only over settled
// matches with match_type 'ranked' and verification 'replay-verified'.
// Private, unranked, aborted, refused and unsettled matches never award.
//
// Exactly-once per (match, player) comes from the ledger primary key.
// Awarding is two statements: A stages ledger rows idempotently, B applies
// them (lock pending rows, read current balances under per-player advisory
// locks so concurrent awards for overlapping players serialize and read
// fresh snapshots, upsert floored balances with W/L/D counters, stamp the
// ledger with the applied delta and resulting balance). One statement cannot
// do both: Postgres runs a statement under one snapshot, so an UPDATE can
// never see rows the same statement inserted. Re-running B is a no-op (only
// balance_after IS NULL rows move); a crash between A and B leaves NULL
// rows, which reconcile finishes. Balances never move without their ledger
// row, and ledger rows never apply twice.
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { matchParticipants, matches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveAvatar } from "@/lib/profiles";
import {
  RANKED_DEFAULT_LIMIT,
  RANKED_DRAW_DELTA,
  RANKED_LOSS_DELTA,
  RANKED_MAX_LIMIT,
  RANKED_SEASON,
  RANKED_WIN_DELTA,
  type RankedAwardView,
} from "@/lib/ranked";

export type AwardStatus = "awarded" | "already-awarded" | "skipped";

async function settledRankedSeats(matchId: string): Promise<
  | { ok: false; reason: string }
  | { ok: true; seats: [{ playerId: string; result: "win" | "loss" | "draw" }, { playerId: string; result: "win" | "loss" | "draw" }] }
> {
  const db = getDb();
  const mrows = await db.select({ matchType: matches.matchType, verification: matches.verification }).from(matches).where(eq(matches.id, matchId)).limit(1);
  const m = mrows[0];
  if (!m) return { ok: false, reason: "unknown-match" };
  if (m.matchType !== "ranked") return { ok: false, reason: `not-ranked:${m.matchType}` };
  if (m.verification !== "replay-verified") return { ok: false, reason: `unverified:${m.verification}` };
  const parts = await db
    .select({ playerId: matchParticipants.playerId, result: matchParticipants.result })
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, matchId));
  if (parts.length !== 2) return { ok: false, reason: `seats:${parts.length}` };
  const [a, b] = parts as [{ playerId: string; result: string }, { playerId: string; result: string }];
  if (!a || !b || a.playerId === b.playerId) return { ok: false, reason: "seats-not-distinct" };
  for (const r of [a.result, b.result]) {
    if (r !== "win" && r !== "loss" && r !== "draw") return { ok: false, reason: `result:${r}` };
  }
  return {
    ok: true,
    seats: [
      { playerId: a.playerId, result: a.result as "win" | "loss" | "draw" },
      { playerId: b.playerId, result: b.result as "win" | "loss" | "draw" },
    ],
  };
}

/**
 * Award trophies for one settled ranked match. Idempotent: safe to retry,
 * safe under concurrent calls, safe across restarts. Never throws for a
 * non-ranked or unknown match (reports 'skipped'); throws only on genuine
 * DB failures, which the caller must not mistake for a successful award.
 */
export async function awardRankedMatch(matchId: string, season: number = RANKED_SEASON): Promise<{ status: AwardStatus; applied: number; reason?: string }> {
  const gate = await settledRankedSeats(matchId);
  if (!gate.ok) return { status: "skipped", applied: 0, reason: gate.reason };
  const [a, b] = gate.seats;
  const db = getDb();
  // Statement A stages the ledger rows (idempotent). Statement B applies
  // them. They cannot merge: Postgres runs one statement under a single
  // snapshot, so an UPDATE in the same statement can never see rows the
  // statement just inserted. A crash between A and B leaves balance_after
  // NULL, which reconcile finishes exactly once.
  await db.execute(sql`
    insert into ranked_trophy_awards (match_id, player_id, season, result, delta)
    select ${matchId}::uuid, v.player_id, ${season}, v.result, 0
    from (values (${a.playerId}::uuid, ${a.result}), (${b.playerId}::uuid, ${b.result})) as v(player_id, result)
    on conflict (match_id, player_id) do nothing
  `);
  // Statement B: lock pending rows, compute under advisory locks, upsert
  // floored balances with counters, stamp the ledger. Atomic and
  // re-runnable: only balance_after IS NULL rows move.
  const res = await db.execute(sql`
    with locks as materialized (
      select
        pg_advisory_xact_lock(hashtext('ranked-trophy:' || ${season} || ':' || ${a.playerId})),
        pg_advisory_xact_lock(hashtext('ranked-trophy:' || ${season} || ':' || ${b.playerId}))
    ),
    need as (
      select aw.player_id, aw.result,
        case aw.result when 'win' then ${RANKED_WIN_DELTA}::int when 'loss' then ${RANKED_LOSS_DELTA}::int else ${RANKED_DRAW_DELTA}::int end as delta_raw
      from ranked_trophy_awards aw cross join locks
      where aw.match_id = ${matchId}::uuid and aw.balance_after is null
      for update of aw
    ),
    cur as (
      select bl.player_id, bl.trophies, bl.ranked_matches, bl.ranked_wins, bl.ranked_losses, bl.ranked_draws
      from ranked_trophy_balances bl
      join (select distinct player_id from need) n using (player_id)
      where bl.season = ${season}
    ),
    computed as (
      select
        n.player_id,
        n.result,
        n.delta_raw,
        coalesce(c.trophies, 0) as old_trophies,
        greatest(0, coalesce(c.trophies, 0) + n.delta_raw) as new_trophies,
        coalesce(c.ranked_matches, 0) + 1 as m,
        coalesce(c.ranked_wins, 0) + (case when n.result = 'win' then 1 else 0 end) as w,
        coalesce(c.ranked_losses, 0) + (case when n.result = 'loss' then 1 else 0 end) as l,
        coalesce(c.ranked_draws, 0) + (case when n.result = 'draw' then 1 else 0 end) as d
      from need n left join cur c using (player_id)
    ),
    up as (
      insert into ranked_trophy_balances (player_id, season, trophies, ranked_matches, ranked_wins, ranked_losses, ranked_draws, updated_at)
      select player_id, ${season}, new_trophies, m, w, l, d, now() from computed
      on conflict (player_id, season) do update set
        trophies = excluded.trophies,
        ranked_matches = excluded.ranked_matches,
        ranked_wins = excluded.ranked_wins,
        ranked_losses = excluded.ranked_losses,
        ranked_draws = excluded.ranked_draws,
        updated_at = now()
      returning player_id
    ),
    fin as (
      update ranked_trophy_awards aw
      set delta = c.new_trophies - c.old_trophies, balance_after = c.new_trophies
      from computed c
      where aw.match_id = ${matchId}::uuid and aw.player_id = c.player_id and aw.balance_after is null
      returning aw.player_id
    )
    select (select count(*)::int from fin) as applied
  `);
  const applied = Number((res.rows as Array<{ applied: number }>)[0]?.applied ?? 0);
  return applied > 0 ? { status: "awarded", applied } : { status: "already-awarded", applied: 0 };
}

/**
 * Finish every settled ranked match whose awards are missing or incomplete
 * (no ledger rows, or rows with balance_after NULL from an interrupted
 * run). Oldest first, bounded. Safe to run on a schedule and after
 * restarts; already-awarded matches are no-ops.
 */
export async function reconcileRankedTrophies(limit: number = 50, season: number = RANKED_SEASON): Promise<{ processed: number; awarded: number }> {
  const db = getDb();
  const res = await db.execute(sql`
    select m.id as match_id
    from matches m
    left join ranked_trophy_awards a on a.match_id = m.id
    where m.match_type = 'ranked' and m.verification = 'replay-verified'
    group by m.id, m.settled_at
    having count(*) filter (where a.balance_after is not null) < 2
    order by min(m.settled_at) asc
    limit ${Math.min(Math.max(limit, 1), 200)}
  `);
  const ids = (res.rows as Array<{ match_id: string }>).map((r) => String(r.match_id));
  let awarded = 0;
  for (const id of ids) {
    const r = await awardRankedMatch(id, season);
    if (r.status === "awarded") awarded += 1;
  }
  return { processed: ids.length, awarded };
}

const boardCte = (season: number) => sql`
  with agg as (
    select
      p.id as player_id,
      p.username,
      p.display_name,
      p.avatar_id,
      p.username_key,
      b.trophies,
      b.ranked_matches as matches,
      b.ranked_wins as wins,
      b.ranked_losses as losses,
      b.ranked_draws as draws
    from ranked_trophy_balances b
    join players p on p.id = b.player_id
    where b.season = ${season}
      and b.ranked_matches > 0
      and p.account_status = 'active'
      and p.username is not null
  ), ranked as (
    select *, rank() over (order by trophies desc, wins desc) as position
    from agg
  )
`;

export interface RankedEntry {
  position: number;
  username: string;
  displayName: string | null;
  avatar: ReturnType<typeof resolveAvatar>;
  season: number;
  trophies: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  playerId: string;
}

export async function getRankedLeaderboard(
  opts?: { limit?: number; offset?: number },
  season: number = RANKED_SEASON
): Promise<{ entries: RankedEntry[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(opts?.limit ?? RANKED_DEFAULT_LIMIT, 1), RANKED_MAX_LIMIT);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const db = getDb();
  const res = await db.execute(sql`
    ${boardCte(season)}
    select *, count(*) over() as total
    from ranked
    order by trophies desc, wins desc, username_key asc
    limit ${limit} offset ${offset}
  `);
  const rows = res.rows as Array<Record<string, unknown>>;
  return {
    entries: rows.map((r) => ({
      position: Number(r.position),
      username: String(r.username),
      displayName: (r.display_name as string | null) ?? null,
      avatar: resolveAvatar((r.avatar_id as string | null) ?? null),
      season,
      trophies: Number(r.trophies),
      matches: Number(r.matches),
      wins: Number(r.wins),
      losses: Number(r.losses),
      draws: Number(r.draws),
      playerId: String(r.player_id),
    })),
    total: rows.length > 0 ? Number(rows[0]!.total) : 0,
    limit,
    offset,
  };
}

export async function getRankedPosition(
  playerId: string,
  season: number = RANKED_SEASON
): Promise<{ eligible: boolean; position: number | null; trophies: number; rankedMatches: number }> {
  const db = getDb();
  const res = await db.execute(sql`
    ${boardCte(season)}
    select position, trophies, matches from ranked where player_id = ${playerId}
  `);
  const row = (res.rows as Array<Record<string, unknown>>)[0];
  if (row) {
    return { eligible: true, position: Number(row.position), trophies: Number(row.trophies), rankedMatches: Number(row.matches) };
  }
  const bal = await db.execute(sql`
    select ranked_matches as n from ranked_trophy_balances where player_id = ${playerId} and season = ${season}
  `);
  const n = Number((bal.rows as Array<{ n: number }>)[0]?.n ?? 0);
  return { eligible: false, position: null, trophies: 0, rankedMatches: n };
}

export async function getMyRanked(
  playerId: string,
  season: number = RANKED_SEASON
): Promise<{
  season: number;
  trophies: number;
  eligible: boolean;
  position: number | null;
  rankedMatches: number;
  wins: number;
  losses: number;
  draws: number;
  recent: RankedAwardView[];
}> {
  const db = getDb();
  const [pos, bal, recent] = await Promise.all([
    getRankedPosition(playerId, season),
    db.execute(sql`
      select trophies, ranked_matches as matches, ranked_wins as wins, ranked_losses as losses, ranked_draws as draws
      from ranked_trophy_balances where player_id = ${playerId} and season = ${season}
    `),
    db.execute(sql`
      select a.match_id, a.result, a.delta, a.balance_after, m.finished_at
      from ranked_trophy_awards a join matches m on m.id = a.match_id
      where a.player_id = ${playerId} and a.season = ${season} and a.balance_after is not null
      order by m.finished_at desc, a.match_id desc
      limit 10
    `),
  ]);
  const b = (bal.rows as Array<Record<string, unknown>>)[0];
  return {
    season,
    trophies: b ? Number(b.trophies) : 0,
    eligible: pos.eligible,
    position: pos.position,
    rankedMatches: b ? Number(b.matches) : 0,
    wins: b ? Number(b.wins) : 0,
    losses: b ? Number(b.losses) : 0,
    draws: b ? Number(b.draws) : 0,
    recent: (recent.rows as Array<Record<string, unknown>>).map((r) => ({
      matchId: String(r.match_id),
      result: r.result as "win" | "loss" | "draw",
      delta: Number(r.delta),
      balanceAfter: Number(r.balance_after),
      finishedAt: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
    })),
  };
}
