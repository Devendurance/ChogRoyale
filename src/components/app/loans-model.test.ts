import { describe, expect, it, vi, afterEach } from "vitest";
import { availableToLend, LoanError, loanIntentKey, loanRequest, parseLoanCommanders, parseLoanLists, validLoanDuration, type CommanderLoan } from "./loans-model";

const loan: CommanderLoan = { id:"loan", chainId:143, contract:"contract", tokenId:"42", ownerId:"owner", borrowerId:"borrower", status:"active", startsAt:"2026-10-24T00:00:00Z", endsAt:"2026-10-25T00:00:00Z", terminatedAt:null, terminationReason:null, createdAt:"2026-10-24T00:00:00Z", updatedAt:"2026-10-24T00:00:00Z" };
afterEach(() => vi.unstubAllGlobals());
describe("commander lending presentation contracts", () => {
  it("rejects malformed server lists instead of manufacturing an empty inventory", () => {
    expect(() => parseLoanLists({ lent:[], borrowed:null })).toThrow(LoanError);
    expect(parseLoanLists({ lent:[loan], borrowed:[] }).lent).toEqual([loan]);
  });
  it("keeps borrowed entries out of owned lend choices and requires server eligibility", () => {
    const entries = parseLoanCommanders({ nftCommanders:[{ tokenId:"42", name:"Chog", status:"derived", eligible:true, imageUrl:"https://example.com/42.png" }, { tokenId:"43", status:"derived", eligible:true, basis:"borrowed" }] });
    expect(entries).toHaveLength(2);
    expect(availableToLend(entries[0], [loan])).toBe(false);
    expect(entries[1]?.ownership).toBe("borrowed");
    expect(availableToLend(entries[1]!, [])).toBe(false);
    expect(availableToLend({ ...entries[0], eligible:false }, [])).toBe(false);
    expect(availableToLend(entries[0], [{ ...loan, status:"returned" }])).toBe(true);
  });
  it("limits duration and preserves a UUID for uncertain retries of one intended loan", () => {
    expect([0,8,1.5,NaN].every((value) => !validLoanDuration(value))).toBe(true);
    expect([1,7].every(validLoanDuration)).toBe(true);
    const uuid = vi.fn().mockReturnValueOnce("key-a").mockReturnValueOnce("key-b");
    const intent = loanIntentKey(null,"42:friend:1",uuid);
    expect(loanIntentKey(intent,"42:friend:1",uuid)).toBe(intent);
    expect(loanIntentKey(intent,"42:friend:2",uuid).key).toBe("key-b");
    expect(uuid).toHaveBeenCalledTimes(2);
  });
  it("sends exact authenticated mutation body and does not accept a rejection as success", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({success:false,error:{code:"CONFLICT"}}),{status:409}));
    vi.stubGlobal("fetch",fetcher);
    await expect(loanRequest("/api/players/me/loans",async()=>"token","POST",{tokenId:"42",borrowerId:"friend",durationDays:1,idempotencyKey:"key"})).rejects.toMatchObject({status:409});
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:"POST",headers:{authorization:"Bearer token"},body:JSON.stringify({tokenId:"42",borrowerId:"friend",durationDays:1,idempotencyKey:"key"})});
  });
  it("keeps schema errors unavailable and fails closed without authentication", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:503})));
    await expect(loanRequest("/loans",async()=>"token")).rejects.toMatchObject({status:503});
    await expect(loanRequest("/loans",async()=>null)).rejects.toMatchObject({status:401});
  });
});
