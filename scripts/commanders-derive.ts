// Commander derivation runner (B1.3).
// Usage: npm run commanders:derive [-- --test]
// Derives v1 commanders for every NFT with resolved metadata. Resumable and
// idempotent: re-runs only revise rows whose metadata content changed.
// Writes go to PROD unless --test routes to DATABASE_URL_TEST.
import "dotenv/config";
import { routeDalToTestDb, getDb } from "@/db/client";
import { deriveCommander } from "@/lib/commanders";
import {
  ensureCurrentRuleset,
  upsertCommander,
  countCommanders,
} from "@/db/commanders";
import { COMMANDER_RULESET_VERSION } from "@/lib/commanders";

async function main() {
  const useTest = process.argv.includes("--test");
  if (useTest) routeDalToTestDb();
  console.log(`target=${useTest ? "TEST" : "PROD"} ruleset=${COMMANDER_RULESET_VERSION}`);

  await ensureCurrentRuleset();
  const db = getDb();

  // Page through resolved metadata with their token identities. B1.2
  // ingestion may insert rows concurrently, shifting LIMIT/OFFSET pages, so
  // repeat full passes until no resolved token lacks a commander (bounded).
  let derived = 0;
  let revised = 0;
  let skipped = 0;
  let errors = 0;
  const unmatchedFreq = new Map<string, number>();

  // Bulk-first passes: two queries per pass, writes only for missing or
  // changed rows. B1.2 ingestion may add rows concurrently, so repeat until
  // no resolved token lacks a current commander (bounded).
  const { sql } = await import("drizzle-orm");
  for (let pass = 1; pass <= 5; pass++) {
    const resolved = (await db.execute(
      sql`select t.id as nft_id, t.token_id, m.attributes_original as attributes from nft_tokens t join nft_metadata m on m.nft_id = t.id where m.status = 'resolved' order by t.token_id`
    )) as unknown as {
      rows: Array<{ nft_id: string; token_id: string; attributes: Array<{ trait_type: string; value: string | number }> | null }>;
    };
    const existing = (await db.execute(
      sql`select nft_id, content_hash from commanders where ruleset_version = ${COMMANDER_RULESET_VERSION}`
    )) as unknown as { rows: Array<{ nft_id: string; content_hash: string }> };
    const hashByNft = new Map(existing.rows.map((r) => [r.nft_id, r.content_hash]));
    let passWrites = 0;
    for (const row of resolved.rows) {
      try {
        const attrs = row.attributes ?? [];
        const def = deriveCommander({ attributes: attrs });
        if (hashByNft.get(row.nft_id) === def.derivationHash) {
          skipped++;
        } else {
          const res = await upsertCommander({ nftId: row.nft_id, tokenId: row.token_id, definition: def });
          hashByNft.set(row.nft_id, def.derivationHash);
          passWrites++;
          if (res.revised) revised++;
          else derived++;
        }
        for (const u of def.unmatchedTraits) {
          if (u.cosmetic) continue;
          unmatchedFreq.set(`${u.traitType}=${u.traitValue}`, (unmatchedFreq.get(`${u.traitType}=${u.traitValue}`) ?? 0) + 1);
        }
      } catch (err) {
        errors++;
        console.error(`token ${row.token_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`pass=${pass} resolved=${resolved.rows.length} writes=${passWrites} skipped=${skipped} errors=${errors}`);
    if (passWrites === 0) break;
  }

  const counts = await countCommanders();
  console.log(
    JSON.stringify(
      {
        ruleset: COMMANDER_RULESET_VERSION,
        derived,
        revised,
        skipped,
        errors,
        persisted: counts,
        topUnmatched: [...unmatchedFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
      },
      null,
      1
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
