// B3.1 local battle server (dev alpha). Run: npm run battle:server
// Authenticates with real Privy tokens and reads players from the configured
// database (read-only). Writes no matches, results or awards anywhere except
// local replay records in .battle-replays/ (gitignored).

import dotenv from "dotenv";

dotenv.config({ path: ".env" });

if (process.env.NODE_ENV === "production" && process.env.CHOG_ALLOW_DEV_BATTLE !== "1") {
  console.error("battle:server is a development alpha and refuses to run with NODE_ENV=production");
  process.exit(1);
}

const port = Number(process.env.BATTLE_SERVER_PORT ?? 2567);

// B3.3a durable settlement is opt-in via BATTLE_SETTLEMENT=1. Enabling it
// requires the approved matches/match_participants/match_evidence migration
// applied to the database DATABASE_URL points at; the startup check refuses
// to write when the table is absent, so a dev server still cannot touch an
// unmigrated database.
async function settlementService() {
  if (process.env.BATTLE_SETTLEMENT !== "1") {
    console.log("settlement disabled");
    if (process.env.BATTLE_LEGACY === "1") console.log("legacy disabled");
    return null;
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`select to_regclass('public.matches') as t`;
  if (!rows[0]?.t) {
    console.error("BATTLE_SETTLEMENT=1 but public.matches is missing; apply the approved migration first. Settlement disabled.");
    return null;
  }
  const { SettlementService } = await import("@/server/battle/settlement");
  // B3.3b NFT legacy is opt-in via BATTLE_LEGACY=1 and requires both
  // settlement and the match_legacy_runs migration on the same database.
  let legacy = null;
  if (process.env.BATTLE_LEGACY === "1") {
    const check = await sql`select to_regclass('public.match_legacy_runs') as t`;
    if (!check[0]?.t) {
      console.error("BATTLE_LEGACY=1 but public.match_legacy_runs is missing; apply the approved migration first. Legacy disabled.");
    } else {
      const { LegacyProcessor } = await import("@/server/battle/legacy");
      legacy = new LegacyProcessor();
      console.log("legacy enabled");
    }
  } else {
    console.log("legacy disabled");
  }
  // P1b.2 ranked trophies ride on the settlement lifecycle: no new flags.
  // They stay disabled unless the ranked trophy migration is applied to
  // the same database, so an unmigrated database (including PROD until
  // the owner approves 0011/0012) can never take trophy writes.
  let trophies = null;
  {
    const check = await sql`select to_regclass('public.ranked_trophy_awards') as t`;
    if (!check[0]?.t) {
      console.log("trophies disabled (ranked_trophy_awards missing)");
    } else {
      const { TrophyService } = await import("@/server/battle/trophies");
      trophies = new TrophyService();
      console.log("trophies enabled");
    }
  }
  // P2a card XP rides on the settlement lifecycle: no new flags. It stays
  // disabled unless the card XP migration is applied to the same database,
  // so an unmigrated database (including PROD) can never take XP writes.
  let cardXp = null;
  {
    const check = await sql`select to_regclass('public.card_xp_runs') as t`;
    if (!check[0]?.t) {
      console.log("card xp disabled (card_xp_runs missing)");
    } else {
      const { CardXpService } = await import("@/server/battle/card-xp");
      cardXp = new CardXpService();
      console.log("card xp enabled");
    }
  }
  console.log("settlement enabled");
  return new SettlementService({ legacy, trophies, cardXp });
}

void settlementService()
  .then((settlement) => import("@/server/battle/server").then(({ startBattleServer }) => startBattleServer(port, { settlement }, process.env.BATTLE_SERVER_HOST ?? "127.0.0.1")))
  .then(() => console.log(`battle server listening on ws://127.0.0.1:${port}`));
