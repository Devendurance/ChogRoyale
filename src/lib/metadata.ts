import { createHash } from "crypto";
import { lookup } from "dns/promises";
import { AppError } from "@/lib/errors";

export const METADATA_MAX_BYTES = 1_000_000;
export const METADATA_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

// Ordered by observed reliability (Oct 2026): filebase serves correctly;
// pinata throttles aggressively under parallel load; cloudflare times out
// and ipfs.io serves worker-gateway notices, so both are excluded.
const DEFAULT_GATEWAYS = [
  "https://ipfs.filebase.io/ipfs",
  "https://gateway.pinata.cloud/ipfs",
];

export function getIpfsGateways(): string[] {
  const raw = process.env.IPFS_GATEWAYS;
  if (raw) {
    const list = raw.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
    if (list.length > 0) return list;
  }
  return DEFAULT_GATEWAYS;
}

function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("169.254.") || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  if (/^127\./.test(ip)) return true;
  return false;
}

// SSRF guard: https only, no credentials, hostname resolves exclusively to
// public addresses.
async function assertSafeHttpsUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:") {
    throw new AppError("BAD_REQUEST", `Unsupported metadata URL scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new AppError("BAD_REQUEST", "Metadata URLs must not contain credentials");
  }
  let records: Array<{ address: string }>;
  try {
    records = await lookup(url.hostname, { all: true });
  } catch {
    throw new AppError("UNPROCESSABLE", "Metadata host does not resolve");
  }
  if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) {
    throw new AppError("FORBIDDEN", "Metadata host resolves to a private address");
  }
}

async function fetchCapped(url: string): Promise<{ bytes: Buffer; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);
    await assertSafeHttpsUrl(parsed);
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "chog-royale-metadata/1.0" },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.arrayBuffer().catch(() => null);
      if (!location) throw new AppError("UNPROCESSABLE", "Metadata redirect without location");
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after");
      await res.arrayBuffer().catch(() => null);
      if (res.status === 429 || res.status === 503) {
        let retryAfterMs: number | null = null;
        if (retryAfter) {
          const secs = Number(retryAfter);
          if (Number.isFinite(secs)) retryAfterMs = Math.min(Math.max(secs * 1000, 0), 60000);
          else {
            const when = Date.parse(retryAfter);
            if (Number.isFinite(when)) retryAfterMs = Math.min(Math.max(when - Date.now(), 0), 60000);
          }
        }
        throw new AppError("RATE_LIMITED", `Metadata fetch throttled with status ${res.status}`, {
          retryable: true,
          details: { status: res.status, retryAfterMs },
        });
      }
      throw new AppError("UNPROCESSABLE", `Metadata fetch failed with status ${res.status}`);
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > METADATA_MAX_BYTES) {
      await res.arrayBuffer().catch(() => null);
      throw new AppError("UNPROCESSABLE", "Metadata document exceeds size limit");
    }
    const reader = res.body?.getReader();
    if (!reader) throw new AppError("UNPROCESSABLE", "Metadata response has no body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > METADATA_MAX_BYTES) {
        await reader.cancel().catch(() => null);
        throw new AppError("UNPROCESSABLE", "Metadata document exceeds size limit");
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return { bytes, finalUrl: current };
  }
  throw new AppError("UNPROCESSABLE", "Metadata redirect limit exceeded");
}

export interface ResolvedMetadata {
  sourceUrl: string;
  contentHash: string;
  document: Record<string, unknown>;
  name: string | null;
  description: string | null;
  imageOriginal: string | null;
  attributesOriginal: unknown;
  fetchedAt: Date;
}

function parseDocument(bytes: Buffer, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new AppError("UNPROCESSABLE", `Metadata at ${source} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("UNPROCESSABLE", "Metadata document must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function buildResolved(sourceUrl: string, bytes: Buffer): ResolvedMetadata {
  const document = parseDocument(bytes, sourceUrl);
  const attributes = (document as { attributes?: unknown }).attributes ?? null;
  return {
    sourceUrl,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    document,
    name: asText(document.name),
    description: asText(document.description),
    imageOriginal: asText(document.image),
    attributesOriginal: attributes,
    fetchedAt: new Date(),
  };
}

function resolveDataUri(uri: string): ResolvedMetadata {
  const match = /^data:application\/json(;base64)?,([\s\S]*)$/.exec(uri);
  if (!match) throw new AppError("BAD_REQUEST", "Unsupported data URI metadata format");
  const bytes = match[1] ? Buffer.from(match[2] ?? "", "base64") : Buffer.from(decodeURIComponent(match[2] ?? ""));
  if (bytes.byteLength > METADATA_MAX_BYTES) {
    throw new AppError("UNPROCESSABLE", "Metadata document exceeds size limit");
  }
  return buildResolved("data:application/json", bytes);
}

// Resolves a tokenURI to its preserved original document. Tries configured
// IPFS gateways in order for ipfs:// URIs. Never rewrites trait values;
// unknown fields, duplicates and non-string values pass through untouched.
export async function resolveMetadata(tokenUri: string): Promise<ResolvedMetadata> {
  const uri = tokenUri.trim();
  if (uri.startsWith("data:")) return resolveDataUri(uri);
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice("ipfs://".length);
    if (!path || path.includes("..")) throw new AppError("BAD_REQUEST", "Invalid IPFS metadata URI");
    let lastError: unknown = null;
    for (const gateway of getIpfsGateways()) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { bytes, finalUrl } = await fetchCapped(`${gateway}/${path}`);
          return buildResolved(finalUrl, bytes);
        } catch (err) {
          lastError = err;
          const rateLimited = err instanceof AppError && err.code === "RATE_LIMITED";
          if (!rateLimited) break;
          const details = (err as AppError).details as { retryAfterMs?: number | null } | undefined;
          const base = details?.retryAfterMs ?? 2000 * Math.pow(2, attempt);
          const capped = Math.min(Math.max(base, 2000), 30000);
          const jitter = Math.floor(Math.random() * 1000);
          await new Promise((r) => setTimeout(r, capped + jitter));
        }
      }
    }
    if (lastError instanceof AppError) throw lastError;
    throw new AppError("SERVICE_UNAVAILABLE", "IPFS gateways unavailable", { retryable: true });
  }
  if (uri.startsWith("https://")) {
    const { bytes, finalUrl } = await fetchCapped(uri);
    return buildResolved(finalUrl, bytes);
  }
  throw new AppError("BAD_REQUEST", "Unsupported metadata URI scheme");
}
