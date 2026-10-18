// B1.4a validation: derive a patron config for every resolved Genesis NFT.
// Read-only. Reports theme distribution, fallback usage, and any invalid
// configurations. Exits non-zero on the first invalid config.
// Usage: npm run patrons:validate
import "dotenv/config";
import { getDb } from "@/db/client";
import { derivePatronConfig, selectPatronTokenId } from "@/lib/patrons";

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
  const themes: Record<string, number> = {};
  let auraFallback = 0;
  let tierNull = 0;
  const invalid: string[] = [];
  for (const row of resolved.rows) {
    try {
      const a = derivePatronConfig({
        tokenId: row.token_id,
        attributes: row.attributes,
        metadataContentHash: row.content_hash,
        name: row.name,
      });
      const b = derivePatronConfig({
        tokenId: row.token_id,
        attributes: row.attributes,
        metadataContentHash: row.content_hash,
        name: row.name,
      });
      if (a.configHash !== b.configHash) invalid.push(`${row.token_id}:nondeterministic`);
      themes[a.theme] = (themes[a.theme] ?? 0) + 1;
      if (a.auraFallback) auraFallback++;
      if (a.tier === null) tierNull++;
    } catch (err) {
      invalid.push(`${row.token_id}:${err instanceof Error ? err.message.slice(0, 80) : "error"}`);
    }
  }
  const eligible = resolved.rows.map((r) => r.token_id);
  const picks = new Set(Array.from({ length: 50 }, (_, i) => selectPatronTokenId(`validate-${i}`, eligible)));
  console.log(
    JSON.stringify(
      { resolved: resolved.rows.length, themes, auraFallback, tierNull, invalid, selectionSpread50: picks.size },
      null,
      1
    )
  );
  if (invalid.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("PATRON_VALIDATE_FATAL", String(err).slice(0, 200));
  process.exit(1);
});
