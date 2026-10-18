// Full-collection NFT indexing orchestrator (B1.2).
// Usage: npm run nfts:index -- <discover|ingest-missing|traits|sync-ownership|coverage> [--test]
// Writes go to PROD unless --test routes to DATABASE_URL_TEST.
import "dotenv/config";
import { routeDalToTestDb } from "@/db/client";
import { probeCapabilities } from "@/lib/nft-contract";
import { probeBoundaries, scanRange, fetchTransfers } from "@/lib/discovery";
import { getMonadClient } from "@/lib/chain";
import {
  getNftByTokenId,
  upsertNftToken,
  upsertNftMetadata,
  recordMetadataFailure,
  recordOwnershipObservation,
  getCheckpoint,
  setCheckpoint,
  countIndexedTokens,
  countMetadataByStatus,
  refreshTraitStats,
} from "@/db/nfts";
import { resolveMetadata } from "@/lib/metadata";
import { readOwner, readTokenUri } from "@/lib/nft-contract";
import { AppError } from "@/lib/errors";

const CONCURRENCY = 1;
// Gateway spacing: public IPFS gateways throttle sustained streams, so keep
// single-stream requests >=6s apart (backoff adds more under pressure).
const PACING_MS = 6000;

async function cmdDiscover() {
  const { totalSupply } = await probeCapabilities();
  if (!totalSupply) throw new Error("totalSupply unavailable, aborting discovery");
  const supply = BigInt(totalSupply);
  console.log(`totalSupply=${supply}`);
  const boundaries = await probeBoundaries(supply);
  console.log(`token0 exists=${boundaries.zeroExists}`);
  for (const b of boundaries.beyondSupply) console.log(`id ${b.tokenId} exists=${b.exists}`);
  const scan = await scanRange(BigInt(1), supply, 12);
  const margin = await scanRange(supply + BigInt(1), supply + BigInt(50), 12);
  console.log(
    JSON.stringify({
      supply: supply.toString(),
      existingInRange: scan.existing.length,
      missingInRange: scan.missingInRange,
      existingBeyondSupply: margin.existing.map((e) => e.tokenId),
    })
  );
}

async function withDbRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

async function ingestId(id: string): Promise<string> {
  const tokenId = BigInt(id);
  try {
    const existing = await withDbRetry(() => getNftByTokenId(id));
    // tokenURI is immutable on-chain and ownership transfers are tracked by
    // the sync-ownership event scan, so when both are already observed only
    // the missing metadata needs fetching (saves 2 slow public-RPC calls).
    const [{ owner }, { tokenUri }] =
      existing?.token.tokenUriOriginal && existing.latestObservation
        ? [{ owner: existing.latestObservation.ownerAddress }, { tokenUri: existing.token.tokenUriOriginal as string }]
        : await Promise.all([readOwner(tokenId), readTokenUri(tokenId)]);
    const token = await withDbRetry(() => upsertNftToken({ tokenId: id, tokenUriOriginal: tokenUri }));
    if (!existing?.metadata || existing.metadata.status !== "resolved") {
      try {
        const resolved = await resolveMetadata(tokenUri);
        await withDbRetry(() => upsertNftMetadata(token.id, resolved));
      } catch (err) {
        const detail = err instanceof AppError ? `${err.code}: ${err.message}` : String(err).slice(0, 200);
        await withDbRetry(() =>
          recordMetadataFailure(token.id, { error: detail, sourceUrl: tokenUri })
        );
        const throttled = detail.includes("429") || detail.includes("RATE_LIMITED") || detail.includes("503");
        return throttled ? `${id}:metadata-failed:429` : `${id}:metadata-failed`;
      }
    }
    if (!existing?.latestObservation || existing.latestObservation.ownerNormalized !== owner.trim().toLowerCase()) {
      await withDbRetry(() => recordOwnershipObservation({ nftId: token.id, ownerAddress: owner }));
    }
    return `${id}:ok`;
  } catch (err) {
    return `${id}:error:${err instanceof AppError ? err.code : "RPC"}`;
  }
}

async function cmdIngestMissing(limit?: number) {
  const { totalSupply } = await probeCapabilities();
  if (!totalSupply) throw new Error("totalSupply unavailable");
  const supply = BigInt(totalSupply);
  // Single-query completeness check: no per-token round trips.
  const db = (await import("@/db/client")).getDb();
  const { sql } = await import("drizzle-orm");
  const rows = await withDbRetry(() =>
    db.execute(sql`select t.token_id, (m.status = 'resolved') as meta_ok, count(o.id) > 0 as has_owner from nft_tokens t left join nft_metadata m on m.nft_id = t.id left join nft_ownership_observations o on o.nft_id = t.id group by t.token_id, m.status`)
  );
  const complete = new Set(
    (rows.rows as Array<{ token_id: string; meta_ok: boolean; has_owner: boolean }>)
      .filter((r) => r.meta_ok && r.has_owner)
      .map((r) => r.token_id)
  );
  const ids: string[] = [];
  for (let id = BigInt(1); id <= supply; id++) {
    if (!complete.has(id.toString())) ids.push(id.toString());
    if (limit && ids.length >= limit) break;
  }
  console.log(`missing-or-incomplete=${ids.length}`);
  let ok = 0;
  let cooled = 0;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const results = await Promise.all(
      ids.slice(i, i + CONCURRENCY).map(async (id) => {
        const r = await ingestId(id);
        await new Promise((s) => setTimeout(s, PACING_MS));
        return r;
      })
    );
    const batch429 = results.filter((r) => r.includes("429")).length;
    if (results.length >= 1 && batch429 === results.length) {
      // All gateways throttling: cool down instead of burning retries.
      cooled++;
      const cooldownMs = Math.min(90000 * Math.pow(2, Math.min(cooled - 1, 2)), 300000);
      console.log(`all gateways 429, cooling down ${Math.round(cooldownMs / 1000)}s (cooldown #${cooled})`);
      await new Promise((s) => setTimeout(s, cooldownMs));
    }
    for (const r of results) {
      if (r.endsWith(":ok")) ok++;
      else console.log(r);
    }
    if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= ids.length) {
      console.log(`progress ${Math.min(i + CONCURRENCY, ids.length)}/${ids.length} ok=${ok}`);
    }
  }
  console.log(`Done: ${ok}/${ids.length}`);
}

async function cmdTraits() {
  const stats = await refreshTraitStats();
  console.log(`trait types=${stats.types} values=${stats.values}`);
}

async function cmdSyncOwnership() {
  const client = getMonadClient();
  const latest = await client.getBlockNumber();
  const stored = await getCheckpoint("ownership-transfers");
  const from = stored ? BigInt(stored) : latest - BigInt(500);
  const OVERLAP = BigInt(20);
  const start = (stored ? from - OVERLAP : from) < BigInt(0) ? BigInt(0) : stored ? from - OVERLAP : from;
  let processed = 0;
  let cursor = start;
  while (cursor <= latest) {
    const to = cursor + BigInt(99) > latest ? latest : cursor + BigInt(99);
    const transfers = await fetchTransfers(cursor, to);
    for (const t of transfers) {
      const token = await upsertNftToken({ tokenId: t.tokenId });
      await recordOwnershipObservation({
        nftId: token.id,
        ownerAddress: t.to,
        blockNumber: t.blockNumber,
      });
      processed++;
    }
    await setCheckpoint("ownership-transfers", to.toString());
    cursor = to + BigInt(1);
  }
  console.log(`sync done: range ${start}..${latest}, transfer observations=${processed}`);
}

async function cmdCoverage() {
  const { totalSupply } = await probeCapabilities();
  const indexed = await countIndexedTokens();
  const meta = await countMetadataByStatus();
  const checkpoint = await getCheckpoint("ownership-transfers");
  console.log(
    JSON.stringify({ totalSupply, indexed, metadataResolved: meta.resolved, metadataFailed: meta.failed, ownershipCheckpoint: checkpoint })
  );
}

async function main() {
  const args = process.argv.slice(2);
  const useTest = args.includes("--test");
  if (useTest) routeDalToTestDb();
  const cmd = args.find((a) => !a.startsWith("--"));
  console.log(`target=${useTest ? "TEST" : "PROD"}`);
  if (cmd === "discover") await cmdDiscover();
  else if (cmd === "ingest-missing") await cmdIngestMissing(args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : undefined);
  else if (cmd === "traits") await cmdTraits();
  else if (cmd === "sync-ownership") await cmdSyncOwnership();
  else if (cmd === "coverage") await cmdCoverage();
  else {
    console.error("Usage: npm run nfts:index -- <discover|ingest-missing|traits|sync-ownership|coverage> [--test] [--limit N]");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("INDEX_FATAL", String(err).slice(0, 300));
  process.exit(1);
});
