import type { GiftEligibility } from "@/db/gifting";
import type { SponsorshipQuote, SponsorshipReceipt, SponsorshipRequest, SponsorshipResponse, SponsorshipStatus } from "@/db/sponsorships";
import type { FriendPlayer } from "@/db/friendships";

export type { GiftEligibility, SponsorshipQuote, SponsorshipReceipt, SponsorshipRequest, SponsorshipResponse };
export type GiftPeer = FriendPlayer;
export interface GiftHistory { sent: SponsorshipReceipt[]; received: SponsorshipReceipt[] }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const statuses = ["sponsored", "duplicate", "invalid-card", "level-mismatch", "maxed", "insufficient-xp", "insufficient-gold", "not-eligible", "cap-recipient-day", "cap-sender-week", "cap-pair-week", "conflict-retry"];
const integer = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
export function parseGiftEligibility(value: unknown): GiftEligibility {
  if (!object(value) || typeof value.eligible !== "boolean" || !["self", "not-friends", "pending", "unavailable", "no-acceptance-record", "too-new", "eligible"].includes(String(value.reason)) || !(value.nextEligibleAt === null || (typeof value.nextEligibleAt === "string" && Number.isFinite(Date.parse(value.nextEligibleAt))))) throw new GiftError(503);
  return value as unknown as GiftEligibility;
}
export function parseGiftQuote(value: unknown): SponsorshipQuote {
  if (!object(value) || typeof value.eligible !== "boolean" || typeof value.cardId !== "string" || ![...statuses, "eligible", "self", "not-friends", "unavailable"].includes(String(value.reason)) || !(value.nextLevel === null || integer(value.nextLevel)) || !(value.cost === null || integer(value.cost))) throw new GiftError(503);
  if (value.eligible && (value.reason !== "eligible" || !Number.isInteger(value.nextLevel) || Number(value.nextLevel) < 1 || Number(value.nextLevel) >= 10 || !integer(value.cost))) throw new GiftError(503);
  return value as unknown as SponsorshipQuote;
}
export function parseGiftResponse(value: unknown): SponsorshipResponse {
  if (!object(value) || !statuses.includes(String(value.status)) || typeof value.cardId !== "string" || !integer(value.recipientLevel) || !integer(value.sponsorBalance) || !(value.goldCost === null || integer(value.goldCost)) || !(value.receiptId === null || typeof value.receiptId === "string")) throw new GiftError(503);
  return value as unknown as SponsorshipResponse;
}
export function parseGiftHistory(value: unknown): GiftHistory {
  const receipt = (row: unknown): row is SponsorshipReceipt => object(row) && ["id", "sponsorId", "recipientId", "cardId", "createdAt"].every((key) => typeof row[key] === "string") && ["fromLevel", "toLevel", "cost"].every((key) => integer(row[key])) && Number.isFinite(Date.parse(String(row.createdAt)));
  if (!object(value) || !Array.isArray(value.sent) || !Array.isArray(value.received) || !value.sent.every(receipt) || !value.received.every(receipt)) throw new GiftError(503);
  return value as unknown as GiftHistory;
}
export function parseGiftFriends(value: unknown): GiftPeer[] {
  if (!object(value) || !Array.isArray(value.friends)) throw new GiftError(503);
  return value.friends.map((row) => {
    if (!object(row) || row.status !== "accepted" || !object(row.player) || typeof row.player.id !== "string" || !["username", "displayName", "avatarId"].every((key) => row.player && object(row.player) && (row.player[key] === null || typeof row.player[key] === "string"))) throw new GiftError(503);
    return row.player as unknown as GiftPeer;
  });
}
export const giftPeerName = (peer?: GiftPeer) => peer?.displayName?.trim() || peer?.username?.trim() || "Player identity unavailable";
export function giftEligibilityCopy(value: GiftEligibility) {
  if (value.eligible) return "This friendship meets the server's gifting eligibility requirements.";
  if (value.reason === "too-new") return "Gifting unlocks after 30 days of accepted friendship.";
  if (value.reason === "no-acceptance-record") return "This friendship's eligibility can't be verified yet.";
  return "Gifting is unavailable for this player.";
}
export function giftOutcomeCopy(status: SponsorshipStatus | string) {
  const messages: Record<string, string> = {
    sponsored: "Upgrade sponsorship confirmed. The server recorded the Gold spend and card upgrade.",
    duplicate: "This sponsorship was already confirmed. No additional Gold was spent.",
    "invalid-card": "This card is unavailable for sponsorship.",
    "level-mismatch": "The friend's purchased level changed. Refresh the quote before trying again.",
    maxed: "This card is already at its maximum purchased level.",
    "insufficient-xp": "Your friend needs more earned card XP before this upgrade can be sponsored.",
    "insufficient-gold": "You need more earned Gold to sponsor this upgrade.",
    "not-eligible": "This friendship is unavailable for sponsorship.",
    "cap-recipient-day": "Your friend has reached the current daily sponsorship limit.",
    "cap-sender-week": "You've reached the current weekly sponsorship limit.",
    "cap-pair-week": "You've reached the current weekly limit for this friend and card.",
    "conflict-retry": "The request conflicts with another change. Refresh the quote before trying again.",
  };
  return messages[status] ?? "Sponsorship is unavailable for this selection.";
}
export const giftWasConfirmed = (response: SponsorshipResponse) => response.status === "sponsored" || response.status === "duplicate";
export function giftIntent(previous: { signature: string; request: SponsorshipRequest } | null, recipientId: string, cardId: string, expectedLevel: number, uuid: () => string) {
  const signature = JSON.stringify([recipientId, cardId, expectedLevel]);
  return previous?.signature === signature ? previous : { signature, request: { recipientId, cardId, expectedLevel, idempotencyKey: uuid() } };
}
export class GiftError extends Error {
  constructor(public status: number) { super(status === 401 ? "Sign in again to open gifting." : status === 403 ? "This player or action is unavailable." : status === 404 ? "This gift information is unavailable. Refresh to check again." : status === 409 ? "The current state changed. Refresh and review before trying again." : status === 429 ? "Too many requests. Wait a moment before trying again." : status === 400 ? "This request couldn't be accepted. Review your selection." : "Gifting is unavailable right now. Refresh to try again. Your selection is preserved."); }
}
export async function giftRequest<T>(path: string, getToken: () => Promise<string | null>, method = "GET", body?: unknown): Promise<T> {
  try {
    const token = await getToken();
    if (!token) throw new GiftError(401);
    const response = await fetch(path, { method, cache: "no-store", headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const envelope: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new GiftError(response.status);
    if (!object(envelope) || envelope.success !== true || !object(envelope.data)) throw new GiftError(503);
    return envelope.data as T;
  } catch (error) { throw error instanceof GiftError ? error : new GiftError(503); }
}
