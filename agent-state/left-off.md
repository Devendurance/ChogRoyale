## LAUNCH DAY: BLOCKED on endy-vps SSH key, aws-hermes still live (state committed locally)

- `ssh endy-vps` STILL denied after owner added old pubkey. Root cause is client-side: ~/.ssh/id_ed25519 is passphrase-encrypted and BatchMode cannot unlock it (server log sequence proves it: key accepted, then signature never produced). Fix: generated passphrase-less ~/.ssh/id_chogdeploy; owner must authorize the NEW pubkey (below). Old key untouched.
- NEW PUBKEY TO AUTHORIZE: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINzoJKMxSYP+9SmNCELTe2RhN0oXvtGOy0YjK8AX/j3B chog-royale-deploy

- `ssh endy-vps` (and ubuntu@38.49.217.165) rejected for this machine's key (ED25519 SHA256:7xIzlAp...). Owner must append the client pubkey (in docs/endy-vps-cutover.md §0) or grant access another way. Nothing deployed to endy-vps yet; no guessing, no other-host changes.
- aws-hermes battle verified healthy (single clean start, NRestarts=0, gates correct) and remains the live endpoint until cutover.
- Cutover runbook ready: docs/endy-vps-cutover.md (inspect, transfer 65e19e4, pre-settlement health, proxy, DNS-or-nip.io, controlled cutover, rollback). Vercel env + smoke still owner-gated as before.

## LAUNCH DAY: battle server LIVE, frontend/smoke owner-gated (no push pending except state)

- Battle server PUBLIC: https://63-183-2-78.nip.io (WSS same host). VPS aws-hermes 63.183.2.78: Caddy auto-HTTPS + reverse proxy, systemd `chog-royale-battle` (enabled, restart-on-failure), code @65e19e4, settlement ON, legacy OFF, scaling OFF, ranked closed. /healthz verified locally and from outside.
- Vercel prerender fix pushed (65e19e4): dev /battle|onboarding|progress render honestly without Privy app ID; build passes with empty env.
- OWNER ACTIONS LEFT: (1) set Vercel prod env (NEXT_PUBLIC_PRIVY_APP_ID + PRIVY_APP_SECRET + DATABASE_URL/POOLED + NEXT_PUBLIC_BATTLE_SERVER_URL=https://63-183-2-78.nip.io) and confirm deploy green; (2) two-login private-match smoke; (3) optional DNS battle.chogroyale.xyz -> 63.183.2.78 to replace nip.io.

## LAUNCH DAY (owner directive, in progress)

- Vercel ERESOLVE fixed: `@types/node` 20 -> ^24.19.2 (package.json + lock together), lock-only resolve exit 0, typecheck + production build green, committed 60bf4f6 and pushed to origin main (was 2bce8e5). Vercel auto-build expected.
- PROD migrations 0010-0022 APPLIED to br-snowy-star-b5ftxkro after snapshot br-red-feather-b5xc380x. Verified: 9 players intact, journal through 0022, all tables present. No destructive ops (all additive; 0019 drops a just-added FK).
- npm on this Windows box is unusable for full installs (AV/file locks, orphan tsx from a prior session was holding node_modules; killed _diag-battle.ts + next dev). Toolchain repaired surgically (next package); tsc/vitest/tsx/drizzle-kit all work.
- BLOCKED on owner: (1) battle host target + access, (2) NEXT_PUBLIC_BATTLE_SERVER_URL in Vercel + deploy check, (3) two-player smoke (needs real Privy logins). No deploy, no host, no smoke done yet. Do not start P7b.

## P7a production-safe multiplayer host (complete, local commit pending, no push, no deploy)

- Fail-closed bootstrap: `resolveBattleHostConfig` (pure, tested) replaces the dev-only production refusal. Prod without `BATTLE_HOSTING_ENABLED=1` refuses; strict mode requires host/port/wss-URL/origins. Dev defaults untouched.
- Server: `/healthz` liveness on the transport express app, `installShutdownHooks`/`drainBattleServer` (sweeper stop + graceful drain, 15s cap). Windows termination bypasses handlers (verified); drain logic unit-tested.
- Local acceptance: refusal exits 1; prod-like boot serves `/healthz`; ranked stays closed; settlement/gold/XP/trophies disabled without tables. Auth/queue/modeseat guarantees verified unchanged. Runbook in `docs/P7a-hosting.md` with the exact deployment prerequisites. Do not start P7b.

## P6e.2 economy forensics and recovery safety (complete, local commit pending, no push)

- Root cause PROVEN: 5 fixture helpers hardcoded `level: 10`; `gold.test.ts fund(noXp, 2, 0)` wrote the exact (choglings, xp=0/level=10) orphan shape. Award/reconcile/derivation/upgrade paths exonerated. All fixed to `cardLevelForXp(xp)` plus a regression test.
- Cleanup gap PROVEN: in-process id-list cleanup plus TEST stalls orphan rows; today's slice runs also leaked 141 fixture matches and 3 negative-balance players (spends without earns from stalled cleanup). No deletes performed.
- Safety added: audit `settlement-evidence` coverage splits reconcile candidates (evidence-backed) from fixture residue (never award); reconcilers gate on type/verification/seats but not evidence, so the guard matters. Plan, reconciler map, anti-abuse prerequisites, and rejected-attempt contract in `docs/P6e-forensics-recovery.md`.
- Verification: pure audit tests 11/11, typecheck/lint/build green. DB suites INCONCLUSIVE (transient TEST Neon stalls; zero assertion failures, regression test passed when reachable). Do not start P7.

## P6e.1 economy integrity and abuse audit (complete, local commit pending, no push)

- Read-only operator audit: `src/lib/economy-audit.ts` (pure checks) + `scripts/economy-audit.ts` (`npm run economy:audit [-- --json] [--limit N]`). SELECT-only, TEST-guarded via `requireTestDatabaseUrl`, missing tables become NOT_CHECKABLE, no secrets in either rendering.
- Live TEST run: matches/gold/ranked/sponsorship tables empty, no suspect patterns; real FAIL on 2 `card_xp_progress` rows (xp=0/level=10, choglings) that match direct test-fixture writes, not app flow. No recovery attempted.
- Reconciliation plan in `docs/P6e.2-requirements.md`. P6e.1 enforcement thresholds are provisional and NOT APPROVED FOR ENFORCEMENT. Do not start P6e.2.
- Verification: audit tests 10/10, P6c route suite 3/3 on TEST, typecheck/lint/build green. Scoped files only; `.fast-build/STATE.md`, `DESIGN.md`, `docs/Chog Royale messaging.md` untouched.

## P6d card gifting and upgrade sponsorship UI (complete, local commit)

- Added `/app/gifts` with server-backed accepted-friend eligibility, 20-card catalog selection, quote and Gold reads, confirmation, UUID-safe sponsorship retries, domain-status messaging and sent/received history. Friends and Profile link to gifting.
- Focused gifts model tests 7/7, typecheck, scoped ESLint and production build pass. P6c route tests reached 13/14 before a TEST Neon connection timeout. Browser fixtures at 390x844 and 1366x768 show the honest Privy loading gate with no console errors or overflow. No live gifting or PROD claim.
- Scoped checkpoint committed locally. No push or deployment.

## P6c Gold card-upgrade sponsorship, complete (local commit, no push)

- Server-authoritative Model B sponsorship: `gift_sponsorships` receipt table (migration 0022, TEST only), single-statement atomic mutation in `src/db/sponsorships.ts` (advisory locks, idempotency, re-checked eligibility/XP/balance/caps), write/read/quote routes under `/api/players/me/gifts/sponsorships`. Sponsor Gold debits from the existing spend ledger; recipient advances one purchased level with earned XP, untouched XP. TEST caps 1/day, 3/week, 1 pair-card/week. No UI, no $CHOG, no PROD writes.

## P6b $CHOG purchase lifecycle: PREFLIGHT FAILED, stopped before implementation (local commit, no push)

- Mandatory preflight found 5 of 9 dependencies missing: no B4.6 authorization, no legal review, no merchant recipient, no SKU/price, no finality threshold. No migration 0022, no payment code, no orders, no entitlements, no tests. Only chain contact was read-only viem metadata on the candidate token (143, bytecode present, 18 decimals, CHOG, 1B supply) plus a proxy-shape flag. Evidence in `docs/P6b-preflight-report.md`. Nothing to implement until the owner unblocks in the listed order.

## P6a economy and card-gifting design contract, complete (local commit, no push)

- Wrote `docs/P6-economy-gifting-contract.md`: truth table, $CHOG catalog (cosmetic, deck slots, $CHOG sponsorship), Model B gift recommendation, payment/receipt architecture, anti-abuse minimums, slices P6b-P6g, 7 owner decisions, exact P6b contract. Design only: no code, migrations, purchases, mints, or PROD writes.

## P5f.2 NFT commander lending UI (complete, local commit)

- Added `/app/loans` with server-backed lend, borrowed, active/history, revoke and return views. Creation uses accepted friends, 1-7 day validation, one UUID idempotency key per intended submission, retry retention, visibility refresh and confirmation dialogs.
- Extended the existing authenticated commander read with server-owned loan basis metadata. Deck selection labels OWNED, BORROWED and LENT, blocks lent/expired/unavailable choices, and persists the existing NFT claim shape unchanged.
- Focused model tests 38/38, typecheck, scoped lint and production build pass. Fixture browser QA shows truthful schema/service-unavailable state at 390x844 and 1366x768, with no horizontal overflow and no console errors. No live NFT or production-schema acceptance claim.
- Scoped checkpoint committed locally. No push or deployment.

## P5f.1 secure NFT commander lending backend, complete (local commit, no push)

- Game-scoped loan delegation: `commander_loans` (migration 0021, TEST only), DAL in `src/db/lending.ts`, loan CRUD routes under `/api/players/me/loans`, borrowed-basis entitlement at ready and match-start lock, settlement accepts borrowed provenance, legacy still owner-only. No UI, no on-chain moves, no PROD writes. Do not start the lending UI.

## P5e.1 friendship age and card gifting foundation, complete (local commit, no push)

- Server-verified 30-day gift eligibility: `accepted_at` (migration 0020, TEST only), `canGiftToFriend` in `src/db/gifting.ts`, read API `GET /api/players/me/gifts/eligibility`. No transfers, mints, XP/Gold changes, UI or PROD writes.
- Card ownership finding: no transferable card inventory exists. Cards are global definitions plus account-bound XP/purchased levels and deck-slot claims. Minimal giftable-copy model proposed without an issuing source. Do not start P5e.2 transfers.

## P5d.2 clan UI and social integration, complete (local commit, no push)

- Added `/app/clans`, server-backed create/edit, pending invite accept/decline, accepted-friend invite picker, roster and role management, transfer, remove, leave and archive confirmations. Profile account actions link into clans without adding a sixth nav tab or changing the HUD.
- Verification: clan model tests 4/4, typecheck, scoped ESLint and production build pass. Browser route returned 200, but the unauthenticated fixture rendered the truthful unavailable state after a Privy app-config abort. Responsive checks at 390x844, 360x800 and 1366x768 had no horizontal overflow. No authenticated clan acceptance claim. Local checkpoint is committed, with no push.

## P5d.1 clan membership and governance backend, complete (local commit, no push)

- Clans, memberships, invites (migrations 0017-0019, TEST only), 11 explicit routes, no UI. Tests 20/20 clan plus 52/52 social regressions green sequential. Typecheck/lint/build green. Full-file reruns flake under sustained TEST-branch load (19/20 then 20/20, no code change). Do not start clan UI.

## P5c private messaging UI and social integration, complete pending commit

- Added the conversation opener route and neutral social-safety handling, plus `/app/messages`, Friends Message links, shared HUD Messages link, avatar/timestamp inbox rows, cursor paging, bounded visible polling, read acks and retry-safe sends.
- Focused tests: 36/36 across model, Friends, opener and messaging DAL suites. Typecheck, scoped lint and production build pass. Full lint still has the pre-existing P5b `route.test.ts` explicit-any error and existing `/dev/progress` image warning.
- Browser fixture smoke is honest service-unavailable at 390x844 and desktop, with no console errors. No authenticated messaging or production schema claim. Next: review staged diff, commit scoped files only, then report the forward-oldest pagination limitation and PROD migration blocker.

Last updated: 2026-10-24

## P5b real private messaging backend, complete (local commit, no push)

- DM conversations/messages (migration 0016, TEST only), idempotent sends, cursor pagination, recipient-only read acks, neutral unavailable errors, no UI. Tests 19/19 new, Friends/block regressions 33/33 green, typecheck/lint/build green. Do not start P5c.

## P5a player blocking and social safety, complete (local commit, no push)

- Directional blocks with friendship teardown, neutral unavailable errors, hidden search, shared guard, minimal UI, TEST migration 0015 applied to TEST only. Tests 16/16 new plus 17/17 Friends regressions green. Pre-existing battle-animation tsc/build breakage carried over, no new type errors. Do not start P5b.

## P4b character animation and battlefield motion, complete (local commit)

- Added authoritative animation cue projection and tests. Existing v001 static art now gets responsive spawn pop, movement interpolation with correction snap, directional facing, attack windup/release, HP hit emphasis, bounded death collapse/fade, event dedupe, reconnect priming and pooled cleanup on match reset.
- Preserved arena/HUD/audio/VFX/input/gameplay. No new animation assets or dependencies. Runtime manifest inspection found no animation frames or sheets.
- Verification: focused animation/render suites 54/54, typecheck green, full lint green, production build green. Localhost smoke reached the unauthenticated `/dev/battle` gate only. No live authenticated gameplay claim.
- Local checkpoint is committed with the scoped BattleCanvas, battle-animation helper/tests and state-log updates. Do not start P5.

## P4a essential battle audio, complete (local commit, no push)

- Added `battle-audio.ts` procedural cue engine and pure event projection tests. Cues use authoritative deploy/spawn, spell, tower/siege fire, impact, structure HP, death/destruction, commander ability, Chaos pulse, ack and result signals.
- Added compact battle HUD Sound toggle and volume control with browser-gesture unlock, local mute/volume persistence, reconnect-safe priming, dedupe, throttling and cleanup. Battle input, Phaser lifecycle and combat state are unchanged.
- Verification: focused tests 20/20, typecheck green, focused lint green, full lint green with one pre-existing `/dev/progress` warning, production build green after existing static-page retries. Localhost smoke reached the unauthenticated dev-battle gate only, so no live authenticated audio claim.
- Local checkpoint is committed. Preserve `.fast-build/STATE.md`, `DESIGN.md`, and `docs/Chog Royale messaging.md`. Stop after P4a.

## P3b player, patron and NFT progression integrity, complete (local commit, no push)

- Verified by inspection plus existing tests: deployment-independent stats, W/L/D correctness, private/casual/ranked separation, deployment-gated commander appearances, v2-only patron appearances, Paragon 9-vs-10 with idempotent reprocessing, invalid-evidence refusal, ownership checks. Fixed one proven gap: ranked bucket missing from stats byType (ranked rows settled but invisible in the breakdown).
- Scoped change: `getPlayerStats` ranked breakdown, dev progress Ranked row, new ranked-bucket test. Verification: progression 10/10, stats route 3/3, progress-model 29/29, typecheck, lint (1 pre-existing warning), build green. Live pool read-only: 1969 resolved, 0 invalid.
- Local commit: pending (scoped: progression.ts, progression.test.ts, dev progress page, agent-state). `.fast-build/STATE.md`, `DESIGN.md`, `docs/Chog Royale messaging.md` untouched. No PROD activation, no migrations 0010-0014, no push, no deploy.
- Next: owner review, including the still-gated live NFT-holder acceptance match. Do not start P4.
