import type { LoanView } from "@/db/lending";
import type { FriendPlayer } from "@/db/friendships";

export type CommanderLoan = LoanView;
export type LoanPeer = FriendPlayer;
export interface LoanCommander {
  tokenId: string;
  name: string | null;
  imageUrl: string | null;
  status: string;
  eligible: boolean;
  ownership: "owned" | "borrowed" | "lent";
  loan?: { id: string; endsAt: string };
}
export interface LoanLists { lent: CommanderLoan[]; borrowed: CommanderLoan[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
export function isLoan(value: unknown): value is CommanderLoan {
  return object(value) && ["id", "tokenId", "ownerId", "borrowerId", "contract", "startsAt", "endsAt", "createdAt", "updatedAt"].every((key) => typeof value[key] === "string") && typeof value.chainId === "number" && ["active", "expired", "revoked", "returned"].includes(String(value.status)) && ["startsAt", "endsAt"].every((key) => Number.isFinite(Date.parse(String(value[key]))));
}
export function parseLoanLists(value: unknown): LoanLists {
  if (!object(value) || !Array.isArray(value.lent) || !Array.isArray(value.borrowed) || !value.lent.every(isLoan) || !value.borrowed.every(isLoan)) throw new LoanError(503);
  return { lent: value.lent, borrowed: value.borrowed };
}
export function parseLoanCommanders(value: unknown): LoanCommander[] {
  if (!object(value) || !Array.isArray(value.nftCommanders)) throw new LoanError(503);
  return value.nftCommanders.flatMap((entry) => {
    if (!object(entry) || typeof entry.tokenId !== "string" || typeof entry.status !== "string" || typeof entry.eligible !== "boolean") throw new LoanError(503);
    const ownership = entry.ownership === "lent" ? "lent" : entry.basis === "borrowed" || entry.ownership === "borrowed" ? "borrowed" : "owned";
    const loan = object(entry.loan) && typeof entry.loan.id === "string" && typeof entry.loan.endsAt === "string" && Number.isFinite(Date.parse(entry.loan.endsAt))
      ? { id: entry.loan.id, endsAt: entry.loan.endsAt }
      : undefined;
    return [{ tokenId: entry.tokenId, status: entry.status, eligible: entry.eligible, ownership, loan, name: typeof entry.name === "string" ? entry.name : null, imageUrl: typeof entry.imageUrl === "string" && /^https:\/\//.test(entry.imageUrl) ? entry.imageUrl : null }];
  });
}
export function parseLoanFriends(value: unknown): LoanPeer[] {
  if (!object(value) || !Array.isArray(value.friends)) throw new LoanError(503);
  return value.friends.map((row) => {
    if (!object(row) || row.status !== "accepted" || !object(row.player) || typeof row.player.id !== "string" || !["username", "displayName", "avatarId"].every((key) => row.player && object(row.player) && (row.player[key] === null || typeof row.player[key] === "string"))) throw new LoanError(503);
    return row.player as unknown as LoanPeer;
  });
}
export const validLoanDuration = (days: number) => Number.isInteger(days) && days >= 1 && days <= 7;
export const loanPeerName = (peer?: LoanPeer) => peer?.displayName?.trim() || peer?.username?.trim() || "Player identity unavailable";
export const availableToLend = (commander: LoanCommander, lent: CommanderLoan[]) => commander.ownership === "owned" && commander.status === "derived" && commander.eligible && !lent.some((loan) => loan.tokenId === commander.tokenId && loan.status === "active");
export function remainingLoanTime(endsAt: string, now: number) {
  const remaining = Date.parse(endsAt) - now;
  if (remaining <= 0) return "Expiry reached. Refresh to verify access.";
  const hours = Math.ceil(remaining / 3600000);
  return hours >= 24 ? `${Math.ceil(hours / 24)} days remaining` : `${hours} ${hours === 1 ? "hour" : "hours"} remaining`;
}
export class LoanError extends Error {
  constructor(public status: number) {
    super(status === 401 ? "Sign in again to open commander lending." : status === 403 ? "This commander or player is unavailable for this action." : status === 404 ? "This loan is unavailable. Refresh to check its current status." : status === 409 ? "The loan or commander changed. Review the refreshed state before trying again." : status === 400 ? "Check the commander, friend and duration, then try again." : status === 429 ? "Too many requests. Wait a moment before trying again." : "Commander lending is unavailable right now. Your choices are preserved. Refresh to try again.");
  }
}
export async function loanRequest<T>(path: string, getToken: () => Promise<string | null>, method = "GET", body?: unknown): Promise<T> {
  try {
    const token = await getToken();
    if (!token) throw new LoanError(401);
    const response = await fetch(path, { method, cache: "no-store", headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const envelope: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new LoanError(response.status);
    if (!object(envelope) || envelope.success !== true || !object(envelope.data)) throw new LoanError(503);
    return envelope.data as T;
  } catch (error) { throw error instanceof LoanError ? error : new LoanError(503); }
}
export function loanIntentKey(previous: { signature: string; key: string } | null, signature: string, uuid: () => string) {
  return previous?.signature === signature ? previous : { signature, key: uuid() };
}
