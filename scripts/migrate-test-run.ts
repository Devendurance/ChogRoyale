// One-off: apply pending migrations to the TEST branch using the app's
// working Neon client (drizzle-kit CLI fails silently on the TEST branch).
import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST missing");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("TEST migrate ok");
  await pool.end();
}

main().catch((e) => {
  console.error("TEST_MIGRATE_FAIL", String(e).slice(0, 300));
  process.exit(1);
});
