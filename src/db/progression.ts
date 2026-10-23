// B3.3c player progression stats and the casual unranked leaderboard.
//
// Source of truth is the durable B3.3a settlement data: one matches row per
// matchId and one match_participants row per (match, seat). Every row is a
// replay-verified finished match, so aborted, refused or duplicate settles
// are excluded by construction and idempotent settlement already counts
// each match once. No materialized aggregates: everything below is computed
// live with SQL over those rows.
//
// Win rate: wins / (wins + losses + draws), expressed as integer basis
// points (wins * 10000 / total, floor). Draws are not wins. Crowns earned
// are the caller's participant crowns summed over their matches; crowns
// conceded are the opponent participant crowns over the same matches.
// Participation counts regardless of whether the commander was deployed;
// deployment only gates B1 NFT legacy, which is a separate system.
//
// The casual leaderboard counts matchmaking rows only (private rooms never
// count), requires an active account with a username, and requires at least
// CASUAL_MIN_MATCHES matchmaking matches. Ordering is matchmaking wins
// desc, then win rate desc, then crowns earned desc, with username_key asc
// as the final deterministic tiebreak. Position uses SQL RANK() over
// (wins, winRateBp, crownsEarned) so exact ties share a rank (1,2,2,4)
// while rows still sort stably.

import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { resolveAvatar, type PublicAvatar } from "@/lib/profiles";

export const CASUAL_MIN_MATCHES = 3;
export const CASUAL_MAX_LIMIT = 50;
export const CASUAL_DEFAULT_LIMIT = 25;

export interface TypeBreakdown {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface PlayerStats {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  /** wins * 10000 / total, integer floor; null when total is 0. */
  winRateBp: number | null;
  crownsEarned: number;
  crownsConceded: number;
  byType: { private: TypeBreakdown; matchmaking: TypeBreakdown; ranked: TypeBreakdown };
  firstMatchAt: string | null;
  latestMatchAt: string | null;
}

export async function getPlayerStats(playerId: string): Promise<PlayerStats> {
  const db = getDb();
  const res = await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where me.result = 'win')::int as wins,
      count(*) filter (where me.result = 'loss')::int as losses,
      count(*) filter (where me.result = 'draw')::int as draws,
      coalesce(sum(me.crowns), 0)::int as crowns_earned,
      coalesce(sum(opp.crowns), 0)::int as crowns_conceded,
      count(*) filter (where m.match_type = 'private')::int as private_matches,
      count(*) filter (where m.match_type = 'private' and me.result = 'win')::int as private_wins,
      count(*) filter (where m.match_type = 'private' and me.result = 'loss')::int as private_losses,
      count(*) filter (where m.match_type = 'private' and me.result = 'draw')::int as private_draws,
      count(*) filter (where m.match_type = 'matchmaking')::int as mm_matches,
      count(*) filter (where m.match_type = 'matchmaking' and me.result = 'win')::int as mm_wins,
      count(*) filter (where m.match_type = 'matchmaking' and me.result = 'loss')::int as mm_losses,
      count(*) filter (where m.match_type = 'matchmaking' and me.result = 'draw')::int as mm_draws,
      count(*) filter (where m.match_type = 'ranked')::int as ranked_matches,
      count(*) filter (where m.match_type = 'ranked' and me.result = 'win')::int as ranked_wins,
      count(*) filter (where m.match_type = 'ranked' and me.result = 'loss')::int as ranked_losses,
      count(*) filter (where m.match_type = 'ranked' and me.result = 'draw')::int as ranked_draws,
      min(m.finished_at) as first_match_at,
      max(m.finished_at) as latest_match_at
    from match_participants me
    join matches m on m.id = me.match_id
    left join match_participants opp on opp.match_id = me.match_id and opp.seat <> me.seat
    where me.player_id = ${playerId}
  `);
  const r = (res.rows as Array<Record<string, unknown>>)[0] ?? {};
  const num = (k: string) => Number(r[k] ?? 0);
  const total = num("total");
  const iso = (k: string) => (r[k] ? new Date(r[k] as string).toISOString() : null);
  return {
    total,
    wins: num("wins"),
    losses: num("losses"),
    draws: num("draws"),
    winRateBp: total > 0 ? Math.floor((num("wins") * 10000) / total) : null,
    crownsEarned: num("crowns_earned"),
    crownsConceded: num("crowns_conceded"),
    byType: {
      private: { matches: num("private_matches"), wins: num("private_wins"), losses: num("private_losses"), draws: num("private_draws") },
      matchmaking: { matches: num("mm_matches"), wins: num("mm_wins"), losses: num("mm_losses"), draws: num("mm_draws") },
      ranked: { matches: num("ranked_matches"), wins: num("ranked_wins"), losses: num("ranked_losses"), draws: num("ranked_draws") },
    },
    firstMatchAt: iso("first_match_at"),
    latestMatchAt: iso("latest_match_at"),
  };
}

export interface CasualEntry {
  position: number;
  username: string;
  displayName: string | null;
  avatar: PublicAvatar | null;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRateBp: number;
  crownsEarned: number;
  /** Internal only, used for isYou; never serialized to clients. */
  playerId: string;
}

const rankedCte = (minMatches: number) => sql`
  with agg as (
    select
      p.id as player_id,
      p.username,
      p.display_name,
      p.avatar_id,
      p.username_key,
      count(*)::int as matches,
      count(*) filter (where mp.result = 'win')::int as wins,
      count(*) filter (where mp.result = 'loss')::int as losses,
      count(*) filter (where mp.result = 'draw')::int as draws,
      (count(*) filter (where mp.result = 'win') * 10000 / count(*))::int as win_rate_bp,
      coalesce(sum(mp.crowns), 0)::int as crowns_earned
    from match_participants mp
    join matches m on m.id = mp.match_id
    join players p on p.id = mp.player_id
    where m.match_type = 'matchmaking'
      and p.account_status = 'active'
      and p.username is not null
    group by p.id
    having count(*) >= ${minMatches}
  ), ranked as (
    select *, rank() over (order by wins desc, win_rate_bp desc, crowns_earned desc) as position
    from agg
  )
`;

export async function getCasualLeaderboard(opts?: { limit?: number; offset?: number }): Promise<{
  entries: CasualEntry[];
  total: number;
  limit: number;
  offset: number;
}> {
  const limit = Math.min(Math.max(opts?.limit ?? CASUAL_DEFAULT_LIMIT, 1), CASUAL_MAX_LIMIT);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const db = getDb();
  const res = await db.execute(sql`
    ${rankedCte(CASUAL_MIN_MATCHES)}
    select *, count(*) over() as total
    from ranked
    order by wins desc, win_rate_bp desc, crowns_earned desc, username_key asc
    limit ${limit} offset ${offset}
  `);
  const rows = res.rows as Array<Record<string, unknown>>;
  return {
    entries: rows.map((r) => ({
      position: Number(r.position),
      username: String(r.username),
      displayName: (r.display_name as string | null) ?? null,
      avatar: resolveAvatar((r.avatar_id as string | null) ?? null),
      matches: Number(r.matches),
      wins: Number(r.wins),
      losses: Number(r.losses),
      draws: Number(r.draws),
      winRateBp: Number(r.win_rate_bp),
      crownsEarned: Number(r.crowns_earned),
      playerId: String(r.player_id),
    })),
    total: rows.length > 0 ? Number(rows[0]!.total) : 0,
    limit,
    offset,
  };
}

export async function getCasualPosition(playerId: string): Promise<{
  eligible: boolean;
  position: number | null;
  matchmakingMatches: number;
}> {
  const db = getDb();
  const res = await db.execute(sql`
    ${rankedCte(CASUAL_MIN_MATCHES)}
    select position, matches from ranked where player_id = ${playerId}
  `);
  const row = (res.rows as Array<Record<string, unknown>>)[0];
  if (row) {
    return { eligible: true, position: Number(row.position), matchmakingMatches: Number(row.matches) };
  }
  const mm = await db.execute(sql`
    select count(*)::int as n
    from match_participants mp
    join matches m on m.id = mp.match_id
    where mp.player_id = ${playerId} and m.match_type = 'matchmaking'
  `);
  return { eligible: false, position: null, matchmakingMatches: Number((mm.rows as Array<{ n: number }>)[0]?.n ?? 0) };
}
