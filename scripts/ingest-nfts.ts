// Bounded NFT ingestion for B1.1. Reads real onchain data and persists it.
// Usage: npm run nfts:ingest -- 1 2 3 [--test]
// --test routes all writes to DATABASE_URL_TEST. Max 50 tokens per run.
import "dotenv/config";
import { routeDalToTestDb } from "@/db/client";
import { parseTokenId, readOwner, readTokenUri, verifyCollection } from "@/lib/nft-contract";
import { resolveMetadata } from "@/lib/metadata";
import { upsertNftToken, upsertNftMetadata, recordMetadataFailure, recordOwnershipObservation } from "@/db/nfts";
import { AppError } from "@/lib/errors";

const MAX_TOKENS_PER_RUN = 50;
const CONCURRENCY = 3;

interface IngestOutcome {
  tokenId: string;
  ok: boolean;
  owner?: string;
  name?: string | null;
  traits?: number;
  error?: string;
}

async function ingestOne(tokenId: bigint): Promise<IngestOutcome> {
  const id = tokenId.toString();
  try {
    const [{ owner }, { tokenUri }] = await Promise.all([readOwner(tokenId), readTokenUri(tokenId)]);
    const token = await upsertNftToken({ tokenId: id, tokenUriOriginal: tokenUri });
    let name: string | null = null;
    let traits = 0;
    try {
      const resolved = await resolveMetadata(tokenUri);
      await upsertNftMetadata(token.id, resolved);
      name = resolved.name;
      traits = Array.isArray(resolved.attributesOriginal) ? resolved.attributesOriginal.length : 0;
    } catch (err) {
      await recordMetadataFailure(token.id, {
        error: err instanceof AppError ? `${err.code}: ${err.message}` : String(err).slice(0, 200),
        sourceUrl: tokenUri,
      });
    }
    await recordOwnershipObservation({ nftId: token.id, ownerAddress: owner });
    return { tokenId: id, ok: true, owner, name, traits };
  } catch (err) {
    return {
      tokenId: id,
      ok: false,
      error: err instanceof AppError ? `${err.code}: ${err.message}` : String(err).slice(0, 200),
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useTest = args.includes("--test");
  const ids = args.filter((a) => a !== "--test");
  if (useTest) routeDalToTestDb();
  if (ids.length === 0) {
    console.error("Usage: npm run nfts:ingest -- <tokenId...> [--test]");
    process.exit(1);
  }
  if (ids.length > MAX_TOKENS_PER_RUN) {
    console.error(`Refusing: max ${MAX_TOKENS_PER_RUN} tokens per run`);
    process.exit(1);
  }
  const parsed = ids.map((id) => parseTokenId(id));
  const verification = await verifyCollection();
  console.log(`Collection: ${verification.name} (${verification.symbol}) chain=${verification.chainId} target=${useTest ? "TEST" : "PROD"}`);

  const outcomes: IngestOutcome[] = [];
  for (let i = 0; i < parsed.length; i += CONCURRENCY) {
    const batch = await Promise.all(parsed.slice(i, i + CONCURRENCY).map(ingestOne));
    outcomes.push(...batch);
    for (const o of batch) {
      console.log(o.ok ? `OK ${o.tokenId} owner=${o.owner} name=${o.name} traits=${o.traits}` : `FAIL ${o.tokenId} ${o.error}`);
    }
  }
  const ok = outcomes.filter((o) => o.ok).length;
  console.log(`Done: ${ok}/${outcomes.length} ingested`);
  process.exit(ok === outcomes.length ? 0 : 2);
}

main().catch((err) => {
  console.error("INGEST_FATAL", String(err).slice(0, 300));
  process.exit(1);
});
