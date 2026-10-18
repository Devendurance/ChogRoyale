// B1.4b validation: derive a Chaos Pulse schedule for every resolved
// Genesis patron. Read-only. Reports family distribution, bound compliance,
// determinism, tier neutrality, and any invalid configurations.
// Usage: npm run chaos:validate
import "dotenv/config";
import { getDb } from "@/db/client";
import { derivePatronConfig } from "@/lib/patrons";
import { deriveChaosSchedule, CHAOS_BOUNDS_V1, CHAOS_TIMELINE_V1 } from "@/lib/chaos";

async function main() {
  const db = getDb();
  const { sql } = await import("drizzle-orm");
  const resolved = (await db.execute(
    sql`select t.token_id, m.attributes_original as attributes, m.content_hash, m.name from nft_tokens t join nft_metadata m on m.nft_id = t.id where m.status = 'resolved' order by t.token_id`
  )) as unknown as {
    rows: Array<{
      token_id: string;
      attributes: Array<{ trait_type: string; value: string | number }> | null;
      content_hash: string;
      name: string | null;
    }>;
  };
  const families: Record<string, number> = {};
  const tiers: Record<string, number> = {};
  let boundViolations = 0;
  let nondeterministic = 0;
  const invalid: string[] = [];
  for (const row of resolved.rows) {
    try {
      const patron = derivePatronConfig({
        tokenId: row.token_id,
        attributes: row.attributes,
        metadataContentHash: row.content_hash,
        name: row.name,
      });
      const a = deriveChaosSchedule({ patron, serverSeed: `validate:${row.token_id}` });
      const b = deriveChaosSchedule({ patron, serverSeed: `validate:${row.token_id}` });
      if (a.scheduleHash !== b.scheduleHash) nondeterministic++;
      // Tier neutrality: same traits, every tier, identical magnitudes.
      const base = JSON.stringify(a.events.map((e) => ({ ...e, displayName: "X", id: "Y" })));
      for (const tier of ["Common", "Uncommon", "Rare", "Epic", "Legendary"]) {
        const t = deriveChaosSchedule({
          patron: { ...patron, tier },
          serverSeed: `validate:${row.token_id}`,
        });
        if (JSON.stringify(t.events.map((e) => ({ ...e, displayName: "X", id: "Y" }))) !== base) {
          boundViolations++;
          break;
        }
      }
      for (const e of a.events) {
        families[e.family] = (families[e.family] ?? 0) + 1;
        if (e.warnMs >= e.activationMs) invalid.push(`${row.token_id}:warn-after-activation`);
        if (e.expireMs > CHAOS_TIMELINE_V1.durationMs + CHAOS_TIMELINE_V1.overtimeMs) {
          invalid.push(`${row.token_id}:overrun`);
        }
        const fx = e.effect as { durationMs?: number };
        if (
          fx.durationMs !== undefined &&
          (fx.durationMs < CHAOS_BOUNDS_V1.durationMs.min || fx.durationMs > CHAOS_BOUNDS_V1.durationMs.max)
        ) {
          invalid.push(`${row.token_id}:duration-out-of-bounds`);
        }
      }
      tiers[patron.tier ?? "null"] = (tiers[patron.tier ?? "null"] ?? 0) + 1;
    } catch (err) {
      invalid.push(`${row.token_id}:${err instanceof Error ? err.message.slice(0, 80) : "error"}`);
    }
  }
  console.log(
    JSON.stringify(
      {
        resolved: resolved.rows.length,
        families,
        tiers,
        boundViolations,
        nondeterministic,
        invalid: invalid.slice(0, 10),
        invalidCount: invalid.length,
      },
      null,
      1
    )
  );
  if (invalid.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("CHAOS_VALIDATE_FATAL", String(err).slice(0, 200));
  process.exit(1);
});
