# P6e.2 Forensics & Recovery Safety

All evidence below comes from read-only SELECTs against the verified TEST
branch plus code inspection. No row was modified. PROD is entirely out of
scope; no PROD query was issued.

## 1. Anomaly findings

Two rows in `card_xp_progress`, both `card_id = 'choglings'`:

| player_id (prefix) | xp | level | purchased_level | row updated_at |
| --- | --- | --- | --- | --- |
| `ada9d650` | 0 | 10 | 1 | 2026-10-23 18:23:36 UTC |
| `52c47028` | 0 | 10 | 1 | 2026-10-23 18:27:49 UTC |

Column meanings (`drizzle/0013`, `src/db/schema.ts`): `xp` is lifetime
earned XP; `level` is the XP-derived level that must equal
`cardLevelForXp(xp)`; `purchased_level` is the paid level, advanced only by
the Gold upgrade or sponsorship paths. For `xp = 0` the derived level is 1,
so `level = 10` breaks the invariant the P6e.1 audit checks.

- PROVEN: both owner players exist (`pending` status, NULL username, created
  ~2s before their progress rows) and own exactly one progress row each.
- PROVEN: neither player has any other row anywhere: no `card_xp_awards`,
  no `match_participants`, no `matches` on TEST at all, no Gold earn/spend,
  no `gift_sponsorships`.
- PROVEN: the other 26 progress rows are consistent (14 at xp=1/level=1 from
  real award-path tests, 12 at xp=200/level=10).
- PROVEN: app write paths cannot produce this shape. The award path
  recomputes `level` from the XP ladder inside the apply statement
  (`src/db/card-xp.ts`); upgrades and sponsorships update only
  `purchased_level`. Only direct `insert` calls bypass derivation.
- PROVEN: exactly one call site in the repo writes the
  (choglings, xp=0, level=10, purchased=1) shape:
  `src/db/gold.test.ts` "refuses without XP or Gold", via
  `fund(noXp, 2, 0)`, whose helper hardcodes `level: 10` regardless of `xp`.
- LIKELY: the two orphans leaked from interrupted `gold.test.ts` runs on
  2026-10-23 ~18:23-18:27 UTC (the P6d-documented TEST Neon instability
  window). Cleanup deletes only in-process `createdPlayerIds`/`matchIds`,
  so a timed-out run's rows are never reclaimed; cleanup order (matches and
  earn rows before progress and players) matches orphans that kept progress
  plus players but lost matches and earn rows.
- UNKNOWN: the exact crashed run identity. `card_xp_progress` carries no
  writer, run, or source columns, so per-row attribution beyond the call-site
  shape match is not provable. No inference beyond this is made.

## 2. Root cause verdict (A-G)

- A (fixture initialization): CONFIRMED. Five fixture sites hardcoded
  `level: 10` instead of deriving it; one of them is exercised with `xp = 0`.
- B (incomplete cleanup): CONFIRMED as the leak mechanism. In-process
  id-list cleanup plus a mid-run connection stall leaves orphans no later
  run will delete.
- C (award/reconcile logic): EXONERATED. Awarded rows on TEST are all
  consistent; the apply statement derives level from the ladder.
- D (incorrect derivation): EXONERATED. `cardLevelForXp` is correct;
  nothing in the app miscomputes it.
- E (upgrade/sponsorship integration): EXONERATED. Both move only
  `purchased_level`, gated on stored XP.
- F/G: no other source found; unattributable beyond the UNKNOWN above.

## 3. Preventive fixes applied (test-only, no policy change)

- `fund` (`src/db/gold.test.ts`), `setXp` (`src/db/sponsorships.test.ts`,
  `src/app/api/.../sponsorships/route.test.ts`), `setupRich`
  (`src/app/api/.../upgrade/route.test.ts`), and the direct insert in
  `src/server/battle/card-scaling-room.test.ts` now write
  `level: cardLevelForXp(xp)` instead of the `level: 10` literal. Behavior
  is identical for every existing `xp = 200` call.
- New regression test in `src/db/gold.test.ts` ("seeds stored levels from
  the XP ladder") fails on the old hardcode and passes on the fix.
- The XP/level invariant itself is untouched: no policy loosened to
  accommodate fixtures.

## 4. Safe recovery plan for the two existing rows (NOT executed)

- Source of truth: `CARD_XP_LEVEL_REQUIREMENTS` in `src/lib/card-xp.ts`.
  Corrected state is `(xp=0, level=1, purchased_level=1)`; ledgers are
  unaffected (both players have zero earn/spend rows, so derived Gold
  balances do not move).
- Evidence required before repair: re-confirm both row identities and
  `updated_at` values are unchanged since §1; re-confirm zero related rows
  in awards, participants, earn, spend, and sponsorships; owner approval
  recorded; TEST-only scope acknowledged in writing.
- Dry-run procedure (read-only): `SELECT player_id, xp, level,
  purchased_level` for the two ids, plus a computed
  `cardLevelForXp(xp)` column, and diff by eye. Then, only after approval,
  a single transaction: `BEGIN; UPDATE ... SET level = 1 WHERE player_id
  IN (...) AND xp = 0; SELECT;` followed by `ROLLBACK` first as a rehearsal,
  then the real `COMMIT` in a second explicitly approved step.
- Idempotency: the repair predicate (`xp = 0 AND level <> 1`) is a no-op on
  re-run; record affected-row count (expect exactly 2, then exactly 0).
- Rollback: dump the two rows to a file before the write; restore is
  `SET level = 10` with the recorded values. TEST has no point-in-time
  restore guarantee, so the file dump is the rollback.
- Post-repair: rerun `npm run economy:audit` and expect zero FAIL; rerun
  `src/lib/economy-audit.test.ts`.
- No manual SQL was executed in this slice. Any TEST repair needs separate
  explicit owner approval.

## 5. Reconciler mapping (reuse only, no second worker)

| Situation | Worker | Notes |
| --- | --- | --- |
| Short Gold earn ledger (< 2 rows, eligible) | `reconcileGoldEarn` (`src/db/gold.ts`) | Recomputable from match + participants. Drain the battle outbox first. |
| Missing/NULL ranked awards | `reconcileRankedTrophies` (`src/db/ranked.ts`) | Already-awarded rows are no-ops; floor math needs balance order, never bulk-recompute. |
| Missing/unapplied card-XP runs | `reconcileCardXp` (`src/db/card-xp.ts`) | Evidence-backed; unreadable evidence stays untouched. |
| Missing legacy runs | `LegacyProcessor` reconcile (`src/server/battle/legacy.ts`) | Refused matches stay refused for the process lifetime. |
| Sponsorship receipt/spend conflict | No auto-healer | Shared-fate single statement; a break means bypassed app code. Per-row human plan per §4 pattern. |
| Durable immutable ledger (awards, receipts, spends) | Never recomputed | Conflicting ledger evidence is forensics, not reconciliation input. |
| Private matches, pre-tracking friendships | Never backfilled | Ineligible by policy; absence of rewards is not a gap. |

Provenance precondition (added after live observation, §8): every
reconciler above gates on match_type, verification, and seats, but none
gates on `match_evidence`. Fixture-seeded matches satisfy those gates, so a
naive reconcile run would award real ledger value for fake matches. The
P6e.1 audit now carries a `settlement-evidence` coverage check: only
matches with a `match_evidence` row are reconcile candidates.
Evidence-less matches are reported as residue and must never be awarded.

## 6. Anti-abuse release policy (proposal, thresholds still unapproved)

P6e.1 signals stay review-only. Minimum operator evidence before any P6e.2
enforcement design:

- Repeated ranked opponents: room code or queue ticket proving intent,
  queue depth at the time (small populations repeat naturally), and span
  across days (one session is not farming).
- Win trading: alternating outcomes alone are insufficient; need
  corroborating behavior (forfeits, off-peak scheduling, stake linkage).
- Reward farming: volume relative to population baseline, not absolute
  counts; private rooms earn nothing by construction and prove nothing.
- Reciprocal sponsorships: friendship age and bidirectional history are
  expected between real friends; caps already bound the blast radius
  (1/day recipient, 3/week sender, 1/week pair-card).
- Multi-account suspicion: never from match data alone; needs
  device/payment/wallet linkage evidence, which the audit never collects.

False-positive rule: any signal also produced by friends rematching, small
queues, play sessions, or genuine gifting cannot trigger action alone. No
bans, trophy seizure, Gold confiscation, or silent cancellation follow from
P6e.1 output, and none is designed in P6e.2.

## 7. Rejected-attempt audit event contract (design only, no migration)

P6e.1 confirmed rejected sponsorship attempts are not persisted, so
cap-boundary pressure is NOT CHECKABLE. If a future slice wants it, the
smallest safe contract is an append-only log with exactly:

- `refusalCategory`: one of the existing domain codes (`cap-recipient-day`,
  `cap-sender-week`, `cap-pair-card-week`, `not-eligible`, `insufficient-xp`,
  `insufficient-gold`, `level-mismatch`, `maxed`). No free text.
- `actorId`: sponsor player UUID only.
- `targetRef`: recipient player UUID plus `cardId`. No names.
- `serverTimestamp`: `now()` at decision time. No client clock.
- `capCategory`: the cap checked, or null for non-cap refusals.

Explicitly excluded: message text, wallet addresses, private balances,
raw auth tokens, Privy identifiers, IP addresses. No new table is created
in this slice; any P6e-future log needs its own migration, retention rule,
and approval.

## 8. Slice-run residue observed 2026-10-24 (read-only, no repair)

During this slice, TEST Neon stalled repeatedly (connection timeouts also
documented in P6d). Suite reruns against the flaky branch leaked fixture
rows: 141 `g-`-prefixed matches from `gold.test.ts` seeds (zero
`match_evidence` rows, 18 participants), 71 earn rows, 7 spend rows, 45
progress rows, 56 players. Three players show negative derived Gold:
spends (100, 180, 3200, 100) with zero earn rows. Timestamps
(19:20:45-19:21:01 UTC) match this slice's own rerun window, and the
pattern (earn deleted, spend delete stalled, rest skipped) matches
`cleanFixtures` aborting mid-cleanup during a stall. The two 2026-10-23 XP
orphans from §1 are unchanged and distinct from this residue.

Consequences, all PROVEN above:

- Audit WARNINGs on evidence-less matches (139 XP-pending, 141
  legacy-pending, 8 earn-pending seats, 8 trophy-pending seats) are fixture
  residue, not recovery candidates. Reconciling them would mint Gold, XP,
  and trophies for synthetic matches.
- The 3 negative balances are partial-cleanup artifacts (spends without
  their earn rows), not app overdrafts: no app path spends without a prior
  balance check, and the players are `pending`/NULL-username fixtures.
- No deletes were performed in this slice. TEST now needs an owner-approved
  fixture-cleanup pass (delete by fixture room prefixes and orphan player
  sets, after a dump), which is itself a P6e.2-gated operation, not ad-hoc
  SQL.
