# P6e.2 Enforcement / Recovery Prerequisites (from the P6e.1 read-only audit)

P6e.1 built no enforcement and no recovery. Nothing below is approved to run.
Each item names the source of truth, the existing healer, and what P6e.2 must
prove before touching anything.

## 1. Pending award reconciliation (WARNING-class)

| Gap | Source of truth | Existing healer | Replay needed | Idempotent | Missing safeguard |
| --- | --- | --- | --- | --- | --- |
| Gold earn rows short of 2 per eligible match | `matches` + `match_participants` (settled, replay-verified) | `reconcileGoldEarn(limit, award)` in `src/db/gold.ts` | Yes: award computes amounts from verified seats | Yes: ledger PK `(match_id, player_id)` | Healer needs a real award callback; audit never supplies one |
| Ranked trophies missing or `balance_after NULL` | Same, `match_type = 'ranked'` | `reconcileRankedTrophies(limit)` in `src/db/ranked.ts` | No: delta derives from stored result, floor applied in-statement | Yes: only `NULL` rows move; awarded rows are no-ops | Must confirm the battle outbox is drained first so a pending file does not double-apply after a sweep |
| Card-XP runs missing or `applied = false` | Same, matchmaking/ranked | `reconcileCardXp(limit, award)` in `src/db/card-xp.ts` | Yes: usage comes from stored evidence; unreadable evidence stays untouched | Yes: stage/apply split with run markers | Evidence read path must be the same `match_evidence` rows settlement verified, never a recompute |
| Legacy runs missing | Same, verified settled | `LegacyProcessor` reconcile in `src/server/battle/legacy.ts` | Yes: full re-verification per match | Yes: `match_legacy_runs` marker; refused stays refused for the process lifetime | Needs the `match_legacy_runs` table on the target branch plus a runbook for poison (refused) matches |

P6e.2 prerequisite: run each healer on TEST with a bounded limit, then re-run
`npm run economy:audit` and show every WARNING cleared with no new FAIL.

## 2. FAIL-class ledger violations

| Finding | Source of truth | Recovery rule |
| --- | --- | --- |
| Negative derived Gold | Earn/spend ledgers; balances are derived, never stored | Forensics first: find the writer that debited without credit. Never insert compensating rows. |
| Receipt without matching spend (same key, cost, card) | `gift_sponsorships` + `gold_spend_ledger` share fate in one statement | A genuine break means the shared-fate statement was bypassed. Hand-repair needs owner sign-off per row, recorded outside the ledger. |
| Orphaned sponsorship debit | Same pair | Same as above. Note: true orphans need a sponsorship marker on spend rows; that schema change is itself a P6e.2-gated migration. |
| Duplicate idempotency keys | Unique constraint (should be impossible) | Constraint violation means manual DB surgery happened. Audit the access log before any repair. |
| XP/level or purchased-level invariant break | `CARD_XP_LEVEL_REQUIREMENTS` + `goldCostForLevel` in `src/lib/card-xp.ts` | `level` must equal `cardLevelForXp(xp)`; `purchasedLevel` needs XP backing. Observed TEST case (xp=0/level=10) matches direct test-fixture writes, not app flow. P6e.2 must prove writer identity (app vs fixture) before repair. |
| Ranked delta/balance violations | `rankedDeltaFor` + floor-at-zero in `src/db/ranked.ts` | Win always +25, draw 0, loss in [-20, 0]; counters must sum. Clamp math needs balance ordering, so row-by-row forensics, not bulk recompute. |

P6e.2 prerequisite: a written per-row recovery plan with the authoritative
value, the writer at fault, and a verification query, approved before any
write. No second settlement/award worker: reuse the healers above.

## 3. Suspect patterns (review-only, never auto-enforced)

Thresholds in `AUDIT_THRESHOLDS` are provisional and NOT APPROVED FOR
ENFORCEMENT. P6e.2 enforcement design needs, at minimum: room-code context
(friends rematch), queue-depth context (small populations repeat), session
context (clusters are ordinary play), and a human review queue. No bans,
confiscation, reversal, or invalidation may follow from P6e.1 output.

Cap-boundary pressure is NOT CHECKABLE: rejected gift attempts are not
recorded, only receipts. Any P6e.2 attempt-rate analysis first needs an
attempts log (new table, new migration, new approval). Do not infer pressure
from receipts at caps.

## 4. Operational prerequisites for any P6e.2 run

- TEST-only until the owner approves otherwise. No PROD writes, no PROD
  migrations, no deployment, no push.
- `requireTestDatabaseUrl` gate stays in every operator entrypoint.
- Bounded limits on every healer; re-audit after each run.
- Battle outbox (`.battle-replays/`) drained before award reconciliation.
- `--json` output must stay parseable and secret-free (see
  `src/lib/economy-audit.test.ts`: no connection strings, wallets, Privy
  ids, or seeds in either rendering).
