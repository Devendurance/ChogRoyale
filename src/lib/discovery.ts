import { getMonadClient, CHOG_GENESIS_ADDRESS } from "@/lib/chain";

export interface ExistenceSample {
  tokenId: string;
  exists: boolean;
  owner?: string;
}

const OWNER_OF_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

async function ownerOfOrNull(tokenId: bigint): Promise<string | null> {
  const client = getMonadClient();
  try {
    return (await client.readContract({
      address: CHOG_GENESIS_ADDRESS as `0x${string}`,
      abi: OWNER_OF_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    })) as string;
  } catch {
    return null;
  }
}

async function mapBounded<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

// Boundary evidence: token 0 and IDs beyond supply must revert. Returns the
// observed results so callers can document them instead of assuming a range.
export async function probeBoundaries(supply: bigint): Promise<{
  zeroExists: boolean;
  beyondSupply: Array<{ tokenId: string; exists: boolean }>;
}> {
  const beyond = [supply + BigInt(1), supply + BigInt(50), supply * BigInt(2), BigInt(10000)];
  const [zero, ...rest] = await mapBounded([BigInt(0), ...beyond], 5, ownerOfOrNull);
  return {
    zeroExists: zero !== null,
    beyondSupply: beyond.map((id, i) => ({ tokenId: id.toString(), exists: rest[i] !== null })),
  };
}

export interface CollectionScan {
  supply: string;
  scannedFrom: string;
  scannedTo: string;
  existing: ExistenceSample[];
  missingInRange: string[];
}

// Exhaustive existence scan over [from, to] using live ownerOf reads.
// Missing IDs revert and are reported, never fabricated.
export async function scanRange(from: bigint, to: bigint, concurrency = 10): Promise<CollectionScan> {
  const ids: bigint[] = [];
  for (let id = from; id <= to; id++) ids.push(id);
  const owners = await mapBounded(ids, concurrency, async (id) => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const owner = (await getMonadClient().readContract({
          address: CHOG_GENESIS_ADDRESS as `0x${string}`,
          abi: OWNER_OF_ABI,
          functionName: "ownerOf",
          args: [id],
        })) as string;
        return { id, owner };
      } catch (err) {
        lastError = err;
        const msg = String((err as { shortMessage?: string })?.shortMessage ?? (err as Error)?.message ?? "");
        if (/revert|nonexistent|does not exist/i.test(msg)) return { id, owner: null };
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastError;
  });
  const existing: ExistenceSample[] = [];
  const missingInRange: string[] = [];
  for (const o of owners) {
    if (o.owner) existing.push({ tokenId: o.id.toString(), exists: true, owner: o.owner });
    else missingInRange.push(o.id.toString());
  }
  return { supply: "", scannedFrom: from.toString(), scannedTo: to.toString(), existing, missingInRange };
}

export interface TransferRecord {
  tokenId: string;
  from: string;
  to: string;
  blockNumber: string;
  logIndex: number;
}

const TRANSFER_EVENT = {
  name: "Transfer",
  type: "event",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
} as const;

// Bounded Transfer log fetch (public RPC caps ranges at ~100 blocks).
// Used for incremental sync from a stored checkpoint, never full history.
export async function fetchTransfers(fromBlock: bigint, toBlock: bigint): Promise<TransferRecord[]> {
  const client = getMonadClient();
  const logs = await client.getLogs({
    address: CHOG_GENESIS_ADDRESS as `0x${string}`,
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock,
  });
  return logs.map((l) => ({
    tokenId: (l.args as unknown as { tokenId: bigint }).tokenId.toString(),
    from: (l.args as unknown as { from: string }).from,
    to: (l.args as unknown as { to: string }).to,
    blockNumber: (l.blockNumber ?? BigInt(0)).toString(),
    logIndex: l.logIndex ?? 0,
  }));
}
