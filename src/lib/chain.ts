import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import { getEnv } from "@/lib/env";

export const MONAD_CHAIN_ID = 143;

export const monadMainnet = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
});

export const CHOG_GENESIS_ADDRESS = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";

let clientInstance: PublicClient | null = null;

// Single shared server-side client. RPC URL is configurable for staging;
// chain binding is verified on every sensitive read, not assumed here.
export function getMonadClient(): PublicClient {
  if (clientInstance) return clientInstance;
  const env = getEnv();
  const rpcUrl = (env.MONAD_RPC_URL || "https://rpc.monad.xyz").trim();
  clientInstance = createPublicClient({
    chain: monadMainnet,
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 2, retryDelay: 500 }),
  }) as PublicClient;
  return clientInstance;
}

export function resetMonadClientCache() {
  clientInstance = null;
}
