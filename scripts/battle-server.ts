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
  console.log("settlement enabled");
  return new SettlementService();
}

void settlementService()
  .then((settlement) => import("@/server/battle/server").then(({ startBattleServer }) => startBattleServer(port, { settlement }, process.env.BATTLE_SERVER_HOST ?? "127.0.0.1")))
  .then(() => console.log(`battle server listening on ws://127.0.0.1:${port}`));
