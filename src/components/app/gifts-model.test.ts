import { afterEach, describe, expect, it, vi } from "vitest";
import { GiftError, giftEligibilityCopy, giftIntent, giftOutcomeCopy, giftRequest, giftWasConfirmed, parseGiftEligibility, parseGiftFriends, parseGiftHistory, parseGiftQuote, parseGiftResponse } from "./gifts-model";

const response = { status:"sponsored", cardId:"boulderback", recipientLevel:2, goldCost:null, sponsorBalance:120, receiptId:null };
afterEach(() => vi.unstubAllGlobals());
describe("Gold upgrade sponsorship UI contracts", () => {
  it("accepts actual sponsored and duplicate contracts without inventing a receipt or cost", () => {
    expect(giftWasConfirmed(parseGiftResponse(response))).toBe(true);
    expect(giftWasConfirmed(parseGiftResponse({...response,status:"duplicate"}))).toBe(true);
    expect(parseGiftResponse(response)).toMatchObject({goldCost:null,receiptId:null});
  });
  it("keeps domain 200 failures separate from confirmed sponsorships", () => {
    for (const status of ["insufficient-xp","insufficient-gold","not-eligible","level-mismatch","maxed","cap-recipient-day","cap-sender-week","cap-pair-week","conflict-retry"]) {
      expect(giftWasConfirmed(parseGiftResponse({...response,status}))).toBe(false);
      expect(giftOutcomeCopy(status)).not.toContain("confirmed");
    }
  });
  it("uses the quote's current purchased level unchanged as expectedLevel and retains UUID", () => {
    const quote = parseGiftQuote({eligible:true,reason:"eligible",cardId:"boulderback",nextLevel:3,cost:300});
    const uuid=vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second");
    const first=giftIntent(null,"friend",quote.cardId,quote.nextLevel!,uuid);
    expect(first.request).toEqual({recipientId:"friend",cardId:"boulderback",expectedLevel:3,idempotencyKey:"first"});
    expect(giftIntent(first,"friend",quote.cardId,3,uuid)).toBe(first);
    expect(giftIntent(first,"other",quote.cardId,3,uuid).request.idempotencyKey).toBe("second");
  });
  it("uses server friendship eligibility and keeps refusal copy neutral", () => {
    const young=parseGiftEligibility({eligible:false,reason:"too-new",nextEligibleAt:"2026-11-01T00:00:00Z"});
    expect(giftEligibilityCopy(young)).toContain("30 days");
    expect(giftEligibilityCopy({eligible:false,reason:"unavailable",nextEligibleAt:null})).toBe("Gifting is unavailable for this player.");
    expect(()=>parseGiftFriends({friends:[{status:"pending",player:{id:"peer",username:null,displayName:null,avatarId:null}}]})).toThrow(GiftError);
  });
  it("never converts schema errors or malformed history into empty history", async () => {
    expect(()=>parseGiftHistory({sent:[],received:null})).toThrow(GiftError);
    expect(parseGiftHistory({sent:[],received:[]})).toEqual({sent:[],received:[]});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:503})));
    await expect(giftRequest("/gifts",async()=>"token")).rejects.toMatchObject({status:503});
    await expect(giftRequest("/gifts",async()=>null)).rejects.toMatchObject({status:401});
  });
  it("sends exact mutation authority and receives domain failure as data", async () => {
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{...response,status:"insufficient-gold"}}),{status:200}));
    vi.stubGlobal("fetch",fetcher);
    const request={recipientId:"friend",cardId:"boulderback",expectedLevel:1,idempotencyKey:"uuid"};
    const result=parseGiftResponse(await giftRequest("/api/players/me/gifts/sponsorships",async()=>"token","POST",request));
    expect(result.status).toBe("insufficient-gold");
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:"POST",body:JSON.stringify(request),headers:{authorization:"Bearer token"}});
  });
  it("refuses malformed or contradictory quotes", () => {
    expect(()=>parseGiftQuote({eligible:true,reason:"eligible",cardId:"boulderback",nextLevel:null,cost:null})).toThrow(GiftError);
    expect(()=>parseGiftQuote({eligible:true,reason:"insufficient-xp",cardId:"boulderback",nextLevel:2,cost:180})).toThrow(GiftError);
  });
});
