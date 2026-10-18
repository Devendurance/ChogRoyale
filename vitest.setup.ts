import dotenv from "dotenv";

dotenv.config({ path: ".env" });

// Opt-in isolated-database routing for DB integration suites:
//   CHOG_TEST_DB=1 npm run test -- src/db/
// Routes every DAL call to DATABASE_URL_TEST through the fail-closed guard.
// Production suites never set this flag.
if (process.env.CHOG_TEST_DB === "1") {
  const { routeDalToTestDb } = await import("@/db/client");
  routeDalToTestDb();
}
