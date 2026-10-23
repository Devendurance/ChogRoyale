# Left Off

Last updated: 2026-10-23

## B5.2a.1 snapshot + restore PROVEN (2026-10-23), all artifacts kept

- Snapshot `snap-calm-hall-b5xke2bw` (b52a-pre-migration) of PROD at 13:40:26Z. Manual, no auto-expiry; storage accrues until deleted. No other snapshots exist.
- Restore test: new branch `b52a-restore-verify` (br-plain-bird-b5nfe7ke) from snapshot (finalize:false required for realtime branches). Verified: journal 1-7, players present, 5 tables absent, 9 players = pre-snapshot PROD count, endpoint distinct from PROD/TEST/rehearsal.
- PROD unchanged after: journal 1-7, 9 players, tables absent. Rehearsal branch kept. No migrations, flags, deploy, or push.
- Backup verdict: GO for B5.2b checkpoint. Freshness rule: B5.2b must re-verify PROD player count immediately before migrating; any drift needs a fresh approved snapshot.

## B5.2a backup/migration readiness: NO-GO (2026-10-23), pre-execution only

- Backup: zero snapshots on project; PITR window is 24h (history_retention 86400). Rehearsal branch is diverged, not a backup. Restorability unproven (restore = new branch, prohibited this slice). Owner must authorize a pre-migration snapshot or formally accept PITR-only risk.
- Runner: `db:migrate` targets DATABASE_URL = PROD (verified today); pending = 0007-0009 in order; journal still 1-7, tables absent. Fail-closed procedure + post-checks + recovery prepared, no execution.
- Verdict NO-GO until backup artifact exists. Next: owner backup decision, then B5.2b execution slice.

## B5.1c rehearsal COMPLETE (2026-10-23), branch kept, PROD untouched

- Clone `b51c-rehearsal` (br-dawn-darkness-b5zzujuy) from PROD branch br-snowy-star-b5ftxkro at LSN 0/44F7338. Branch kept per authorization; no deletion without owner approval.
- Migration 0007-0009 applied to clone only via guarded script (fail-closed endpoint check, pre-state assert, never stock db:migrate). Journal 1-10, all 6 tables present, checks 5/1/5/6/1, players preserved and nonempty.
- Full 7-file clone run hung (~8min, died with its shell, no residue process, nothing committing). Not retried per correction. Minimal rerun: loadouts DAL 10/10 on the clone in 66s. Other 6 files unverified on clone; TEST 65/65 stands as prior evidence only.
- PROD re-verified read-only after: journal still 7 entries, no persistence tables. TEST untouched. No flags, deploy, or push.
- Still outstanding: fresh-install 0000-0009 on an empty DB; PROD backup review; owner approval for the PROD run.

## B5.1c rehearsal pre-flight (2026-10-23), STOPPED at approval gate

- Pre-flight done read-only: HEAD `f0a4162`; TEST/PROD endpoints distinct; PROD journal holds ids 1-7 (0000-0006), missing exactly 0007-0009; PROD has `players` only.
- Safety finding: `drizzle.config.ts` points `db:migrate` at `DATABASE_URL` (PROD), so the stock migrate command must never run except at the approved PROD moment. The clone rehearsal needs a TEST-runner-style script with a fail-closed guard, not yet written.
- BLOCKED: no explicit owner approval evidenced to provision a disposable PROD-clone Neon branch. Per the slice's own stop rule, nothing was provisioned, migrated, or written. PROD and TEST untouched.
- Next: owner either authorizes the clone (then run the B5.1c rehearsal plan from the session report) or defers; fresh-install 0000-0009 rehearsal is a separate outstanding prerequisite either way.

## B5.1b TEST persistence verification (2026-10-23), diagnostic only

- Safety: HEAD `df6bb1d`; TEST/PROD endpoints distinct; runner uses `DATABASE_URL_TEST` with a fail-closed guard that refuses PROD endpoints. No migration re-run; no TEST reset.
- TEST journal holds all 10 entries (0000-0009); check-constraint counts match contracts exactly (loadouts 5, matches 6, participants 5, evidence 1, legacy_runs 1). No drift.
- Focused suites on TEST: 65/65 across 7 files (loadouts DAL + route, settlement + settlement-room, legacy DAL + battle legacy, matches route). One run, no repeats.
- PROD re-checked read-only after: `players` only, all five persistence tables still absent.
- Next: owner approval for the PROD migration run; fresh-install rehearsal still needs a separate disposable branch plus approval. It is not covered by this slice.

## B5.1 persistence preflight (2026-10-23), diagnostic only

- PROD has `players` only; `player_loadouts`, `matches`, `match_participants`, `match_evidence`, `match_legacy_runs` all absent. TEST has all six. Endpoints distinct. Read-only `to_regclass` check, no writes, no secrets printed.
- Required PROD set: 0007 (loadouts), 0008 (matches/participants/evidence), 0009 (legacy runs + entitlement_owner), in journal order. No 0010 exists or is needed.
- `format_version` column pinned to 1 by design; v1/v2 discriminant lives in evidence jsonb. Prior mismatch note resolved, not a blocker.
- Settlement/legacy/loadout code paths reviewed read-only; idempotency, conflict, dedupe and eligibility guards present in code. Nothing enabled, nothing applied. Full runbook in session report.
- Next: owner approval checkpoint, then TEST rehearsal and the gated PROD runbook from the B5.1 report.

## UI polish pass (2026-10-23)

- Doing: finalizing one bounded UI-only polish slice on `aa52dc7`.
- Done: fixed Progress identity wrapping, improved battle card cost/name readability, and rebuilt the existing result overlay with truthful match context and Back to lobby action. Temporary fixture route was removed.
- Checks: focused HUD/progress tests 39/39, typecheck and lint passed. Production build completed. Browser fixtures at 390x844, 1366x768 and 360x800 had no overflow, and the fresh localhost:3000 pass had no console errors.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/ui-polish-20261023/`. Live authenticated QA was not performed.
- Next: owner review of the labelled fixture evidence, then stop after UI polish. Live authenticated QA remains separate.

## B2.8g.2 combat VFX and gameplay feedback (2026-10-23)

- Doing: finalizing one bounded combat feedback pass on the f449893 arena correction.
- Done: added authoritative HP hit bursts for units, buildings and structures, brighter impact and destruction readability, ability activation flash, building and spawned-unit aura cues, Chaos transition edge cues, bounded event deduplication, match reset handling and reduced-motion shortening. Existing V002/V001 art bindings and projectile paths remain in use.
- Checks: focused battle suites 60/60 passed, typecheck passed, lint passed with the existing `/dev/progress` image warning, and production build passed with 38 static pages. Recorded event fixtures at 390x844, 1366x768, 360x800 and 1920x1080 show no overflow or console/page errors.
- Next: owner review of the bounded fixture evidence, then stop after B2.8g.2. Live authenticated interaction remains unverified, and no audio or character animation is planned.

## B2.8g.1 visual correction (2026-10-23)

- Doing: finalizing the bounded correction against the approved desktop and mobile target images.
- Done: copied both target PNGs to `C:/Users/USER/Documents/ChogRoyale-Assets/battle-visual-targets/`, padded top Core visuals without moving gameplay anchors, added seat-relative coral and cyan structure accents, and retained the V002 environment frame plus approved HUD.
- Checks: 57 focused battle tests passed, typecheck passed, lint passed with the existing `/dev/progress` image warning, and production build passed with 38 static pages. Fixture captures at 390x844, 1366x768, 360x800 and 1920x1080 show both seat perspectives, full structure presentation, no overflow, and no console/page errors.
- Next: create the scoped correction checkpoint, stage only correction files, commit locally, and stop. Fixture evidence does not establish live pointer/deployment or two-player acceptance.

## B2.8g.1 arena environment and visual depth (2026-10-23)

- Doing: one bounded environment pass after the approved B2.8g.0 HUD.
- Done: added a non-interactive green/teal world surround to the existing arena shell and low contact shadows to V002 mounted towers/Cores. No board transform, gameplay coordinate, HUD composition, combat, networking or backend changes.
- Checks: focused battle suites 55/55, typecheck passed, lint 0 errors with the one pre-existing `/dev/progress` image warning, production build passed with 38 static pages. Fixture captures at 390x844, 1366x768, 360x800 and 1920x1080 show no overflow or console/page errors, and preserve the 100:160 canvas aspect. Temporary fixture routes were deleted.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/battle-b28g0-review/qa-20261023/`. Fixture evidence does not establish live pointer/deployment delivery. Existing top Core edge clipping remains deferred because a safe fix would require changing visual bounds or camera space.
- Next: owner visual review, then stop after B2.8g.1. Do not start B2.8g.2, character animation or audio.

## B2.8g.0 battlefield shell and combat HUD (2026-10-23)

- Doing: one bounded active-battle presentation slice. Stop after B2.8g.0.
- Done: violet/gold shell, desktop hand dock beside the board, mobile bottom hand/energy/ability dock, game typography, readable cost/selection feedback, secondary diagnostics and visible connection/recovery messages. Canvas, gameplay, server and persistence logic unchanged.
- Verification and local checkpoint: `.fast-build/B2.8g.0-CHECKPOINT.md`. Labelled presentation-fixture evidence is outside the repository at `C:/Users/USER/Documents/ChogRoyale-Assets/battle-b28g0-review/`.
- Checks: 67 focused tests, typecheck, lint and one production build passed. Lint retains one pre-existing `/dev/progress` image warning. Four final fixture views fit with no console/page errors. Temporary route removed, unrelated dirty files hash-preserved. Local commit only.
- Next: owner visual review and live two-account/mobile-device QA. Pointer/deployment interaction verification remains pending a real two-player regression test. The owner chose fixtures only for this pass. No animation, audio, new VFX, settlement, deployment or push authorized by this slice.

## A4.5 app-shell integration completed (2026-10-23)

- Done: every public game-entry link on the landing page now goes to `/app` instead of `/dev/battle`: desktop header, mobile menu, hero, bento battle tile, closing CTA and footer. In-page anchors and external links are unchanged. The lobby Battle action remains the explicit battle entry behind its existing gate.
- Shell check: all five primary tabs resolve, Commanders is enabled, Legacy keeps Progress context, Settings keeps Profile context and the Play Guide has no sixth tab. Settings stays in the HUD and the guide stays a lobby entry.
- Checks: focused copy tests 6/6, typecheck clean, lint 0 errors with the one pre-existing `/dev/progress` warning, production build green.
- Browser: landing intro plays and clears; six Play links all target `/app`; hero Play reaches `/app`; the login gate appears with one h1; one `.app-root`; all eight app routes return 200; no overflow at 390, 1366 or 360; no console errors or page exceptions. Evidence at `C:/Users/USER/Documents/ChogRoyale-Assets/app-a4.5-review/`.
- Pending: authenticated active-tab, HUD, sign-out and lobby-entry clicks need a real Privy login.
- Checkpoint: `.fast-build/A4.5-CHECKPOINT.md`. `.fast-build/STATE.md` still holds unrelated dirty B2.8f history and was not staged.
- Next: owner acceptance for the A4 surface. Do not start B2.8g, B4 or B5.

## A4.4 play guide completed (2026-10-23)

- Done: `/app/guide` explains the real objective, crowns, arena, towers and Core, energy, deployment, deck and hand cycle, commander abilities, Chaos Pulses, the Arena Patron and supported unranked modes. Ruleset values are projected on the server from `combat.ts`, `chaos.ts` and `commanders.ts`. The 20-card roster uses the same catalog as the deck builder. The lobby deck header links to the guide.
- Checks: focused guide tests 13/13, production build green with `/app/guide` static, final typegen and typecheck clean, lint 0 errors with the one pre-existing `/dev/progress` warning.
- Browser: labelled fixture at 390x844, 1366x768 and 360x800. One h1, 7 panels, 5 abilities, 5 Chaos families, 2 modes, 20 cards, two columns at 1366 and one at 390/360, no overflow or console errors. `/app/guide` login gate at 390 is clean. Fixture deleted before commit.
- Pending: signed-in guide QA needs a real Privy login. Real session identity and the lobby-to-guide click were not exercised.
- Checkpoint: `.fast-build/A4.4-CHECKPOINT.md`. `.fast-build/STATE.md` still holds unrelated dirty B2.8f history and was not staged.
- Next: A4.5 only. Not started.

## A4.3 feedback layer completed (2026-10-23)

- Done: shared `feedback-model.ts` maps auth, setup, conflict, validation, service and network failures to consistent notices. `AppNotice` now supports real Sign in and Try again actions, all authenticated views deduplicate notices by message, and session expiry is actionable on lobby, decks, profile, progress, legacy, settings and commanders. Failed reads still stay unavailable or locked, and deck conflicts keep local work.
- Checks: focused feedback, settings, commanders and decks tests 80/80, typecheck clean, lint 0 errors with the one pre-existing `/dev/progress` warning, production build green.
- Browser: labelled feedback fixture at 390x844, 1366x768 and 360x800. Three unique notices from four, working Sign in and Try again, 44px actions, setup link resolves, no overflow or console errors. Settings gate at 390 and commanders gate at 1366 also clean. Fixture deleted before commit.
- Pending: authenticated failure states need a real Privy session. Live token expiry, 403, 409, 500, 503 and network failures were not exercised.
- Checkpoint: `.fast-build/A4.3-CHECKPOINT.md`. `.fast-build/STATE.md` still holds unrelated dirty B2.8f history and was not staged.
- Next: A4.4 only. Not started.

## A4.2 commanders gallery completed (2026-10-23)

- Done: activated `/app/commanders`. The five real free classes come from the server catalog, with a featured `CommanderStage`, class details, authored abilities and counters, and real combat rows. Genesis entries come from the existing eligibility route and stay separate, labelled as cached observations rather than ownership proof. The screen never reads or writes a loadout and links to `/app/decks` for selection.
- Checks: focused commanders model tests 19/19, typecheck clean, lint 0 errors with the one pre-existing `/dev/progress` warning, production build green with `/app/commanders` prerendered static.
- Browser: fixture pass at 390x844, 1366x768 and 360x800. Five free cards, three Genesis fixtures, keyboard and touch selection, active Commanders nav, no overflow, no console errors, no loadout request. Fixture route deleted before commit.
- Pending: authenticated gallery QA needs a real Privy login. Real eligible token art, no-wallet, 403 and 500 shapes were not exercised.
- Checkpoint: `.fast-build/A4.2-CHECKPOINT.md`. `.fast-build/STATE.md` still holds unrelated dirty B2.8f history and was not staged.
- Next: A4.3 only. Not started.

## A4.1 settings completed (2026-10-23)

- Done: finished the partial `/app/settings` slice. Display name and avatar save through `POST /api/players/onboard`, then reconcile from `GET /api/players/me`. Wallet addresses, row ids and Privy identifiers stay out of the UI. Settings is linked from the HUD and the profile account panel.
- Checks: focused settings model tests 23/23, typecheck clean, lint 0 errors with the one pre-existing `/dev/progress` warning, production build green with `/app/settings` prerendered static.
- Browser: `/app/settings` 200 at 390x844, 1366x768 and 360x800. Login gate renders one h1, the Privy dialog opens, no overflow, no console errors, no page exceptions.
- Pending: authenticated settings QA needs a real Privy login. Real profile load, name save, avatar save, wallet summary and post-save reconciliation were not exercised.
- Checkpoint: `.fast-build/A4.1-CHECKPOINT.md`. `.fast-build/STATE.md` still holds unrelated dirty B2.8f history and was not staged.
- Next: A4.2 only. Not started.

## Fast-Build roadmap registered (2026-10-23)

- Doing: roadmap intake only. No product code, tests, database writes, deploy or push.
- Registered: `.fast-build/ROADMAP.md` with the completed baseline, the active B2.8f.3 live QA slice, the next A4.1 settings slice, GATE A, A4, B2.8g, B4, B5 and the release gates.
- Preserved: `.fast-build/STATE.md` with its existing uncommitted B2.8f and B3 history, untracked `DESIGN.md`, and untracked `docs/Chog Royale messaging.md`.
- Next: A4.1 settings and account surface in a fresh session. GATE A authenticated acceptance and the B2.8f.3 live match are owner-gated.
- Git: scoped roadmap and state commit only. No push.

## A3.2b Genesis legacy vault (2026-10-22), awaiting owner review

- Doing: one bounded slice, the token-centric Genesis legacy and achievement vault at `/app/progress/legacy`. Stopped after A3.2b; A4 has not started.
- Done: `src/app/app/progress/legacy/page.tsx`, `src/components/app/{LegacyScreen,LegacyView,legacy-model,legacy-types}.ts(x)`, `legacy-model.test.ts` and the existing-route test `src/app/api/nfts/[tokenId]/legacy/route.test.ts`. The Progress screen has a "Open legacy vault" entry and the Profile record panel has a "Genesis legacy" link. No new backend endpoint, table, migration, ownership rule, award engine or combat change.
- Real reads: `/api/players/me/nfts` (verified-wallet holdings), `/api/players/me/commanders` (cached class/eligibility enrichment), `/api/nfts/[tokenId]/legacy` (stats, total, offset-paginated history) and `/api/nfts/[tokenId]/achievements` (earned-only awards). All are existing routes.
- UI: a full-width Genesis vault shelf of held tokens; a selected-token hero with genuine token art when the route resolves it, otherwise shared commander class art labelled as class art; four verified medallions (commander appearances, Arena Patron appearances, victories, defeats); a visible legacy trail; and the four authored achievements. The trail states "Ownership verified at match start" for commander appearances and "Assigned by the match, not selected as a commander" for Arena Patron appearances.
- Achievements: earned awards come from the read route; locked progress comes only from the authored definitions and the token's verified counts (First Blood, First Victory, Veteran, Paragon). A missing award date still shows as earned. No tiers, points, rarity, rewards or fabricated dates.
- States: vault ready, empty, no verified wallet, unavailable, locked and auth; record ready, empty, not indexed, unavailable, locked and auth are separate. Only a successful total 0 is empty. A 404 is "not indexed"; a 500/503/network failure says "isn't available yet". A real 500 is never treated as no legacy.
- Separation: holdings are cached verified-wallet observations and the battle server re-checks ownership at match start. A commander appearance carries its own direct-owner proof. An Arena Patron can be any Genesis token and is server-selected, so the UI never says the Patron was a player commander choice. Token records stay with the token across transfers.
- Privacy: the token legacy payload includes authority keys, match ids, source/actor, payloads and hashes. The model strips them; the browser privacy scan found no DID, wallet, seed, command or hash text. No wallet addresses or Privy ids are rendered.
- Checks: focused tests 28/28 (24 legacy model, 4 existing API route tests on the isolated TEST branch, cleaned), typecheck clean, lint 0 errors with the one pre-existing `/dev/progress` warning, final production build green with `/app/progress/legacy` prerendered static and no fixture route. `/app/qa-legacy` answers 404.
- Browser pass: 390x844, 1366x768 and 360x800 on the presentation fixture: no horizontal overflow, no console errors, one h1, 44px action controls, no nav collision, token selection between ready, genuine empty and unavailable records, empty/no-wallet/unavailable vault states, earned/locked achievements, and the correct Patron versus commander labels. Live `/app/progress/legacy` shows the Privy login gate with no console errors or overflow; `/app/progress`, `/app/profile` and `/dev/progress` still answer 200.
- Limitation: the authenticated path was not exercised. Privy needs a real wallet or email round trip and there is no dev bypass. The two vault screenshots are sample-data presentation fixtures, labelled as such in the page, and are not authenticated player evidence. Manual checks still pending: a real holding list, a real token legacy record and award, a real token image, and the real 500 shape when the legacy tables are absent.
- Server note: a concurrent long-running `scripts/_diag-battle.ts` process and dev HMR put `next dev` into a rebuild loop, so QA and the final check use `next start -p 3000` on the production build. The final server is healthy on :3000. The unrelated diagnostic process was left untouched. Restart `npm run dev` later if the owner wants the development server instead.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/app-a3.2b-review/` (`legacy-fixture-390.png`, `legacy-fixture-1366.png`, `legacy-login-390.png`). The 390 capture is a 390-wide full-page review at 2850px; 390x844 and 360x800 were measured separately.
- Next: owner review of A3.2b. A4 has not started. Launch blockers remain PROD migrations 0007-0009, settlement/legacy activation, authenticated end-to-end checks and real NFT ownership testing.
- Unrelated dirty files left untouched: modified `.fast-build/STATE.md`, untracked `DESIGN.md` and `docs/Chog Royale messaging.md`. The internal route test writes only to the isolated TEST branch.

## A3.2a progress, match history and casual leaderboard (2026-10-22), awaiting owner review

- Doing: one bounded UI integration slice, the authenticated progress screen at `/app/progress`. Stopped after A3.2a; nothing from A3.2b started.
- Done: `src/app/app/progress/page.tsx`, `src/components/app/{ProgressScreen,ProgressView,progress-model,progress-types}.ts(x)` and `progress-model.test.ts`. The screen reads the real `/api/players/me`, `/stats`, `/matches` and `/leaderboard/casual` endpoints with the existing Privy token. No new endpoint, table, migration, settlement, rating or reward.
- Record: a hero with the server win rate and W/L/D, then real match counts, wins, losses, draws, crowns earned/conceded, private versus matchmaking splits and first/latest match dates. The causal chip uses the server's eligibility and position. No trophies, XP, levels, currencies, streaks or ranked language.
- History: cursor-paginated at 6 per page through the existing API. Rows show result, opponent username, crown score, match type, date, caller-side commander and deck size/names, and the replay-verified state. No seeds, commands, state hashes, wallets, Privy ids, player ids or opponent decks.
- Leaderboard: the exact heading "Casual Alpha Leaderboard", offset-paginated at 10 per page, with the server minimum, server eligibility/position, the real ordering and a `You` row. Private rooms are excluded. No fake rows.
- States: loading, ready, genuine empty, service unavailable, setup locked and session expired are separate. A 500 or network failure says "isn't available yet" and never becomes zero. `resolveBoard` also refuses to call an `entries: []` first page empty when the payload says players qualified.
- Navigation: `AppNav` Progress and the profile "Open progress" action point to `/app/progress`. `/dev/progress` is unchanged and still answers 200. The HUD user icon still points at `/app/profile`. A3.1 `ProfileView` copy now names the Casual Alpha Leaderboard.
- Shell fix: at 430px and below the disabled "Commanders" nav label now uses 7px with no side padding. The previous 8px label was 63px wide in a 57px item at 360px, so it spilled into the active Progress tab. Working labels keep their 8px step.
- Checks: typecheck clean, lint 0 errors with the one pre-existing `/dev/progress` `no-img-element` warning, focused tests 70/70 (progress model, profile model, decks model), existing API route tests 10/10 (matches cursor pagination, stats, casual leaderboard), one final production build green with `/app/progress` prerendered static. The dev server on :3000 is healthy; it was restarted once because stale server chunks from earlier shared-component edits produced false hydration mismatches.
- Browser pass: 390x844, 1366x768 and 360x800 on the fixture route: no horizontal overflow, no console errors, 6 match rows, 10 board rows, the 1-10 of 12 pager, the anchor jump to the board, the focus ring, and a privacy scan with no DID, wallet, seed, command or hash text. The live `/app/progress` shows the Privy login gate with no console errors and no overflow. `/app/profile` and `/dev/progress` still answer 200. The temporary fixture route was deleted; `/app/qa-progress` answers 404.
- Limitation: the authenticated path was not exercised. Privy needs a real wallet or email round trip and there is no dev bypass, so the stats, history and leaderboard branches are code, model-test and fixture verified only. The fixture screenshots are sample data, labelled as such in the page, and are not authenticated player evidence. Manual checks still pending: a real login, a real settled record, a real saved match page, a real board page, and the real 500 shape when the settlement tables are absent.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/app-a3.2a-review/` (`progress-fixture-390.png`, `progress-fixture-1366.png`, `progress-login-390.png`). The 390 capture is a 390-wide full-page review at 2350px so the fixed nav sits at the page end; 390x844 and 360x800 were measured separately.
- Next: owner review of A3.2a, then A3.2b NFT legacy only. A3.2b has not started.
- Unrelated dirty files left untouched: modified `.fast-build/STATE.md`, untracked `DESIGN.md` and `docs/Chog Royale messaging.md`.

## A3.1 player profile (2026-10-22), awaiting owner review

- Doing: one bounded UI integration slice, the authenticated profile at `/app/profile`. Stopped after A3.1, nothing from A3.2 started.
- Done: `src/app/app/profile/page.tsx`, `src/components/app/{ProfileScreen,ProfileView,profile-model,profile-types}.ts(x)` and `profile-model.test.ts`. The screen reads the real `/api/players/me`, `/loadout`, `/commanders` and `/stats` endpoints in parallel with the existing Privy token and reuses `resolvePlayer`, `resolveCommander`, `resolveDeck` and `toEligibility` from `lobby-model.ts`. No new endpoint, no new persistence, no API, DB or combat change.
- Shared: `CommanderStage` and `AppNotice` were extracted from `LobbyView` verbatim and are now used by the lobby and the profile. `CommanderStage` gained a `headingLevel` prop, so the profile has one h1 (the player name) and the commander title is an h2. The lobby keeps h1 and its own render.
- Identity: real avatar, display name and @username, an account-status badge, a verified-wallet count badge, the real `createdAt` as "Member since", and the onboarding step. No wallet address, player id, DID or role list is rendered. Missing values show "Not available".
- Commander: the featured stage shows class name, class art, role, real cost, real ability and the free/NFT origin label. The class detail panel adds the full role sentence, the real class combat rows and the counters. An unresolved NFT claim shows "No class art" and "Class detail is unavailable". No loadout falls back to a clearly labelled free starter, never an invented selection.
- Deck and record: the deck panel lists the real saved card names with the average cost and links to `/app/decks`. The record panel shows the real settled W/L/D, win rate and crowns when the stats read succeeds, "No verified matches yet" when it is empty, and one honest unavailable line when it fails. No leaderboard, trophies, XP, levels, currencies, streaks or rankings; `/dev/progress` stays the full progress surface for A3.2.
- Navigation: `AppNav` now has five tabs (Lobby, Decks, Commanders/Soon, Progress, Profile) and the HUD user icon points at `/app/profile`. The bar fits 360px with no label overlap. Logout and `/dev/progress` are unchanged.
- Checks: typecheck clean, lint 0 errors with the one pre-existing warning, focused tests 42/42 (profile model 16, decks model 26). Browser pass at 390x844, 1366x768 and 360x800: live `/app/profile` shows the login gate with no console errors and no overflow, `/app` and `/app/decks` still answer 200, and a temporary presentation fixture (real catalog data, no API or DB) rendered the ready and fallback states. Fixed during the pass: a wrapped Targets stat row, the two-h1 outline, and duplicated stats and deck failure copy.
- Limitation: the authenticated path was not exercised. Privy needs a real wallet or email round trip and there is no dev bypass. The fixture screenshots are sample-data presentation evidence, not live player evidence. Manual checks pending: real login, a real saved deck and commander, a real settled record, the locked/unavailable states against a real 403 or 500, and the lobby ready state after the shared-component extraction.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/app-a3.1-review/` (`profile-390.png`, `profile-1366.png`, `profile-login-390.png`).
- Unrelated dirty files left untouched: `.fast-build/STATE.md`, untracked `DESIGN.md` and `docs/Chog Royale messaging.md`.

## A2.1 decks acceptance and polish (2026-10-22), awaiting owner review

- Doing: finish the A2.1 pass that an interrupted Claude Code session started. Recovery found its partial work in `decks-model.ts`, `decks-types.ts` and `env.test.ts`; the model helpers were correct but nothing used them yet, so typecheck was failing. The work was finished, not replaced.
- Done: the unavailable account-save message is stated once, in the save strip, and the ribbon badge is a short token (`Saved`, `Save unavailable`, `Conflict`). The old service notice and the separate save note were removed. The save button gets a grey disabled treatment, stays disabled while account saving is unavailable and never claims a save the server did not confirm. The average chip says "current selection average" for a partial deck and "average energy" only for a complete seven plus one deck with a known commander cost. The local draft is now loaded even when the loadout read fails, so a reload during an outage keeps the deck on screen.
- Commander: "Fleet Recruit" is the free Scout starter (`FREE_NAMES.scout` in `src/lib/commanders.ts` is the source of the name), class scout, cost 4 from `COMMANDER_COMBAT_PROFILE_V1.scout`, with the shared Scout commander class portrait. It is a valid class template, not an NFT and not a fallback, so no commander code changed. Verified against the built catalog and the art file on disk.
- Battle: the A2 extraction of `describeCard` / `describeCommander` into `src/lib/card-details.ts` is description-only. `session.test.ts` 15/15 includes a full match with `replayIdentical`. No combat stat, simulation or replay hash change.
- Env test: the previous `CHOG_TEST_DB=1` failure was a warm memoized env cache from `vitest.setup.ts`. `env.test.ts` now calls `resetEnvCache()` before each assertion and restores the saved keys in a `finally`. Passes with and without `CHOG_TEST_DB=1`; the DB isolation guard is untouched.
- Checks: typecheck clean, lint 0 errors with the one pre-existing `no-img-element` warning, focused tests 43/43 (decks model 26, battle session 15, env 2). Browser pass at 390x844 and 1366x768 on `/app/decks`: login gate renders, no horizontal overflow, no console errors. A CSS probe on the live page confirmed the disabled save button is grey with opacity 0.62, the "current selection average" chip fits at 390px and the unavailable status is one sentence.
- Limitation: the authenticated deck screen was not reachable, because Privy needs a real wallet or email round trip and there is no dev bypass. The save, conflict, commander and average states are code and test verified only. Manual checks still pending: real login, saved deck load, partial and complete average labels, unavailable save with local draft after reload, 409 conflict and recovery, and "Fleet Recruit" in the real account.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/app-a2.1-review/` (login gate screenshots at both viewports). The production build was not rerun, to avoid disturbing the healthy dev server on :3000; the change is client-only and typecheck, lint and focused tests are green.
- Unrelated dirty files left untouched: `.fast-build/STATE.md`, untracked `DESIGN.md` and `docs/Chog Royale messaging.md`.

## A2 decks and collection (2026-10-22), awaiting owner review

- Doing: the A2 slice of the authenticated game. One bounded vertical slice: the deck builder and the card collection inside the existing `/app` shell. Stopped after A2, nothing from A3 started.
- Done: `src/app/app/decks/page.tsx` (the route), `src/components/app/{DecksScreen,DecksView,decks-model,decks-types}.tsx`, `src/components/app/{AppHud,AppSession}.tsx`, `src/lib/card-details.ts` and `src/components/app/decks-model.test.ts`. The A1 shell was extended, not rebuilt: the shared `/app` layout now owns the Privy provider, the HUD was pulled out of `LobbyView` into `AppHud`, and `AppNav` now links Decks to `/app/decks`.
- Composition follows the DESIGN.md lobby spec and the C and D reference clips: a Decks/Collection switcher, a "Battle Deck" ribbon, a 4 by 2 grid of eight tiles (seven card slots plus the commander), energy cost badges, an average-energy chip, a card detail panel and a filterable collection grid. The reference's level bars, upgrade progress, coin costs, New ribbons and rarities were deliberately left out, because Chog Royale has no levels, no upgrades, no currencies and no rarities.
- Data: the catalog is still built on the server from the live ruleset. Card names, costs, type labels, traits, one-line descriptions and the stat rows all come from `CARDS_V1` through the new `src/lib/card-details.ts`, which the battle session now shares, so the deck screen and the battle log cannot disagree about a card. The 20 ordinary cards are the real ones. The commander list is the five free classes plus the NFT entries `/api/players/me/commanders` reports eligible; a saved NFT token id is shown as a claim, never as proof of ownership, and the screen says the battle server proves it again at ready and at match start. Free and NFT commanders of one class show the same class numbers because the combat profile is class-keyed.
- Account: the screen only writes through the existing `PUT /api/players/me/loadout`, with the existing revision check and the existing 409 behaviour. The states are separated: loading, saved, unsaved, no saved deck, service unavailable, revision conflict and save failed. "Saved to your account" is only shown after the server confirms it. When the service is unavailable the deck stays an honest unsaved local draft in `localStorage` under `chog.a2.deckDraft`, and the save button is turned off. No new endpoint, no second persistence system, no migration, no PROD write.
- Two real defects were found and fixed during the build. First, the deck grid stretched to 210px tiles at 1366px and pushed the Save action below the fold, so the desktop deck panel is now two columns with the grid beside the save column. Second, the local draft was read in a render-phase state initializer, which is a hydration mismatch waiting to happen, so the draft now starts empty on both the server and the client and is applied after the reads resolve.
- Limitation: the authenticated path was never exercised for real. Privy needs a real wallet or email round trip and there is no dev bypass, so the profile, loadout, commander and save branches are type and code verified only. The visual QA used a temporary preview route with sample data, which has been deleted: `/app/qa-decks` answers 404 and `src/app/app/` holds only `catalog.ts`, `layout.tsx`, `page.tsx` and `decks/`. The real `/app/decks` route renders its login gate and answers 200.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/app-a2-review/`. 21 new model tests, full suite 660 of 661 (the one failure is `src/lib/env.test.ts`, which only fails when `CHOG_TEST_DB=1` because the setup file then caches the env before the test can delete `DATABASE_URL`; it is pre-existing and unrelated), typecheck clean, lint 0 errors with the one pre-existing warning, one production build green with `/app/decks` prerendered static.
- Browser pass at 390x844, 1366x768, 360x800 and 1920x1080: no horizontal overflow, no console errors, the 20 card ids and their real costs all render, the 7 plus 1 contract holds, the average energy chip matches the real costs, the detail panel opens and closes on Escape, the commander sheet lists five free classes and two NFT entries, and the nav Decks link lands on `/app/decks`.
- Next: owner review of A2, then A3 only.
- Concurrent work: a separate agent session began A2 in this same tree at the same time and left uncommitted files with the same names. Its work was replaced by this session's implementation and only its `describeCard` to `describeCardTypes` rename in `src/app/app/catalog.ts` survived. The tree now holds exactly one A2 implementation, and it typechecks, lints, builds and serves.

## A1 game lobby and app shell (2026-10-22), awaiting owner review

- Landing L0 to L9 is done and approved (latest `0f8b201`). A1 is the authenticated game lobby at the new `/app` route.
- Done: `src/app/app/{page,layout,catalog}.tsx` and `src/components/app/{GameLobby,LobbyView,AppNav,lobby-model,lobby-types,catalog-context,icons}.tsx` plus `app.css`. The route layout is the server half: `@/lib/combat` and `@/lib/commanders` import `next/server`, so the ruleset catalog is flattened on the server and handed to the client as plain data. The container owns Privy, the three API reads and every failure branch. The view takes plain props only.
- Composition follows the DESIGN.md lobby spec and the C and D reference clips: a top identity row with the avatar, name, a wallet-linked chip and two utility buttons, a commander stage with the Reaver class art on a glowing plinth over the V002 arena layers, a scrollable battle-deck strip of the real cards, a gold Battle button and a Refresh button, and a bottom tab bar whose active tab expands and is labelled.
- Data: `/api/players/me` for the player, `/api/players/me/loadout` for the deck and commander claim, `/api/players/me/commanders` for the free-starter fallback and NFT eligibility. Every failure has an honest state. No coins, gems, trophies, XP, levels, chests, win rates, stats or history tiles, because none of those exist.
- Two real defects were found and fixed during the acceptance pass. First, `GET /api/players/me` nests the profile under `data.player` while the loadout and commander reads answer with their payload directly, so the lobby read one level too shallow and threw on `profile.wallets.some` for every authenticated player. Second, the Battle action sat behind the fixed mobile tab bar and entirely below the fold at 1366x768.
- Fixed: the profile read unwraps `data.player`, and `resolvePlayer` and `toEligibility` now degrade a partial payload instead of throwing. The battle cluster is sticky above the fixed nav on mobile, a short desktop viewport tightens the stage so the action stays above the fold, and long card names break instead of clipping.
- Limitation: the authenticated path was never exercised for real. Privy needs a real wallet or email round trip and there is no dev bypass, so the profile, loadout and commander branches are type and code verified only. The visual QA used a temporary preview route with sample data, which has been deleted: `/app/qa-preview` answers 404 and `src/app/app/` holds only `catalog.ts`, `layout.tsx` and `page.tsx`.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/app-a1-review/`. Typecheck clean, lint 0 errors with the one pre-existing warning, one production build green with `/app` prerendered static.
- Next: owner review of A1, then A2 only.
- Concurrent work: a separate agent session began A2 in this same tree at the same time. Its uncommitted files carried the same names as this session's and were replaced by this implementation. Its one surviving edit is the `describeCard` to `describeCardTypes` rename in `src/app/app/catalog.ts`, which is kept. See the A2 section above.

## Public site L9 final landing corrections (2026-10-22), awaiting owner review

- L8 accepted. The read-only audit found one P1 and a set of P2 items. Fixed here.
- Intro to hero (was P1): the intro wordmark and the hero wordmark are both a gold Chog Royale in the same place, so during the 420ms dissolve they doubled into unreadable text, and the Reaver covered the hero paragraph and both CTAs. The intro foreground now clears before the background thins. The mark rises and scales away from 74 to 86 percent of the cycle, the Reaver sinks, the aura and the skip leave with them, and the background still dissolves. Measured at the midpoint of the dissolve on both viewports: overlay 0.52, foreground 0.13. The hero title, paragraph and both CTAs are fully legible. The 2520ms length, the replay on every visit, Skip, Escape, focus handling, reduced motion, Save-Data and the scroll lock are unchanged.
- Hero copy: the lead said a verified Chog NFT sets the match's Chaos Pulse, which implied the whole schedule is trait-derived. It now says the match's first Chaos Pulse, which is what the Patron's traits actually set. The headline is untouched.
- Target sizes: the carousel dots were 30x44, the L6 tile links 24px tall and the footer play link 22px. The dots are now 44x44 buttons and the row is centred, so no control overlaps another. The two text links got a transparent overlay that lifts the hit area to 44px without moving the layout. Verified by hit testing 8px above and below each link: HIT, and at 14px it falls back to the surrounding container.
- Keyboard flow: after the intro, focus went to #main, so the first Tab reached the hero and the header navigation and the skip link were only reachable after a full cycle. With no previous focus target the order now resets to the document start, so the first Tab is the skip link again. A real previous target is still restored.
- L5 headings: the cell titles were weight 500 while L2, L4 and L6 use 700. They are 700 now, all on one line at desktop, with a two line minimum only in the one and two column layouts where a title actually wraps, so the bodies stay aligned across a row.
- Footer caption: the class-art note sat in the empty sky well above the mascots. It now sits just above the ridge, 43px clear of the mascot boxes, and covers no face.
- Checks: typecheck clean, lint 0 errors with the one pre-existing warning, one production build green, one browser pass at 390x844 and 1366x768 plus a 360px overflow check. No console errors. Skip, Escape, the replay on reload and the scroll unlock all still work.
- Still open: the About lead and the closing lead both say "react to a Chaos Pulse derived from a verified Chog NFT", which is the canonical 1.7 wording and is looser than the hero now is. The owner decides whether to align them.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l8-review/qa-1366-crossfade.png`, `qa-390-crossfade.png`, `qa-1366-l5-grid.png`, `qa-1366-footer-scene.png`.
- Next: owner review, then the landing page phase is closed.

## Public site L8 seasonal opening (2026-10-22), awaiting owner review

- L7 built. Done: `SeasonOpening.tsx` + `opening.css`, mounted in `page.tsx` before the header. A fixed violet overlay over the pagoda hero: deep violet atmosphere with a gold horizon, the Reaver commander class art arriving from the upper right and settling tilted -8 degrees, the Chog Royale wordmark in gold bevel, then a dissolve into the hero that is already rendered underneath. No Three.js, no canvas, no new dependency.
- Plays on EVERY genuine visit to the landing page. Nothing is stored: no sessionStorage, localStorage, cookie or persistent flag. The component watches `usePathname()` and starts on the first mount and on any return to "/" from another route. It does not restart for a re-render, for scrolling or for an in-page anchor, because the pathname is the only dependency. Verified in the browser for fresh load, reload, and return from `/dev/battle`.
- Sequence is 2520ms: fade in 320ms, Reaver sweep 1040ms from 260ms, wordmark slam 480ms from 1180ms, dissolve 420ms from 2100ms. The whole cycle is ONE CSS animation on the overlay, so the intro still ends on its own if the script never runs, and `animationend` is what tears it down, so the fade and the teardown never drift apart. A JS timer is only a backstop.
- Accessibility: the overlay is a `role="dialog" aria-modal="true"`, focus moves to the Skip button, Tab stays inside it, Escape dismisses, the click target restores focus to `#main`, the scroll is locked while it plays and unlocked when it ends with a scrollbar-width compensation. The overlay is `pointer-events: none` except the Skip control, so the header and hero stay reachable. Reduced motion keeps the brand moment with no movement at all and a 1200ms cycle. Save-Data drops the drifting haze and shortens the cycle to 1900ms.
- Verified in Chrome at 360x800, 390x844, 1366x768 and 1920x1080: no horizontal overflow during or after the intro, no console errors, the Play link still points at /dev/battle. Typecheck, lint and one production build green.
- The Reaver is the approved commander class art, so the opening is a class-art moment and never a claim about a specific token. The real Chog Royale logotype and crest are still an open asset slot, so the wordmark stays the Lilita One fallback.
- Next: owner review of L8.

## Public site L8 acceptance check (2026-10-22), two defects fixed

- L8 built. Verified in the browser against a fresh load, a reload, a return from `/dev/battle`, scrolling, in-page anchor navigation, Skip, Escape, focus restore, reduced motion and a Save-Data path. Two confirmed defects were found and fixed, the rest passed.
- Defect 1: `aria-modal="true"` was a promise the overlay did not keep. It had `pointer-events: none`, so a pointer hit on the header Play link landed on the background link while assistive tech was told the background was inert. The overlay now takes the pointer, so the background is blocked the same way for mouse and for AT, and a click that lands on the overlay dismisses the intro so nothing feels dead.
- Defect 2: the Skip control was painted in the server HTML about 28ms before its click handler existed, so a fast click could hit a dead button. The control is now rendered only once the client is hydrated, using a `useHydrated()` store built on `useSyncExternalStore` with a false server snapshot. The server HTML has no Skip button at all, and the button fades in when it appears.
- Layout fixes confirmed: L5 has 142px of top padding, 186px below L4's last content, on a soft gradient seam. L6 has 142px of top padding and 254px below the L5 grid on its own white ground. The footer has no Royal Purple element left.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l8-review/` (`final-1366-opening.png`, `final-390-opening.png`, `final-1920-hero.png`, `accept.mjs`, `final-shots.mjs`). No console errors at any viewport.
- Next: owner review of L8, then L8 QA.

## Public site L7 closing CTA and mascot footer (2026-10-22), awaiting owner review

- L6 built. Done: `ClosingScene` (`#enter`) + `SiteFooter` + `closing.css`, mounted after the L6 bento. The CTA is white at the top so it continues the bento tail, washes up through mist and lilac, and returns to white for the footer's white band. One soft violet glow, no bevels, no mascot, type only, buttons reuse `.site-btn--primary` and `.site-btn--white` untouched.
- Footer structure follows DESIGN.md: 16px Royal Purple band, white top area with a 1.4fr 1fr 1fr 1fr grid (brand, Explore, Learn, Project), a bottom row with the copyright left and the fairness line right, then the fantasy scene.
- Copy: CTA eyebrow is the handoff Scene 07 title, heading is messaging 4.3, lead is messaging 1.7 first sentence, buttons are messaging 5.1. Footer tagline is messaging 1.1 and 1.2, statement is 1.5. The "Closed alpha" note sits next to the buttons and repeats the L5 wording, because `/dev/battle` is gated off in production builds. No new marketing claims.
- Footer links: the three external URLs are the ones already verified (chog.xyz, chogathon.chog.xyz, opensea.io/collection/chog-genesis). There are no verified social accounts, so the two DESIGN.md social squares are dropped and there are no social buttons. In-page anchors point at the five finished sections.
- Art: only approved class art. Warden, Reaver and Scout peeking over the front ridge at 18, 66 and 82 percent, with a visible chip outside the aria-hidden scene reading "Commander class art / Shared by every commander of these classes. Not a specific NFT." The scene's hills are CSS scallops, not the DESIGN.md fur artwork, and that is a known gap.
- Motion: hills parallax on scroll with the back layers moving less, the mascots rise once with a 120ms stagger and a spring ease, the sun pulses over 6s, the ring turns over 120s, the beads drift. Reduced motion and Save-Data drop every one of them and the back-to-top scrolls instantly.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l7-review/` (shots/, report.json). Screenshots at 390x844, 1366x768 and 1920x1080 for the CTA, the scene and the L6 to L7 transition, plus a full page at 1920 and a reduced-motion frame. No horizontal overflow at 360, 390, 820, 1366 or 1920, no console errors, all 14 footer links and both CTA links resolve, focus ring on the footer links and on the back-to-top button, the document ends on the scene with no white band. Typecheck, lint and one production build green.
- Known deviations: on a 390px screen the three Chogs sit at 16, 52 and 85 percent instead of 18, 66 and 82, because the brief's percentages overlap at that width.
- Corrections applied after the build agent handed back: the honesty chip moved out of the ridge line into the empty sky above it (it was sitting on the Warden's face at 360 and 390), the chip is now aligned to the footer's 1320px content grid, the brand column no longer repeats the two external links that the Project column already carries, and every L7 small-text colour moved from `--color-chog-ink-55` (3.98:1 on white, a real AA failure that DESIGN.md misstates as 5.6:1) to `--color-chog-ink-70` (6.65:1).
- Next: owner review of L7, then L8 season splash only.

## Public site L6 cinematic bento (2026-10-22), awaiting owner review

- L5 approved. Done: `BentoScene` (`#world`) + `BentoGrid` + `bento.css`. A 12-column asymmetric bento inside one white 28px-radius shell on a mist-to-white ground that pulls up into the L5 mist tail. Desktop rows: battle span 8 / deck span 4 (440px tall), then patron, social and lending span 4 (350px tall). Tablet 2 columns, mobile 1 column with the art as a band along the bottom of each tile.
- Art: only approved assets. Battle tile is a tableau: the Reaver class cutout with a violet aura and a soft ground shadow, a Rift Sentry card behind and a Chaos Comet card in front, both cropped by the tile's right and bottom edges, labelled "Commander class art / Reaver". Deck tile peeks Chaos Archer and Hexwing. Patron tile peeks Boulderback. Social and Lending carry inline SVG motifs only, no character art, because nothing is built for them yet.
- Copy: all NEW, not in the messaging doc. Every line is adapted from the doc (5.1, 5.8, 2.4, 7.2, 1.8, 1.3) or read against the shipped ruleset, and all of it needs owner sign-off. "Available now" on the three live tiles, "Coming later" on the two future ones. No ranked, rewards, leaderboard, season, XP, clan or lending-as-live claims, no $CHOG.
- Card frames keep the source art's own proportion, so the two deck cards never read as the same shape. One small gold rule above each status caption is the only gold in the section.
- Interaction: pointer parallax on the art (mouse only), tile lift plus sticker tip and card separation on hover, scroll rise on the five tiles with a stagger, a 10s aura breath on the battle tile. Reduced motion drops the entrance, the hover transform, the parallax and the breath. Save-Data drops the entrance, the parallax and the breath.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l6-review/` (after/, reduced/, report.json). Screenshots at 360x800, 390x844, 820x1180, 1366x768, 1920x1080 plus hover, focus and the L5 to L6 transition. No horizontal overflow, no console errors, no text and art collisions at any width, contrast 4.72 to 17.5. Typecheck, lint and build green.
- Next: owner review of L6, then L7 only.

## Public site L5 feature spotlight grid (2026-10-21), awaiting owner review

- L4 approved. Done: `SpotlightScene` (`#arena`) + `FeatureGrid` + `ChogCardMini`. Six cells on a shared 1px hairline grid (3 cols desktop, 2 tablet, 1 mobile), 12px violet "+" crosshairs at each cell's top-left and bottom-right, per-cell violet spotlight that follows the mouse and rises from .16 to .26 on hover, mini card tilt and lift. Heading "Read the Pulse. Break the Core." (messaging 1.3). No CTA, no focusable elements, no fake controls: the cells are content only, so nothing on the page looks clickable without being so.
- Art: approved v001 READY_STATIC showcase set (boulderback, rift_sentry, chaos_comet, frostshell, chaos_archer) plus the Bulwark commander class template, captioned "Commander class art" like L4. No new artwork, no token likeness.
- Copy: value lines from messaging section 6. Bodies adapted from section 6 and 2.3 and read against the shipped ruleset. Bodies and two value lines are NEW, cited in `copy.ts`, need owner sign-off. "Player progression" was dropped: there is no XP or level system, and match stats plus the casual leaderboard are empty because settlement is off.
- Honesty: section note says the battle, Arena Patron and free route run now, saved match history is not on yet. No ranked, rewards, leaderboard or lending claims.
- Interaction: pointer tracking is mouse-only, so a tap never leaves a spotlight stuck. Reduced motion drops the scroll-rise and the tilt transition. Save-Data drops the 3D tilt but keeps the lift.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l5-review/` (after/, reduced/, report.json). Screenshots at 360x800, 390x844, 820x1180, 1366x768, 1920x1080, plus hover and L4->L5 transition. No horizontal overflow, no console errors. Typecheck, lint, build green, vitest 640/640, /dev/battle free of site CSS.
- Next: owner review of L5, then L6 bento only.

## Public site L4 Collect scene (2026-10-21), awaiting owner review

- L3 approved. Done: `CollectScene` (`#commanders`) + `CommanderSpotlight`: one large commander class card (shared `ChogCard` frame, extracted from L3 unchanged), gold motes, breathing halo, mouse tilt, scroll entrance. A five-class picker flips the card to another class. Cost from `COMMANDER_COMBAT_PROFILE_V1`, role and active ability from `CLASS_ROSTER`. Reaver default.
- Art: v001 presentation-kit commander class sources (READY_STATIC, class_template), hashes match `cards.json`. Four new files in `public/assets/site/commanders/`, Reaver reuses the L2 mascot file. No exact NFT art or token data shown.
- Copy: heading 1.4, lead 2.2, "Play free first..." 4.5. Beats, fairness line and caption are NEW with code citations in `copy.ts`, need owner sign-off. NFT commanders labelled "In testing" (holder E2E never run).
- No CTA: no public commander route exists, `/dev/battle` stays gated.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l4-review/` (after/, reduced/). Lint, typecheck, build green. commanders/combat tests 79/79. /dev/battle regression clean.
- Next: owner review of L4, then L5 spotlight grid + bento only.

## Public site L3 card carousel (2026-10-21), approved

- L2 approved visually. Review corrections committed in `ac9262e`: `data-scroll-behavior="smooth"` set with the site's smooth scroll (Next 16 warning, route transitions animated), quieter Pillar 4 "In development" note, caption reads "Commander class art / Reaver".
- The red "1 Issue" in the owner's screenshots is a hydration mismatch from the Grammarly extension adding `data-gr-ext-installed` / `data-new-gr-c-s-check-loaded` to `<body>`. Not an app bug, not suppressed. Clean Chrome shows 0 issues.
- Done: `CardsScene` (`#cards`) + `ChogCardCarousel`: face-down deck, center card flips face-up, six READY_STATIC presentation-kit v001 cards copied to `public/assets/site/cards/`. Names, costs, types and traits come from live `CARDS_V1` via `site-cards.ts`. Autoplay 4.8s with pause button, pauses on hover/focus/hidden/off-screen, off for reduced motion and Save-Data. Arrows, buttons, dots, swipe and side-card click.
- Copy: heading "Build your first deck." (5.2). Lead and caption are NEW, built from live card counts, need owner sign-off.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l3-review/` (after/, reduced/, full/). Typecheck, lint, build green. Battle UI tests 55/55.
- Next: owner review of L3, then L4 Collect only.

## Public site L2 About scene (2026-10-21), approved

- L0/L1 approved by owner (hero art for development review only, not cleared for launch; wordmark is a temporary fallback; 3000px+ hero master is a pre-launch item).
- Done: `AboutScene` at `#how-the-chog-matters` overlaps the hero fade, white to mist to lilac wash, four messaging pillars as match-loop steps (Reveal, Understand and adapt, Clash, Remember), v001 Reaver commander class art peeking over the pillar panel. Pillar 3 and 4 text ADAPTED for honesty (no ranked; Match Recipe "In development"). All copy and provenance in `src/components/site/copy.ts`.
- Done: Satoshi self-hosted (unmodified official variable WOFF2 + FFL in `src/components/site/font-files/`), Fontshare link removed. Hero wordmark reduced to clamp(42px, 5.6vw, 80px). Hero text rise is transform-only so it counts for LCP.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l2-review/` (after/, reduced/). Typecheck, lint, build green. Battle UI tests 55/55. Local prod LCP 0.7-1.3s unthrottled.
- Next: owner visual review of L2, then L3 card carousel only.

## Public site L0/L1 (2026-10-21), approved

- Doing: public landing page, built in phases from the visual handoff (unzipped outside repo at `C:/Users/USER/Documents/ChogRoyale-Assets/visual-handoff/`). Stop after each phase for owner approval.
- Done: L0 tokens (`@theme` chog-* colors, font-site/data/game), Satoshi via Fontshare link, Georama + Lilita One via next/font scoped to `.site-root`, `MarketingHeader` (transparent to glass, mobile disclosure menu, Escape, skip link). L1 `HeroWorld` with proposed G pagoda image (wide + portrait crop, AVIF/WebP via next/image), scrims, eased fade to white, CSS petals/Ken Burns/scroll parallax with reduced-motion and Save-Data off paths, stub `#how-the-chog-matters` section as anchor target.
- Copy comes from `docs/Chog Royale messaging.md` section 5.1/1.5/2.3. Play CTA goes to `/dev/battle`, which is disabled in production builds unless `NEXT_PUBLIC_ENABLE_DEV_BATTLE=1`.
- Evidence: screenshots in `C:/Users/USER/Documents/ChogRoyale-Assets/site-l0l1-review/after/` (5 viewports, menu, keyboard, anchor, reduced motion, battle regression). Typecheck, lint, build, vitest 640/640 green.
- Next: owner approves L0/L1 screenshots, answers asset/rights questions (official logo, G image rights, higher-res G master). Then L2 About scene only.
- Known: no official logo (Lilita wordmark fallback), G source is only 1672x941 so tablet/phone crops look soft.

## Just finished

- B2.5 two-lane arena (ruleset v4, arena-v2): river, two bridges, RIFT_SHIFT ford, deterministic ground routing, lane objectives, target lock, territory + pocket deploys.
- B2.5 integrity hardening (ruleset v5): troops target commanders, solid structure footprints with detours, octile movement with carried remainder, legal-move bot runner, per-match entity ids, stronger replay tests.
- B2.6a commander card economy (ruleset v6): 7 ordinary + 1 commander card decks, deploy from hand for energy, no tick-0 spawn, hold-while-alive cycle policy, class-keyed runtime profile cp-v1 (free == NFT), tuned via real encounters. 249/249 tests + typecheck/lint/build green. Details in .fast-build/STATE.md.
- B2.6b player-controlled abilities (ruleset v7): the 5 actives fire only from validated AbilityCommands (ae-v1 costs 1/1/1 self, 2/2 area), deploy/onDeath triggers stay automatic, ability_ready/expired events, commanderAbilityStatus for a future button, bot policy botAbility. Full suite, typecheck, lint, build, scenarios, balance, runner green.

- B2.7a deployable buildings (ruleset v8): Rift Sentry (ground-only turret) and Decoy Totem (lure), solid footprints, crossing-mouth clearance, finite lifetimes, building-aware targeting. Full suite, typecheck, lint, build, scenarios, balance, runner green.
- B2.7b tactical cards (ruleset v9): Chaos Comet (delayed blast, 42 structure damage), Rift Snare (slow + chip), Rift Sprites (1e air pair), stale status-percent bug fixed, building matchup harness (npm run buildings:matchup). 295 tests, typecheck, lint, build, all scripts green. Details in .fast-build/STATE.md.
- Mirror fairness (ruleset v10): dev bot made side-neutral (per-player seeded lanes, mirrored depth, alternating first mover), zone band off-by-one fixed, engine mirror check 144/144, side wins now 36/36 and 35/37. Reaver is no longer weakest once the bot is fair.
- B2.7c1 (ruleset v11): Gale Netter (3e anti-air, 40 vs air, 12 vs ground) and Riftbreaker (4e demolition, 66 vs buildings, building-first targeting). Swarm spawn offset mirror bug fixed. v11 matchup (128 games) + engine mirror 128/128 x2. Neon DB test later passed in the full suite. Details in .fast-build/STATE.md.
- B2.7c2 (ruleset v12): Ember Mauler (4e, 220hp, radius-4 ground shockwave around itself, 24/swing, no air). Counters clustered cheap ground pushes; loses to flyers, ranged, tank-led pushes and melee duels. Swarm deck still 64/64 with or without it. Lane-swap check shows the engine and bot are side-neutral; the raw Chaos schedule is not. Full suite 28/28 incl. Neon.
- Ranked Chaos spatial fairness (ruleset v13): raw B1 zones were side-biased (Ember 128/169, Rift Shift 158/172 events across 6 trait sets x 50 seeds; Rift Shift skews to P1 home 139 vs 19). Combat now closes zones under the mirror with budget split. Also fixed Ember Rift damage, which never landed before v13. Raw side swaps 40/48 -> 48/48, lane-swap raw 31/40 -> 40/40. B1 schedules and hashes untouched.
- Neon test stabilization: the 3 assertion failures were leftover legacy fixtures from a cleanup hook that timed out (reproduced exactly). players.test.ts had no TEST routing and wrote to PROD, leaving 7 did:privy:test_ players (5 wallets, 9 roles) on PROD. Fixed routing + VITEST fail-closed guard + endpoint guard + self-healing batched cleanup + 60s hooks. TEST leftovers (4 players) removed. DB files together 58/58, full suite 354/354.
- B2.7c4 (ruleset v14): resource-aware smartMove bot + economy harness (npm run bots:economy). Smart beats simple 34/36. Swarm still dominates under both bots (simple 27/30, smart 30/30). Ablations point at cheap always-useful card density and the 4e scout commander, not energy waste or first-affordable play. Engine fix: footprint detour ties now mirror for P1.
- B2.7c5 calibration (npm run balance:calibrate): Scout 5e, Choglings 3e, Choglings 50 HP tested in isolation. HOLD, no shipped change, v14 kept. Only Choglings 3e moved swarm a lot and mostly under the simple bot. Revised control deck went 4/80 -> 44/80 with unchanged cards. Smart bot is seed-free, so no-Chaos smart samples are 10 distinct games per deck. Details in .fast-build/STATE.md.

## Currently working on

- Latest asset task is frozen after one c001 2D cutout prototype at `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-2d-production/c001-cutout-prototype-20261019-154531/`. Done: approved m001 head retained, 11-layer ORA, linked-PNG SVG, rig JSON/scripts, eight-key walk 800 ms and punch 840 ms, 18 timed GIFs, 96 RGBA PNGs and phased squad previews. `REPORT.md` and `gallery.html` record evidence. Independent preservation passed 444/444. Method is promising, with readable rightward punch at 48/64 px. Candidate acceptance remains blocked by hip/torso joins, ankle cap lines and a short shuffle stride. Zero keyed stance drift and 2 px full-resolution filtered sole fringe apply only to discrete keys. Next: human art/motion review before a production layer set or more facings. Stop this iteration and keep r001/r002/r003 frozen. No atlas, Phaser/phone test, Tripo, 3D changes, gameplay edits or push.
- Latest asset task stopped after the bounded r003 rigid modular alternative at external `chogling-production/r003-modular-animation-20261019-143753/01-chogling-modular-animated.blend`. Done: rigid parts, joint covers, one assembly correction, 48 transparent frames, fixed-scale 128/96/64 px walk/punch loops, 98 integer/half-frame contact/rigidity samples and independent review. Quality remains blocked by exposed hip/knee cuts, shoulder seams and weak small-size punch. All eight GIFs decode to 24 frames/1000ms, 186/186 protected files unchanged. Next: review the failed evidence and use approved-view 2D cutout animation for the next method. Stop this 3D correction path. Intended foot motion is an asset test, not a Phaser/runtime test. No gameplay edits or push for this asset experiment.
- Latest asset task completed with bounded stop at external `chogling-production/r002-final-rig-20261019-061500/07-chogling-corrected-rig.blend`. Done: accepted 254-vertex belly reweight, stronger nine probes, durable packed-material fix verified after reopening, unchanged geometry/topology/UV hashes, preservation 124/124, crossing/clay/native-size evidence. Verdict blocked: right-walk face 2387 area ratio 0.0810277, punch shoulder volume loss and visible crossings. Punch reads guard-like at 128/96 px, bend/punch unreliable at 64 px, squat close to neutral. Next: user reviews blocked evidence before another asset correction scope. No gameplay edits or push. Earlier r001 notes below are source history.
- Chogling r001 cleanup and rig probe are in `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-production/r001-cleanup-rigprobe-20261019-043633/`, separate from the protected source audit at `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-3d-audit/textured-1beb2ae7-20261019-041632/`. Outputs: `04-chogling-cleaned.blend` without rig and `05-chogling-rigged.blend` with rig. Preservation validation passed 53/53 protected baseline files, including all three unchanged source GLBs. No game-code changes, regeneration, or push.
- Final geometry: 8,780 vertices, 10,544 triangles, 5,309 positional-weld vertices across 3 components, 66 boundary edges at the two fitted brow bases only, zero mesh/UV degenerates. Five small original boundary groups were closed with 23 cap triangles; original face-UV hash and packed pixels are unchanged. Crossings reduced 255→231 after caps and shoulder-root adjustment: 207 brow, 18 shoulder-root, and 6 other body pairs. Shoulder-root edit moved 101 internal vertices by max 0.006854; muzzle edit max +0.00587 Y. Do not call the 18 remaining shoulder-root pairs resolved or label them waist crossings.
- Rig probe: 16 bones, 15 deform bones, exactly one armature modifier, zero actions; all 8,780 vertices normalized. Nine static probes found no collapse below 10%, no coincident-seam tearing, head rigidity error max 1.28e-7. Posed body-crossing counts remain 24 neutral, 28 left, 31 right, 31 punch, 28 walk-left, 32 walk-right, 27 lean, 28 head, 39 squat after contact correction. Static stance contacts are about 1e-7, max squat gap 0.000058. This proves a static-deform feasibility prototype, not production animation, IK, or continuous-animation readiness.
- Report and gallery completed. Next asset task: resolve the remaining localized shoulder-root crossings and review texture polish before claiming animation readiness. Keep asset experiments outside the repository and preserve audit/source files.

- Original troop art direction c002 (2026-10-19): Choglings (A Bonk, B Ladle, C Prong) and Boulderback redesigned from the five r001 portraits. Outputs in `C:/Users/USER/Documents/ChogRoyale-Assets/original-troop-concept-review/c002/troop-concepts/`: art bible (A/B/C split), DNA evidence board, two troop sheets, side-by-side validation board, views, approvals (all pending), provenance, preservation check (175/175 baseline files unchanged). Hand-authored SVG, no AI image tool, no Tripo, no gameplay change.
- Next: user reviews c002. Open risks are the Boulderback front crest reading as a halo, the violet head ring reading as a hood, generic Chogling bodies, and no back views. c001 stays rejected.
- A separate session wrote a c002 source study in the parent `c002/` folder (README, character-art-bible, approvals, final-audit). It was left untouched.

- Completed `docs/character-reference-workflow.md`, a proposal for five NFT commanders and two original troops. All five metadata-derived classes and saved derivation hashes match. Original 1000x1000 portraits visually reviewed and preserved outside repo with genuine metadata evidence. Source/API review found no issues. Lint, typecheck, 261 tests, and production build passed.
- Next for asset production: review the workflow, implement the narrow read-only exporter, then approve full-body interpretations and troop concepts before Tripo generation. No exporter, full reference packs, or models generated in this research task.

- No game feature recorded as in progress here. Preserve existing game work in the working tree.
- Local Blender MCP setup verified end to end through scene inspection, `.blend` save, GLB export, and a 384x384 PNG render inspected through MCP. Test outputs are in `C:/Users/USER/Documents/ChogRoyale-Assets/mcp-verification-20261018`.
- Verification uses a separate Blender instance, PID 31608, with the bridge at `127.0.0.1:9876`. Original Blender PID 28880 was left untouched.

## Next up

- B3.1 playable alpha COMPLETE (8fdb762 room + client, c5c70fb drag/touch input). Closing match 0lc82opDV: drag, click, emulated touch, rejections, manual Scout abilities from both players, crowns win, replay hash identical. No PROD match/settlement/legacy writes. Real phone test pending (Chrome emulation only). Details in .fast-build/STATE.md.
- B3.2a loadouts + NFT entitlement (3c1dfca): accepted for planning. Custom-deck browser QA and NFT-holder E2E deferred to community testing, not performed.
- B3.2b unranked matchmaking: code done, automated tests green, human two-browser queue match still pending. Single in-memory MatchCoordinator (one battle-server process). Details in .fast-build/STATE.md.
- B3.2c activity exclusivity + 30s reconnect grace with Privy re-auth and rotating resume token: code done, tests green, browser reconnect test pending.
- B3.2d account-saved loadouts: code done, migration 0007 applied to TEST only, PROD migration needs user approval. Browser QA pending.
- Next: approve PROD migration, browser checks for B3.2a-d, then B3.3 settlement.
- User review of the B2.7c5 hold. Swarm and breaker share a cheap core (choglings, sprites, snare, archer, guardian, scout) and both still beat revised control 0/16. Spawner building still waits on that review. No matches have been written to any database.

## Known issues / open items

- PROD has 7 leftover test players (did:privy:test_<8hex>, created 2026-10-18 13:42-17:00) with 5 wallets and 9 roles from the unrouted players.test.ts. Deleting them needs explicit user approval. Real player (did:privy:cmvcak...) untouched.

- Balance is bot-measured only (32 games/class). v11 round robin: bulwark 15, reaver 19, deadeye 23, scout 13, warden 10 (v10: 16/18/18/15/13). Earlier reaver 9/32 came mostly from the biased bot. Commanders rarely outlive one cooldown in bot play.
- Units have no unit-unit body collision yet (overlap allowed).

- Human E2E at `/dev/onboarding` still unverified (Privy login, wallet sync, claim flow).
- Public-gateway throttling returns if ingestion is ever re-run hard; use single-stream path.
- `commanders/[tokenId]` for 1969 returns pending-404 style response only if metadata missing; all resolved now, but handler behavior unchanged.

## Latest asset checkpoint (2026-10-20)

- Doing: finalize approved static gameplay sprite kit v001 at `C:/Users/USER/Documents/ChogRoyale-Assets/gameplay-sprite-kit/v001/`. This checkpoint supersedes the earlier static art-review gate. Earlier frozen motion experiments remain historical and blocked separately.
- Done: current v16 roster reconciliation, 28 primary READY_STATIC, zero PROVISIONAL/MISSING/READY_ANIMATED, 25 cards, six VFX primitives for 26 requirements, five exact NFT sources, canonical Phaser manifest and measured scale/anchor manifest. Independent verification passes for all code IDs, 126 RGBA exports (121 transparent cutouts plus five lossless opaque NFT profile PNGs), 181 copied sources and JSON. Final offline previews reviewed, including all six fixed structure instances and 64/96/128 alpha-height comparisons. Presentation spec proposes authoritative-root-safe child transforms without implementation.
- Next: consume the static handoff in a separately scoped Phaser prototype, then verify gameplay readability, effect timing and a real phone. No runtime or phone validation has occurred. No new frame animation, atlas, Tripo, 3D, gameplay, backend, DB change or push in this task. Preserve concurrent game changes.

## Chaos Crossing arena v001 (2026-10-20)

- Done: external `C:/Users/USER/Documents/ChogRoyale-Assets/arena-worlds/chaos-crossing/v001/`, 13 aligned layers, eight defender poses plus eight derivatives, reusable tower/Core effects, mobile/desktop/battle/state previews and stable manifests. Engine arena-v2 geometry matches supplied100x160 baseline exactly. Final offline package validation passes,404 previous-kit files unchanged.
- Status: PROVISIONAL for visual acceptance. Ready for isolated Phaser visual prototype only. Defender east/southeast facing, Core rooftop seating, pose continuity and tiny mobile silhouettes remain unresolved. No runtime/device test, game/backend/DB edits, Tripo, Blender or push.
- Next: inspect `gallery.html` and `REPORT.md`, then separately authorize renderer integration. Preserve conditional ford using authoritative frame.riftOpen and keep source coordinates authoritative. Current500x800 renderer needs documented transform and cell-band convention reconciliation.
## Chaos Crossing v002 P0 polish (2026-10-20)

- Done: external arena-worlds/chaos-crossing/v002,16 aligned layers,18 separate mount images,12 static defender states,34 half-size texture candidates, fixed390x844/1440x1000/busy/before-after previews, stable-ID migration and measured anchors. Geometry unchanged, river/bridge files byte-identical to v001.481 protected prior-package files unchanged.
- Verdict: P0 PASS for offline static art/package handoff, ready for Phaser integration. New north/south aim drawings remain acceptance candidates, not continuous aiming or animation. Small overview defender detail, pose transitions, depth/health bars, real-device readability, event timing and renderer half-cell bands still require integration review. Raw RGBA texture estimate157.27MiB to39.32MiB is not a benchmark.
- Next: use external gallery.html, README.md, REPORT.md and manifests/layers.json plus mounts.json/display-proposal.json. No game/backend/DB changes, Tripo,3D, other worlds or push. Preserve concurrent engineering work and all v001 files.
## Gameplay presentation kit v001, both P1 milestones (2026-10-20)

- Done: external gameplay-presentation-kit/v001,20 ordinary playable card portraits +5 generic commander class cards READY_STATIC,5 exact NFT identity examples separate.10 ability +8 status icons and2 optional squad/spawner variants PROVISIONAL. No missing main card art.
- Done:32 READY_ANIMATED VFX,256 distinct transparent frames,32 matching strips/per-effect GIFs,10 PROVISIONAL child-motion templates. Six unique approved primitives reused through12 role copies. Combined offline proof100frames/10s600x1100 GIF+MP4, not combat replay.
- QA passed594PNGs,978manifestrefs,15doclinks,641prior-pack files unchanged. Compatible concurrent BattleHud source drift is an explicit provenance warning, captured hashes retained. Unrelated HUD/registry/probe working-tree changes preserved.
- Next: canonical manifests/presentation-kit.json and README.md. Asset integration can start.18 icons/2 variants need acceptance, six VFX bindings MISSING and26 PROVISIONAL. Ordinary attack/hit and tower/Core fire events absent, projectile snapshots are target positions without source/origin/arrival. Runtime/device/timing/cleanup remain untested. No game/backend/DB edits,Tripo,3D or push.
