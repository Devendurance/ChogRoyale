// P6e.1 operator integrity audit. Read-only by construction.
// Run: npm run economy:audit [-- --json] [--limit N]
// Safety:
// - Resolves the connection through requireTestDatabaseUrl, which refuses
//   when DATABASE_URL_TEST is missing or resolves to the PROD endpoint.
// - Issues SELECT statements only. No mutation path exists in this file.
// - Prints no connection strings, auth material, or wallet/Privy data.
// - Missing tables become NOT CHECKABLE, never a manufactured PASS.

import dotenv from "dotenv";

dotenv.config({ path: ".env" });

const LIMIT_DEFAULT = 2000;

function usage(): never {
  console.error("usage: economy:audit [--json] [--limit N]");
  process.exit(2);
}

function parseArgs(argv: string[]): { json: boolean; limit: number } {
  let json = false;
  let limit = LIMIT_DEFAULT;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--limit") {
      const n = Number(argv[i + 1]);
      if (!Number.isInteger(n) || n < 1 || n > 20000) usage();
      limit = n;
      i += 1;
    } else usage();
  }
  return { json, limit };
}

/** Branch slug without credentials: first hostname label only. */
function branchSlug(url: string): string {
  try {
    const host = new URL(url.trim()).hostname;
    return host.split(".")[0] ?? "test-branch";
  } catch {
    return "test-branch";
  }
}

async function main(): Promise<void> {
  const { json, limit } = parseArgs(process.argv.slice(2));

  // Fail closed before any query: missing TEST config or a TEST url that
  // resolves to PROD throws here and nothing connects anywhere.
  const { requireTestDatabaseUrl } = await import("@/db/test-db");
  const testUrl = requireTestDatabaseUrl();
  const branch = `TEST ${branchSlug(testUrl)} (verified distinct from PROD)`;

  const { neon } = await import("@neondatabase/serverless");
  const query = neon(testUrl);

  const {
    buildReport,
    formatReport,
    reportHasFail,
    reportToJson,
  } = await import("@/lib/economy-audit");

  const tables = [
    "matches",
    "match_participants",
    "match_evidence",
    "gold_earn_ledger",
    "gold_spend_ledger",
    "gift_sponsorships",
    "card_xp_progress",
    "card_xp_runs",
    "match_legacy_runs",
    "ranked_trophy_awards",
    "ranked_trophy_balances",
    "players",
  ] as const;
  const present = new Map<string, boolean>();
  for (const t of tables) {
    const rows = await query`select to_regclass(${`public.${t}`}) as t`;
    present.set(t, Boolean((rows as Array<{ t: string | null }>)[0]?.t));
  }
  const has = (t: string): boolean => present.get(t) === true;

  const matches =
    has("matches") && has("match_participants")
      ? ((await query`
          select m.id as id, m.match_type as type, m.verification as verification,
                 extract(epoch from m.finished_at) * 1000 as at
          from matches m
          order by m.finished_at desc
          limit ${limit}
        `) as Array<{ id: string; type: string; verification: string; at: string }>)
      : [];

  // Participants carry match type + time inline so pattern checks use real
  // settled rows only. Player ids are internal uuids for operator use.
  const participants =
    matches.length > 0
      ? ((await query`
          select p.match_id as mid, p.player_id as pid, p.result as result,
                 m.match_type as type, extract(epoch from m.finished_at) * 1000 as at
          from match_participants p
          join matches m on m.id = p.match_id
          where m.id in (select id from matches order by finished_at desc limit ${limit})
        `) as Array<{ mid: string; pid: string; result: string; type: string; at: string }>)
      : [];

  const earnRows = has("gold_earn_ledger")
    ? ((await query`
        select match_id as mid, player_id as pid, amount as amount, result as result
        from gold_earn_ledger
        limit ${limit}
      `) as Array<{ mid: string; pid: string; amount: number; result: string }>)
    : null;

  const spendRows = has("gold_spend_ledger")
    ? ((await query`
        select idempotency_key as key, player_id as pid, card_id as card,
               from_level as from, to_level as to, cost as cost
        from gold_spend_ledger
        limit ${limit}
      `) as Array<{ key: string; pid: string; card: string; from: number; to: number; cost: number }>)
    : null;

  const sponsorships = has("gift_sponsorships")
    ? ((await query`
        select id as id, idempotency_key as key, sponsor_id as s, recipient_id as r,
               card_id as card, from_level as from, to_level as to, cost as cost,
               extract(epoch from created_at) * 1000 as at
        from gift_sponsorships
        order by created_at desc
        limit ${limit}
      `) as Array<{ id: string; key: string; s: string; r: string; card: string; from: number; to: number; cost: number; at: string }>)
    : [];

  const xpProgress = has("card_xp_progress")
    ? ((await query`
        select player_id as pid, card_id as card, xp as xp, level as lv, purchased_level as bought
        from card_xp_progress
        limit ${limit}
      `) as Array<{ pid: string; card: string; xp: number; lv: number; bought: number }>)
    : [];

  const cardXpRunIds =
    has("card_xp_runs")
      ? new Set(
          (
            (await query`select match_id as id from card_xp_runs limit ${limit}`) as Array<{
              id: string;
            }>
          ).map((r) => String(r.id))
        )
      : null;

  const legacyRunIds =
    has("match_legacy_runs")
      ? new Set(
          (
            (await query`select match_id as id from match_legacy_runs limit ${limit}`) as Array<{
              id: string;
            }>
          ).map((r) => String(r.id))
        )
      : null;

  const rankedAwards = has("ranked_trophy_awards")
    ? ((await query`
        select match_id as mid, player_id as pid, season as season, result as result,
               delta as delta, balance_after as after
        from ranked_trophy_awards
        limit ${limit}
      `) as Array<{ mid: string; pid: string; season: number; result: string; delta: number; after: number | null }>)
    : [];

  const rankedBalances = has("ranked_trophy_balances")
    ? ((await query`
        select player_id as pid, season as season, trophies as t,
               ranked_matches as m, ranked_wins as w, ranked_losses as l, ranked_draws as d
        from ranked_trophy_balances
        limit ${limit}
      `) as Array<{ pid: string; season: number; t: number; m: number; w: number; l: number; d: number }>)
    : [];

  const evidenceMatchIds = has("match_evidence")
    ? new Set(
        (
          (await query`select match_id as id from match_evidence limit ${limit}`) as Array<{
            id: string;
          }>
        ).map((r) => String(r.id))
      )
    : null;

  const knownPlayerIds =
    has("players")
      ? new Set(
          (
            (await query`select id as id from players limit ${limit}`) as Array<{ id: string }>
          ).map((r) => String(r.id))
        )
      : null;

  const validResult = (r: string): r is "win" | "loss" | "draw" =>
    r === "win" || r === "loss" || r === "draw";

  const report = buildReport({
    branch,
    matchesReadable: has("matches") && has("match_participants"),
    evidenceMatchIds,
    matches: matches.map((m) => ({
      id: String(m.id),
      matchType: String(m.type),
      verification: String(m.verification),
      finishedAtMs: Number(m.at),
      seats: participants
        .filter((p) => String(p.mid) === String(m.id) && validResult(String(p.result)))
        .map((p) => ({ playerId: String(p.pid), result: String(p.result) as "win" | "loss" | "draw" })),
    })),
    participants: participants
      .filter((p) => validResult(String(p.result)))
      .map((p) => ({
        matchId: String(p.mid),
        playerId: String(p.pid),
        result: String(p.result) as "win" | "loss" | "draw",
        matchType: String(p.type),
        finishedAtMs: Number(p.at),
      })),
    earnRows:
      earnRows === null
        ? null
        : earnRows
            .filter((r) => validResult(String(r.result)))
            .map((r) => ({
              matchId: String(r.mid),
              playerId: String(r.pid),
              amount: Number(r.amount),
              result: String(r.result) as "win" | "loss" | "draw",
            })),
    spendRows:
      spendRows === null
        ? null
        : spendRows.map((r) => ({
            idempotencyKey: String(r.key),
            playerId: String(r.pid),
            cardId: String(r.card),
            fromLevel: Number(r.from),
            toLevel: Number(r.to),
            cost: Number(r.cost),
          })),
    sponsorships: sponsorships.map((r) => ({
      id: String(r.id),
      idempotencyKey: String(r.key),
      sponsorId: String(r.s),
      recipientId: String(r.r),
      cardId: String(r.card),
      fromLevel: Number(r.from),
      toLevel: Number(r.to),
      cost: Number(r.cost),
      createdAtMs: Number(r.at),
    })),
    knownSponsorshipSpendKeys: new Set(sponsorships.map((r) => String(r.key))),
    xpProgress: xpProgress.map((r) => ({
      playerId: String(r.pid),
      cardId: String(r.card),
      xp: Number(r.xp),
      level: Number(r.lv),
      purchasedLevel: Number(r.bought),
    })),
    rankedAwards: rankedAwards
      .filter((r) => validResult(String(r.result)))
      .map((r) => ({
        matchId: String(r.mid),
        playerId: String(r.pid),
        season: Number(r.season),
        result: String(r.result) as "win" | "loss" | "draw",
        delta: Number(r.delta),
        balanceAfter: r.after === null ? null : Number(r.after),
      })),
    rankedBalances: rankedBalances.map((r) => ({
      playerId: String(r.pid),
      season: Number(r.season),
      trophies: Number(r.t),
      rankedMatches: Number(r.m),
      rankedWins: Number(r.w),
      rankedLosses: Number(r.l),
      rankedDraws: Number(r.d),
    })),
    cardXpRunIds,
    legacyRunIds,
    knownPlayerIds,
  });

  if (json) {
    console.log(reportToJson(report));
  } else {
    console.log(formatReport(report));
  }
  process.exit(reportHasFail(report) ? 1 : 0);
}

main().catch((e) => {
  console.error(`ECONOMY_AUDIT_FAIL ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
  process.exit(2);
});
