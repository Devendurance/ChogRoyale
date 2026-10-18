import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getMonadClient, MONAD_CHAIN_ID, CHOG_GENESIS_ADDRESS } from "@/lib/chain";

const ERC721_MIN_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export interface CollectionVerification {
  chainId: number;
  address: string;
  isContract: boolean;
  bytecodeLength: number;
  name: string | null;
  symbol: string | null;
}

export function parseTokenId(raw: unknown): bigint {
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!/^\d{1,78}$/.test(s)) {
    throw new AppError("BAD_REQUEST", "tokenId must be a non-negative integer string");
  }
  return BigInt(s);
}

function isRevert(err: unknown): boolean {
  const msg = String((err as { shortMessage?: string })?.shortMessage ?? (err as Error)?.message ?? err);
  return /revert|nonexistent|invalid token|ERC721NonexistentToken|does not exist/i.test(msg);
}

// Confirms we are talking to the expected contract on the expected chain.
// Reads, never writes. Throws CONTRACT equivalent (SERVICE_UNAVAILABLE on
// RPC failure, BAD_REQUEST on wrong chain/empty code).
export async function verifyCollection(): Promise<CollectionVerification> {
  const client = getMonadClient();
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch {
    logger.error("monad chain id read failed", {});
    throw new AppError("SERVICE_UNAVAILABLE", "Monad RPC unavailable", { retryable: true });
  }
  if (chainId !== MONAD_CHAIN_ID) {
    throw new AppError("BAD_REQUEST", `Unexpected chain ${chainId}, expected Monad ${MONAD_CHAIN_ID}`);
  }
  let code: string | undefined;
  try {
    code = await client.getCode({ address: CHOG_GENESIS_ADDRESS as `0x${string}` });
  } catch {
    throw new AppError("SERVICE_UNAVAILABLE", "Monad RPC unavailable", { retryable: true });
  }
  if (!code || code === "0x") {
    throw new AppError("BAD_REQUEST", "No contract deployed at the configured collection address");
  }
  let name: string | null = null;
  let symbol: string | null = null;
  try {
    name = (await client.readContract({
      address: CHOG_GENESIS_ADDRESS as `0x${string}`,
      abi: ERC721_MIN_ABI,
      functionName: "name",
    })) as string;
    symbol = (await client.readContract({
      address: CHOG_GENESIS_ADDRESS as `0x${string}`,
      abi: ERC721_MIN_ABI,
      functionName: "symbol",
    })) as string;
  } catch {
    // name/symbol are informational; absence does not fail verification.
  }
  return { chainId, address: CHOG_GENESIS_ADDRESS, isContract: true, bytecodeLength: code.length, name, symbol };
}

export async function readOwner(tokenId: bigint): Promise<{ owner: string; chainId: number }> {
  const client = getMonadClient();
  try {
    const owner = (await client.readContract({
      address: CHOG_GENESIS_ADDRESS as `0x${string}`,
      abi: ERC721_MIN_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    })) as string;
    return { owner, chainId: MONAD_CHAIN_ID };
  } catch (err) {
    if (isRevert(err)) {
      throw new AppError("NOT_FOUND", `Token ${tokenId} does not exist`);
    }
    throw new AppError("SERVICE_UNAVAILABLE", "Monad RPC unavailable", { retryable: true });
  }
}

export async function readTokenUri(tokenId: bigint): Promise<{ tokenUri: string; chainId: number }> {
  const client = getMonadClient();
  try {
    const tokenUri = (await client.readContract({
      address: CHOG_GENESIS_ADDRESS as `0x${string}`,
      abi: ERC721_MIN_ABI,
      functionName: "tokenURI",
      args: [tokenId],
    })) as string;
    if (!tokenUri) throw new AppError("NOT_FOUND", `Token ${tokenId} has no metadata URI`);
    return { tokenUri, chainId: MONAD_CHAIN_ID };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isRevert(err)) {
      throw new AppError("NOT_FOUND", `Token ${tokenId} does not exist`);
    }
    throw new AppError("SERVICE_UNAVAILABLE", "Monad RPC unavailable", { retryable: true });
  }
}

// Best-effort capability probe. Absence of totalSupply/Enumerable only
// limits discovery strategy; it never blocks single-token reads.
export async function probeCapabilities(): Promise<{ totalSupply: string | null }> {
  const client = getMonadClient();
  try {
    const total = (await client.readContract({
      address: CHOG_GENESIS_ADDRESS as `0x${string}`,
      abi: [
        {
          name: "totalSupply",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "uint256" }],
        },
      ],
      functionName: "totalSupply",
    })) as bigint;
    return { totalSupply: total.toString() };
  } catch {
    return { totalSupply: null };
  }
}
