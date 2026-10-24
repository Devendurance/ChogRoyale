# P6b preflight report: STOP before payment implementation

Status: PREFLIGHT FAILED. No migration, payment code, order, entitlement, or test was created in this slice. No chain transaction was sent and no balance was touched. The only chain contact was read-only contract metadata calls.
Baseline: `0507941`. Source of truth: `docs/P6-economy-gifting-contract.md`.

## 1. Confirmed prerequisites

- Repo baseline, TEST migrations through 0021, PROD through 0009. Nothing in this slice changes that.
- Network binding: Monad chain id 143, verified live against the configured public RPC during this slice (chain id call returned 143).
- Candidate $CHOG token `0x350035555E10d9AfAF1566AaebfCeD5BA6C27777`, read-only verified this slice via viem: bytecode present, `decimals` 18, `symbol` CHOG, `name` Chog, `totalSupply` 999999989 x 10^18. No approval, purchase, or transfer was made.
- Existing reusable systems confirmed present: Privy-verified linked wallets (`src/db/players.ts`), viem Monad client (`src/lib/chain.ts`, read-only `readOwner`/`readTokenUri`), idempotent ledger patterns (gold spend ledger, loan idempotency keys, message idempotency), authenticated route conventions, safe TEST migration runner (`scripts/migrate-test-run.ts`).
- P6a contract sections 5 and 9 remain the exact build specification once unblocked. Nothing in this slice supersedes them.

## 2. Preflight result: 5 of 9 dependencies missing

| Dependency | Status |
|---|---|
| B4.6 payment authorization | ABSENT. Roadmap B4.6 is NOT AUTHORIZED: no payments, custody, pricing, or token flows without owner decision plus legal and compliance review. |
| Legal/compliance review | ABSENT. No record in docs or `.fast-build`. |
| Candidate $CHOG contract | PROVIDED for verification only. On-chain metadata read this slice (section 1). Not an authorization to accept it as payment. |
| Verified merchant recipient | ABSENT. No address exists anywhere in the repo or docs. Nothing was invented. |
| Token decimals | READ ON-CHAIN: 18. Usable only once the contract itself is approved. |
| First approved catalog SKU and price | ABSENT. No item, amount, or currency row approved. |
| Chain policy | CONFIRMED: 143. Finality threshold (required confirmations) ABSENT. |

Stop conditions triggered: no B4.6 authorization, no legal review, no merchant recipient, no SKU or price, no finality policy. Per the slice brief, database migration 0022 was not drafted and no payment code was written.

## 3. Additional verification flag: possible proxy contract

The candidate token carries 45 bytes of runtime code. That length is consistent with a minimal proxy rather than a full ERC-20 implementation. Before this address is approved for payments, the owner must confirm the implementation address, its code, upgrade authority, and initialization state. A proxy whose implementation can change alters the trust assumption of every quoted price. This joins the section 2 list, it does not replace any item.

## 4. What was deliberately not built

Catalog and order contracts, receipt verification, payment-to-order binding, fulfillment and recovery writes, schema and migration 0022, purchase tests, and entitlement reads. All are specified in P6a sections 5 and 9 and remain unimplemented until every section 2 row is signed. No test suite was run because no code changed; running the full suite to prove a no-op would have cost a TEST-branch load cycle for zero signal.

## 5. Remaining operational blockers, in unlock order

1. Owner records the B4.6 decision and completes legal and compliance review.
2. Owner confirms or rejects the candidate token, including the section 3 proxy question, and approves decimals handling.
3. Owner supplies the merchant recipient address through a trusted channel, never via client input.
4. Owner approves the first catalog SKU, fixed price, and finality threshold.
5. Only then: P6b implementation exactly per P6a section 9, additive migration 0022 via the safe TEST runner, receipt fixtures labelled as fixtures, read-only live checks, and zero PROD writes.

## 6. Exact P6c frontend contract (unchanged by this slice)

P6c builds player-facing presentation on top of the P6b backend, and only after that backend exists and is approved:

- Read-only purchase and entitlement history inside the existing account surfaces, following the empty versus unavailable rule: a failed read never renders as zero purchases.
- Sponsorship action UI in the decks and collection flow reusing the existing upgrade components and the 30-day eligibility read. Server confirmation precedes every success state; retries reuse one idempotency key.
- Store offer display reusing the server-owned catalog read. No price, recipient, or order math in the client.
- Cosmetic rendering, if the first SKU needs new presentation, is a separate UI slice after P6c and must be explicitly scoped then. No combat or progression component is touched: entitlements never enter the combat hash domain.
- Acceptance: unauthenticated fixture renders the honest unavailable state at 390x844 and 1366x768 with no overflow or console errors; every success, conflict, and failure state from the P6b API has a matching UI state; live authenticated acceptance stays owner-gated.

## 7. Local checkpoint

Report and state only. Commit SHA recorded in `agent-state/left-off.md`. No push, no deployment, no PROD contact.
