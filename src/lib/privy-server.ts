import { PrivyClient, type AuthTokenClaims } from "@privy-io/server-auth";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

export interface PrivyIdentity {
  privyDid: string;
  sessionId: string;
  appId: string;
}

export type PrivyTokenVerifier = (token: string) => Promise<AuthTokenClaims>;

let clientInstance: PrivyClient | null = null;

function getClient(): PrivyClient {
  if (typeof window !== "undefined") {
    throw new Error("privy-server is server-only and must never run in a client bundle");
  }
  if (clientInstance) return clientInstance;
  const env = getEnv();
  clientInstance = new PrivyClient(env.NEXT_PUBLIC_PRIVY_APP_ID, env.PRIVY_APP_SECRET);
  return clientInstance;
}

export function resetPrivyClientCache() {
  clientInstance = null;
}

function defaultVerifier(token: string): Promise<AuthTokenClaims> {
  return getClient().verifyAuthToken(token);
}

// Verifies a Privy access token using the official SDK (signature, expiry,
// issuer) and additionally binds the claims to this application.
// A custom verifier may be injected for isolated unit tests; production code
// paths never inject one. Never trust an unverified decoded payload.
export async function verifyPrivyToken(
  token: string,
  verifier: PrivyTokenVerifier = defaultVerifier
): Promise<PrivyIdentity> {
  if (!token || typeof token !== "string" || token.length > 8192) {
    throw new AppError("UNAUTHORIZED", "Missing or malformed credentials");
  }
  const env = getEnv();
  let claims: AuthTokenClaims;
  try {
    claims = await verifier(token);
  } catch {
    throw new AppError("UNAUTHORIZED", "Invalid or expired credentials");
  }
  if (!claims || claims.appId !== env.NEXT_PUBLIC_PRIVY_APP_ID || !claims.userId) {
    throw new AppError("UNAUTHORIZED", "Invalid or expired credentials");
  }
  return { privyDid: claims.userId, sessionId: claims.sessionId, appId: claims.appId };
}

export async function getPrivyUser(privyDid: string) {
  return getClient().getUser(privyDid);
}
