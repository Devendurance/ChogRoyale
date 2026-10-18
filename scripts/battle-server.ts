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
void import("@/server/battle/server")
  .then(({ startBattleServer }) => startBattleServer(port, {}, process.env.BATTLE_SERVER_HOST ?? "127.0.0.1"))
  .then(() => console.log(`battle server listening on ws://127.0.0.1:${port}`));
