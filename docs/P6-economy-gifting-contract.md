# P6a: Economy and Card-Gifting Design Contract

Status: DESIGN ONLY. No purchases, mints, transfers, balance changes, migrations, or deployments were made for this slice.
Baseline: `eaad019` (P5f.2 complete). TEST migrations through 0021. PROD migrations through 0009.
Roadmap gate: B4.6 Economy is NOT AUTHORIZED. Every P6 build slice below executes only after explicit owner authorization plus legal/compliance review.

All recommendations are proposals. Nothing here is an owner decision until the owner signs the open-decision list in section 8.

## 1. Existing economy truth table

| Item | State | Evidence |
|---|---|---|
| 20 ordinary cards, globally playable | IMPLEMENTED | `CARDS_V1` in `src/lib/combat.ts`. No unlock, lock, or scarcity. Every account can field every card. |
| Card XP from verified deployments | IMPLEMENTED | `src/lib/card-xp.ts`, `src/db/card-xp.ts`, migration 0013. 1 XP per accepted deploy, caps 5 per card per match and 20 per player per match, cumulative thresholds `[0,5,12,22,35,52,72,96,124,155]`. Private rooms earn nothing. |
| Purchased levels 1-10 via Gold | IMPLEMENTED | `src/db/gold.ts`, migration 0014. Upgrade costs L2-L10 `100/180/300/480/750/1100/1600/2300/3200`. Single-level moves, idempotency keys, expected-level guard, derived balances. |
| Gold earn policy | IMPLEMENTED (TEST numbers) | `src/lib/gold.ts`: win 60, loss 30, draw 40 on matchmaking/ranked; private 0. Off-chain only. File header states no blockchain token, no $CHOG, no real-money purchases. |
| Ranked trophies | IMPLEMENTED (provisional S1) | `src/db/ranked.ts`, migration 0012: win +25, loss -20 floored at 0, draw 0. Independent of XP and Gold. |
| $CHOG token | PROPOSED ONLY | Zero references in `src`. No contract constant, no ERC-20 read, no payment code. PRD section 10 names `0x350035555E10d9AfAF1566AaebfCeD5BA6C27777` on Monad as published on the official Chog site, with an explicit verify-before-rollout instruction. UNVERIFIED in this repo. |
| Store, orders, receipts | PROPOSED ONLY | TRD plans `store_offers`/`orders`/`payment_receipts`. None exist in `src/db/schema.ts` or any migration. No store UI, no pricing, no merchant address. |
| Chain surface | READ-ONLY | `src/lib/nft-contract.ts` exposes `readOwner` and `readTokenUri` only. No `writeContract`, no transfers, no ERC-20 calls. |
| Wallets | VERIFIED-LINK ONLY | Privy-verified wallets via `src/db/players.ts` list/sync. TRD requires user-signed direct payment, no custodial hot wallet. |
| 30-day gift eligibility | IMPLEMENTED (read-only) | `src/db/gifting.ts`, migration 0020 (`friendships.accepted_at`), `GET /api/players/me/gifts/eligibility`. No transfer exists. P5e.1 proved no transferable card inventory exists. |
| NFT lending | IMPLEMENTED (game-scoped) | `src/db/lending.ts`, migration 0021, loan routes, borrowed-basis entitlement re-verified at ready and match-start lock. No custody transfer. |
| Card gifting transfers | MISSING | P5e.2 never started. No inventory ledger, no debit/credit path, no caps. |
| Refunds, reconciliation ops, admin void tools | MISSING | Required by PRD section 10 and TRD PAY-03/MOD-01. Nothing built. |

## 2. Recommended $CHOG purchase catalog

Price authority for every item is a server-owned catalog row (price, currency, recipient, decimals, version). The client never names a price or recipient. All items are fixed-price, clearly disclosed, non-random, with no investment language and no age-targeted pressure.

### Item 1: Cosmetic profile frame (first purchasable)

- Player receives a named cosmetic entitlement bound to the account. Usable in profile display only. Zero combat, XP, Gold, trophy, or matchmaking effect.
- Source of value is authorship, not scarcity: the server issues the entitlement row after verifying payment. No asset is minted.
- Delivery is an idempotent insert into a cosmetic-entitlement ledger keyed by order id. Ownership means a server row, revocable only by refund or moderation action.
- Verification is full on-chain receipt verification (section 5). Price comes from the catalog snapshot pinned to the order.
- Refund voids the entitlement row and records the reason. Failure before verification issues nothing.
- Fairness impact is nil by construction: cosmetics never enter the combat hash domain.

### Item 2: Additional deck slots

- Player receives extra saved-loadout slots beyond the current single slot. Convenience only: every slot still validates through the existing loadout rules and match-start entitlement.
- Source is server capacity, not gameplay power. Delivery is a counter on the account set by fulfilled order.
- Same verification, refund (slot removal never deletes the primary slot or saved decks), and fairness reasoning as Item 1.

### Item 3: $CHOG-funded upgrade sponsorship (gift product)

- The buyer pays $CHOG; the recipient's chosen card advances exactly one purchased level. The recipient must already satisfy the real XP requirement for that level from their own earned deployments.
- No Gold moves between accounts and no XP is created or transferred. The $CHOG leg replaces the Gold-cost leg of the existing upgrade path.
- Delivery reuses the P2b upgrade writer with a distinct source marker. Same verification and refund rules (refund voids the sponsored level only if no subsequent legitimate upgrade built on it; otherwise refund is denied and flagged for operator review).
- Fairness: the recipient could have earned the same level through play. This is acceleration, never exclusive power. Ranked stays untouched.

### Explicitly excluded

No ranked trophies, battle wins, XP grants, Gold purchases, loot boxes, paid stat or energy boosts, or ownership multipliers. PRD section 10 and TRD PAY-02 forbid each of these, and this contract keeps the ban.

## 3. Recommended card-gifting model: B (upgrade sponsorship)

### Why A fails

Model A (transferable earned card copies) has nothing to transfer. All 20 cards are globally playable with no unlocks, so a received copy grants zero new capability. Defining copies would require inventing an issuance source, which means arbitrary minting with no redemption utility. Deployment-farmed copies would follow immediately: play matches, mint copies, feed a main account. High dev cost (new inventory, issuance rules, deck integration), high farm risk, zero recipient benefit. Reject.

### Why C waits

Model C (collectible card cosmetics) is clean on fairness but the cosmetic entitlement system does not exist. Building it just for gifting inverts the dependency: cosmetics should first exist as $CHOG purchases (Item 1), and gifting of owned cosmetics can follow as a small extension. Defer, do not build for P6.

### Why B fits

Model B (Gold-funded upgrade sponsorship between friends) reuses everything real: the P2b upgrade writer, the Gold ledgers, the 30-day eligibility check, block and friendship guards. The sponsor spends their own legitimately earned Gold; the server debits the sponsor ledger and advances the recipient's purchased level by exactly one. The recipient must independently satisfy the XP requirement. No Gold is transferred, no XP moves, no inventory is invented, purchased levels are never granted without earned XP.

- Real player value: converts a veteran's surplus Gold into a friend's progression.
- Deck compatibility: purchased levels already flow into combat through card scaling.
- Economy balance: Gold costs stay the sink; sponsorship adds demand without printing supply.
- Abuse surface: bounded by the 30-day rule, per-day and per-card caps, single-level moves, and full ledger audit (section 6).
- Cost: one ledger-aware write path plus caps. Smallest sound slice.

### PRD wording note

PRD section 10 describes gifting **duplicates** through an atomic inventory ledger. That language predates the P5e.1 finding that no copies exist. Adopting Model B means either rewording that passage to sponsorship semantics or defining duplicates formally. Flagged as open decision 8.5.

## 4. Reward issuance and asset semantics

- Off-chain Gold authority is the server ledger pair (`gold_earn_ledger`, `gold_spend_ledger`). Balances are derived, never stored. Gold is earned only by settled matchmaking/ranked results and spent only by the upgrade writer and, after P6c, the sponsorship writer. Gold is never purchasable with $CHOG or anything else.
- On-chain $CHOG authority is the chain receipt, verified per section 5. A wallet transaction hash alone never authorizes issuance.
- Content authority is the server item catalog with versioned price snapshots pinned to each order.
- Every issuance is exactly-once per order id, recorded in a fulfillment ledger with status history. No secret admin mint path exists in the client; operator tooling is server-side, reviewed, and reason-coded.

## 5. Payment and receipt architecture (for P6b)

Order lifecycle: `quote` (server prices and pins catalog version, recipient, amount, decimals, expiry) to `submitted` (client supplies chain tx hash bound to the order id) to `verifying` to `fulfilled` or `failed`, with `refunded` as a terminal branch carrying a reason. Pending orders expire; expired quotes are never fulfilled.

Verification of each receipt checks chain id 143, token contract equals the verified $CHOG address, recipient equals the server merchant address, amount and decimals equal the pinned quote, `status` is success, and confirmations meet the finality threshold. The fulfillment insert is guarded by a unique constraint on (chain, tx hash, log index), so replays, reorgs, and duplicate submissions collapse to one row. A reconcile job re-checks pending orders against the chain and expires or fulfills them; it never invents payment.

Failure rules: failed or reverted payment issues nothing. Underpayment issues nothing and the order stays payable until expiry. Overpayment fulfills the quoted item and logs the surplus for operator review; it never auto-credits. Refund after delivery voids the entitlement first; if the entitlement was consumed or built upon, refund is denied and flagged.

## 6. Anti-abuse minimum release requirements

- Farming: private rooms already earn zero Gold and zero XP. Keep it that way. Sponsorship requires the 30-day eligibility plus daily per-pair and per-card caps and a per-recipient weekly cap (values are balance parameters for the owner, defaults proposed in P6c).
- Gift loops: single-level moves only, no Gold transfer primitive, no resale, no cash-out. Circular A-to-B-to-A sponsorship is visible in the ledger and rate-limited by caps.
- Multi-account: the 30-day friendship plus real-match earnings make alt-pipelines slow and auditable. Flag accounts whose earn/upgrade graph is star-shaped around one recipient for review.
- Double redemption: idempotency keys on every write (already the convention in upgrades, loans, and messages); unique fulfillment constraint on chain identity.
- Payment replay: unique (chain, tx, log index) constraint plus quote binding.
- Loan and entitlement overlap: lending already freezes direct use during active loans; sponsorship never touches commander entitlement, Patron selection, or Paragon.
- Refund abuse: refund voids delivery first; consumed-delivery refunds need operator approval.
- Audit minimum: every sponsorship, purchase, fulfillment, refund, and void writes an actor, reason code, and timestamp. No silent admin path.

## 7. Prioritized implementation slices

### P6b: verified $CHOG purchase lifecycle (first cosmetic)

- Reuses Privy wallets, item catalog pattern from loadout validation, idempotency conventions, receipt verification via viem reads.
- New: `store_offers` (versioned catalog), `purchase_orders` (quote, binding, status), `payment_receipts` (chain identity, verification snapshot), cosmetic-entitlement ledger; `GET /store/offers`, `POST /orders`, `POST /orders/[id]/submit`, reconcile job; one cosmetic item end to end.
- Policy dependency: owner approves the item, price, merchant address, decimals, and finality threshold.
- Acceptance: expired quote never fulfills, replayed tx fulfills once, wrong recipient or amount fails, refund voids the cosmetic, no combat or progression file changes.
- Security: client supplies no price or recipient; verification is server-side; secrets stay in the deployment secret manager.
- PROD: needs approved migrations plus the B5.1 migration review and B5.3 settlement-grade controls. No PROD writes in the slice itself.

### P6c: Gold-funded upgrade sponsorship (Model B)

- Reuses `canGiftToFriend`, P2b upgrade writer, Gold ledgers, block and friendship guards.
- New: sponsorship write path (debit sponsor, advance recipient one level, XP requirement enforced), per-day/per-card/per-week caps, ledger reason codes.
- Acceptance: sponsor without balance fails, recipient without XP fails, cap breach fails, double submit credits once, full audit trail.

### P6d: $CHOG-funded sponsorship (Item 3)

- Reuses P6b verification and P6c delivery. New: $CHOG quote bound to a sponsorship intent.
- Acceptance: same as P6c plus payment failure issues nothing.

### P6e: caps administration and reconciliation ops

- Reuses existing route conventions. New: read-only audit views, cap configuration with versioning, reconcile runner wiring, refund/void tooling with reason codes.

### P6f: cosmetic gifting extension (Model C, optional)

- Reuses cosmetic entitlements from P6b and friendship eligibility. Only after P6b is live.

### P6g: PROD economy activation

- Depends on B5.1 migration review, B5.3 controls, owner sign-off on every catalog row, and a live-fire purchase on TEST with a real wallet.

## 8. Open decisions requiring owner approval

1. Authorize or decline all P6 building (B4.6 gate), plus legal and compliance review.
2. Verify the $CHOG contract address, decimals, ERC-20 interface, and liquidity; approve the merchant recipient address and finality threshold.
3. Approve the catalog: first cosmetic, deck-slot pricing, and Item 3 sponsorship pricing.
4. Resolve the PRD acceptance-test 6 discrepancy: the PRD gates lending behind 30-day friendship plus 30 eligible battles each, but shipped P5f requires neither. Add the gates, amend the PRD, or record an exception.
5. Reword or formally define PRD gifting duplicates versus adopted Model B sponsorship.
6. Set cap and threshold numbers (gift caps, season parameters, store prices), which the PRD explicitly leaves as balance parameters.
7. Approve PROD migration and activation sequencing through the B5 gates.

## 9. Exact P6b implementation contract

Scope is one purchasable (cosmetic profile frame) through the full lifecycle on TEST only. Files: one catalog lib, one purchase DAL, three order routes plus one offer read route, one reconcile script, focused DAL and route tests, one additive migration drafted as 0022 and applied to TEST only with the safe runner. Schema sketch: `store_offers` (id, code unique, name, price amount, currency `CHOG`, chain, recipient, decimals, catalog version, active flag), `purchase_orders` (id, buyer, offer snapshot JSON, amount, recipient, status, expires_at, idempotency key unique), `payment_receipts` (chain, tx hash, log index unique triple, verification snapshot JSON, order FK unique, status). Rules: server pins every quote; client-supplied amounts are ignored; fulfillment inserts under the unique chain-identity constraint inside the authoritative write; reconcile only transitions pending orders. Tests: quote pinning, wrong-recipient rejection, underpayment refusal, replay collapse, expiry, refund voids entitlement, no progression-files touched. Acceptance is the lifecycle demo on TEST with a real wallet transaction against the verified contract, witnessed receipts, and zero PROD writes. P6b starts only after decisions 8.1 through 8.3 are signed.
