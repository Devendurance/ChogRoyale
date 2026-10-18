import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { requireTestDatabaseUrl } from "@/db/test-db";

type Db = ReturnType<typeof drizzle>;

let dbInstance: Db | null = null;
let testOverride: Db | null = null;

export function createDb(url: string): Db {
  return drizzle(neon(url));
}

export function getDb(): Db {
  if (testOverride) return testOverride;
  if (dbInstance) return dbInstance;
  dbInstance = createDb(getEnv().DATABASE_URL);
  return dbInstance;
}

// Test-only connection injection. All DAL functions resolve through getDb(),
// so integration tests can target the isolated branch. Refuses to run in
// production and requires the fail-closed DATABASE_URL_TEST guard.
export function setDbForTesting(db: Db): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setDbForTesting is forbidden in production");
  }
  testOverride = db;
}

export function routeDalToTestDb(): void {
  setDbForTesting(createDb(requireTestDatabaseUrl()));
}

export async function pingDb(timeoutMs = 5000): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  const db = getDb();
  await Promise.race([
    db.execute(sql`select 1 as ok`),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("db ping timeout")), timeoutMs)
    ),
  ]);
  return { ok: true, latencyMs: Date.now() - started };
}

export function resetDbCache() {
  dbInstance = null;
}
