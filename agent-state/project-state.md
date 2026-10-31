# Project State

# Desktop lobby Battle Deck card layout (2026-10-31)

- Desktop `/app` keeps its existing four-column, two-row Battle Deck rail. Cards now give art a fixed flex box and keep proportional full art separate from a fixed two-line name/type footer. The cost badge remains at the top-left. Overrides stay scoped to `.app-home`; mobile and A2 Decks styling are preserved.
- Verification: focused LobbyView structure test 1/1, TypeScript, scoped ESLint and production build pass. Full ESLint still reports existing errors in review `.cjs` scripts and clan/messages route tests.
- Delivery: branch `codex/desktop-battle-deck-fix` is pushed at `b9a47a01e685d7180bfcfb0b10edbdf41ed177a6`; PR #22 is open. Latest Vercel preview is Ready. No production deployment.

# Mobile UX / app-shell / PWA polish pass (2026-10-30)

- Home follow-up on `codex/lobby-resources-xp-polish` from merged main `a67c7ac` adds a nonblocking authenticated resource summary, Gold earning disclosure, clickable Account XP bar, stronger shared expanded level module, and scoped two-column desktop lobby. CSS Modules now bypass the Tailwind loader so their visual classes reach the browser. Labeled fixture screenshots and acceptance notes are in `docs/home-progression-polish.md`. Checks: 108 tests, TypeScript, scoped lint and build passed. PR #19 is already owner-merged, so this slice has a new review branch.

- PR #19 follow-up synchronizes current main and limits AppOpening to the initial layout entry. Native modal isolation and forward/reverse keyboard containment replace the previous visual-only dialog overlay. Browser checks cover fresh entry, client navigation return, direct invite bypass, Skip and Escape.

- Working tree contains a scoped mobile shell pass based on the merged V2.2 content. No merge or deployment performed.
- Account Level now has reusable card and embedded presentations. Profile puts the module near the top on mobile and in the desktop side column. Progress keeps one coherent Account Progress panel.
- App shell adds safe-area viewport support, a compact native mobile overflow menu, Friends-to-Profile nav mapping, and a short branded opening overlay on exact `/app` entry. Direct battle/invite routes are not blocked. Reduced-motion users skip the blocking delay.
- Audio gesture recovery re-arms after visibility changes or later AudioContext suspension without changing mute or zero-volume preferences. Snap-like media-query guards support missing `matchMedia` and legacy listener APIs.
- Verification: focused UI/audio/media tests 73/73, scoped ESLint has no errors (CSS is intentionally ignored), TypeScript and production build pass. Browser checks at 390x844 and 1366x768 confirmed the opening route, direct battle route bypass, and no horizontal overflow under the local unauthenticated gate.
- Limits: no authenticated Privy session, installed iOS PWA, physical Safari, or Snap Mini Browser was available. Report those as unverified rather than live acceptance.
- PR #20 follow-up `2d448c9` adds a 560ms confirmed-XP width transition with a reduced-motion opt-out. The earlier red `1 Issue` badge was a Grammarly body-attribute hydration warning in the development browser. Clean in-app and production-shell captures show no badge. PR #20 remains open and unmerged.
- The Gold disclosure now closes on pointer input outside its native `<details>` control. The disclosure keeps inside clicks, keyboard activation, and the existing Earn Gold link behavior.

# V2.2c-2 Account XP battle result UI (2026-10-30)

- Working on existing PR #18 branch `codex/v2.2b-player-account-level-ui`, starting from reviewed head `7b9a480`. No merge, production deployment, migration, flag change, or battle-server action performed.
- Added match-scoped `account_xp` receipt handling in BattlePanel, exact source/player/match validation, monotonic pending-to-confirmed reduction, room isolation, bounded authenticated readback with cancellation, and explicit unavailable handling.
- Added shared Account XP reward presentation model/tests, distinct result panel, server-snapshot level-up celebration with max-level copy, ARIA status, and reduced-motion styling. Gold, Card XP, settlement, Practice, Private, and Ranked behavior remain isolated.
- Verification: focused reward/result/queue suite 105/105, TypeScript, scoped ESLint, production build, and diff checks pass. Authenticated live result and responsive screenshots remain owner-gated because no Privy session is available in this workspace.
- Delivery: commit `1ab5a58d4e0d173bc35785660110dbf2cb9d4863` is pushed to PR #18. Vercel preview `dpl_EXGimjEZmvHsUucMwoeECyWqHfb2` is READY and serves `/app/play`, `/app/play/battle?mode=practice`, `/app/play/battle?mode=unranked`, and `/app/progress` with HTTP 200. PR remains open and unmerged.

# V2.2b Player Account Level UI (2026-10-29)

- Branch `codex/v2.2b-player-account-level-ui` is based on V2.2a `ef32d97` plus the reviewed account-XP client model checkpoint `bafcd29`. Implementation commit `ffaf65a` is pushed on PR #18 and remains unmerged.
- Added strict authenticated Account XP response validation, shared Profile/Progress Account Level presentation, authoritative threshold progress, level milestones 1/10/25/50/75/100, and recent verified award rows.
- Account XP states stay explicit for loading, disabled, auth, onboarding lock, migration/503, network, malformed, and unavailable reads. No production migration 0026, flag activation, deployment, or player-data write was performed.
- Focused Account XP and Progress tests pass 55/55, scoped ESLint, TypeScript, production build, and diff checks pass. Vercel preview `dpl_989ChNPA2oudZ5ggd4htYp17wPp7` is READY. Authenticated Account XP UI acceptance remains owner-gated.

# V2.1j Unranked AI Card XP UI (2026-10-29)

- Branch `codex/v2.1j-bot-card-xp-ui`, commit `50d136c`, PR #17 is open against `main` and awaits owner approval. No merge, backend deployment, migration 0025, flag change, or balance change was performed.
- Added strict match-scoped `bot_card_xp` validation and monotonic lifecycle handling, confirmed-only result presentation, card reward rows, and authenticated `/api/players/me/card-xp` readback status.
- Solo Practice remains reward-free, human PvP remains unchanged, and Gold UI remains authoritative. Battle tests 240/240, focused reward/result/queue tests 64/64, typecheck, scoped ESLint, and production build pass. Vercel preview for `50d136c` is READY.

# V2.1i Recovery and completion (2026-10-29)

- Current branch: `v2.1i-bot-card-xp`. Existing local V2.1i backend work preserved and completed without resetting unrelated changes.
- Bot Card XP uses replay-verified `bot_matches` evidence, a separate idempotent ledger, shared Gold-confirmed eligibility, the existing card progression ladder, and a six XP per match cap. Solo Practice, pre-flag evidence, PvP settlement, and Gold behavior remain isolated.
- Added the default-off `UNRANKED_BOT_CARD_XP_ENABLED` release gate, requiring the Gold flag. The service singleton now shares restart reconciliation and shutdown, and pending runs close when Gold reaches refusal or cap.
- Verification so far: TypeScript passed, focused Bot Card XP tests 8/8 passed, Bot Gold tests 12/12 passed, live flag wiring 2/2 passed, scoped ESLint passed, and the production build passed. One fresh full-suite attempt timed out after inherited TEST-branch residue failures in legacy (3), clans (1), Gold reconciliation (1), and card-XP reconciliation (3).
- TEST migration 0025 was applied with `scripts/migrate-test-run.ts`. No PROD migration, flag activation, deployment, restart, or player-data change was performed.

# V2.1h Unranked AI Gold UI (2026-10-28)

- Current branch: `codex/v2.1h-unranked-ai-gold-ui`, based on `v2.1g-bot-gold` at `95899c5`. Frontend-only, reward flag OFF, migrations 0023/0024 untouched.
- Added strict `bot_gold` validation and monotonic message handling, late delivery after `end`, fallback provenance and match-id isolation, confirmed-only `/api/players/me/gold` refresh, and result reward states for confirmed, duplicate, pending, capped and refusal outcomes.
- Solo Practice remains no-reward, human PvP settlement is unchanged, and fresh searches/reset clear prior reward state. No authenticated live reward acceptance is possible while the production flag remains OFF.
- Checks: focused reward/queue/result tests 54 passed, the full battle-surface suite 216/216 passed, TypeScript and scoped ESLint passed, and the production build passed after the stale-receipt fix. Branch head `4a19f41` is pushed on PR #16, https://github.com/Devendurance/ChogRoyale/pull/16. Preview is building, production remains the prior main deployment. Merge and production promotion remain owner-gated.

# V2.1f P0 blank-screen hotfix (2026-10-28)

- Current branch: `codex/p0-unranked-ai-handoff`, based on `origin/main` merge `4409cd9`.
- Queue handoff now claims the match before awaits, attaches the reserved room before queue cleanup, ignores duplicate match_found and late queue closes, and disposes late reservations after cancellation.
- Practice and PvP rooms support authenticated idempotent `lobby_sync` snapshots. The client retries hydration for 2.5 seconds, shows `Preparing your battle...`, and fails visibly with a Battle Hall recovery action instead of a blank shell.
- Focused lifecycle and room tests pass 40/40. TypeScript and scoped lint pass. Backend sync code needs the matching VPS deployment before the server-side replay guarantee is live.

# V2.1f Unranked AI fallback frontend (2026-10-28)

- Current branch: `codex/v2.1f-unranked-fallback-ui`, based on `v2.1e-unranked-fallback` at `8a2befd` plus reviewed V2.1f commits.
- Human-first queue now renders an advertised-only fallback countdown, validates the server fallback handoff before consuming its reservation, and keeps cancellation, timeout, and stale async work from handing off later.
- Unranked fallback keeps route intent `unranked` separate from server room mode `practice`, uses `practiceOpponent.source === "unranked-fallback"`, and stores resume credentials in `b3.unranked-fallback.resume` separately from solo Practice and PvP.
- Lobby, HUD, result, and Find Opponent Again copy identify the server-owned AI and preserve no-reward behavior. The backend fallback flag remains OFF. Live authenticated fallback acceptance is intentionally unverified.

# Owner-supplied battle music production release (2026-10-28)

- Current branch: `codex/owner-battle-music`, based on latest `origin/main` `e6e4c8f7`.
- Verified `.audio-dev/battle-loop.mp3` and copied the exact SHA-256 `5BC878DD9C4B809CAA500DA01BF33848BC1FC280E5C5047A2FDCF4FE97B8B24C` into `public/assets/audio/v001/music/battle-loop.mp3`.
- Track B is now production-enabled in the shared audio controller. Track A remains lobby/ready-room music. Owner asserts purchased usage rights. Original Mrthenoronha/Freesound 520710 and CC BY-NC 4.0 metadata remain explicit, with purchase proof absent from the repository.
- Focused audio tests 27/27, typecheck, scoped ESLint and production build passed. Next: commit, push, open and merge the owner-authorized PR, then verify Vercel and public asset HTTP 200.

# V2.1d Practice difficulty selector (2026-10-28)

- Frontend branch `codex/v2.1d-practice-difficulties` starts from V2.1c `8385910` and preserves the server-owned medium, hard, and ultimate Practice policies.
- Added accessible Medium, Hard, and Ultimate radio cards on `/app/play/battle?mode=practice`. BattlePanel sends `{ difficulty }` only to `battle_practice`, adopts the lobby/start descriptor, and reuses it for reconnects and fresh Battle Again rooms.
- Lobby, HUD, and result use fixed `AI Opponent` identity and server-confirmed difficulty. Practice remains no-reward and PvP/ranked paths are unchanged.
- Focused UI/identity/result tests 49/49, Practice server tests 23/23, typecheck, scoped ESLint, and production build pass. Real authenticated matches remain owner-gated.
- Next: commit and push the scoped branch, open the V2.1d PR, merge only through the approved GitHub workflow, and verify Vercel Production.

# V2.1b Practice Mode UI (2026-10-28)

- Frontend branch `codex/v2.1b-practice-ui` starts from V2.1a `54c3ad6` and preserves the live `battle_practice` backend.
- Player flow: `/app/play` Practice Arena card -> `/app/play/battle?mode=practice` -> Medium-only real Colyseus practice room -> existing deck/commander ready room -> existing battle HUD/result.
- Practice is no-reward and bot identity is server-owned `AI Opponent`. Resume storage is separated from PvP, and Battle Again creates a fresh room.
- Verified: focused UI/identity/result 37/37, Practice server 8/8, TypeScript, scoped ESLint and production build pass. Live authenticated Privy match remains unverified.
- Next: commit/push, PR to main, verify Vercel Production and integrate after checks.

## Final audio overhaul (2026-10-28, delivery)

- Doing: delivered PR #9, https://github.com/Devendurance/ChogRoyale/pull/9, on codex/final-audio-overhaul from main 6907259. No merge or production promotion authorized.
- Done: persistent shared music/UI/battle mixer, 16 original procedural UI cues, server-confirmed interaction mappings, settings, legacy silence migration, cancellable music transitions and recovery. Track A is CC0 production lobby music. Track B remains CC BY-NC development-only.
- Checkpoints: 0190ec5 scope/state, b2d9c1f credited assets and 4ee0d88 reviewed integration pushed. Coordinator reviewed core, UI and assets from GPT-5.6 Luna/xhigh workers.
- Acceptance: 110 tests passed, clean production build passed. App browser checks 6/6, UI checks 15/15, real-provider audio phase assertions 7/7. Production smoke 17 assets 200, dev battle endpoint 404, no restricted bytes in 93 traces or injected QA strings in production chunks.
- Multiplayer: actual local engine, injected auth, shuffled seats 1/0, same-room refresh recovery, Endychog 2-1 Phantom result at 3:07. Playback remained unproven in that match; separate real-WebAudio phase fixture proves transitions. Final return assertion in the match harness used the wrong URL expectation.
- Limits: physical iOS/Android/PWA and subjective speaker/headphone listening remain unverified. ElevenLabs account is Free tier, no ElevenLabs output generated. Full lint retains 24 inherited errors/one warning.
- Checks: standalone typecheck and scoped lint passed. Next: owner review of PR #9, commercial permission before production Track B, physical-device/listening acceptance. Details in docs/audio/acceptance.md. QA aliases/routes removed, own 3100/2568/3101 services stopped, original 2567 untouched.
- Preserve unrelated .fast-build/STATE.md, DESIGN.md, demo-production/, messaging doc and V2 improvement plan. External source/QA evidence is under ChogRoyale-Assets/audio-overhaul-20261027.

## Gameplay improvement V1 README bookmark (2026-10-27)

- README uses a genuine Drive-generated thumbnail from the owner's recording and opens its `/preview` player. Local `docs/media/readme/gameplay-improvement-v1-thumbnail.jpg` is the unchanged 61,206-byte Drive JPEG. The recording is 560,116,091 bytes, so playback stays in Drive. PR #8: https://github.com/Devendurance/ChogRoyale/pull/8.
- PR #7 was merged by the owner, main `9dd3866`. New documentation branch `codex/gameplay-improvement-v1` starts from that main. No new merge or production deployment authorized.

## Final UX polish (2026-10-27)

- Approved PR #6 merged at `e985247a89396eec2dd69c8bc65b7a0b87c7596a`. Vercel production `dpl_16rc2SKp9n7ASUdjossrCRhPJkUN` READY, alias chogroyale.vercel.app. New manifests and sampled sheets return 200.
- Branch `polish/final-ux-identity-share` from updated main: scoped Friends composition, copy/native-share invites and automatic authenticated room join with setup return, official crown images, self-left HUD and self-top results.
- Delivered PR https://github.com/Devendurance/ChogRoyale/pull/7. Final 222 tests, changed lint/typecheck/build pass. Both real injected-auth seat permutations and invite refresh verified, plus 36 presentation cases. Acceptance/screenshots/file list in `docs/final-ux-polish.md`. Real-device/Privy/NFT/settlement acceptance remains unverified, full lint has 24 inherited errors.
- Server/gameplay/account/economy/NFT behavior unchanged. New polish PR is delivery only, no merge or production activation.

## V3 release acceptance (2026-10-27)

- Rift Sentry presentation replays the server fire rule (`stepSentry` in `unit-anim.ts`) and shows a shot only on an observed HP or shield drop. Packer per-unit `down` repacks upscaled sheets from 2x masters. Live match textures total 86.8 MB (units 33.9, arena 34.6, VFX 1.4). Commander lazy-load deliberately not done (8.3 MB, opponent class unknown until deploy).

## Final 3D assets (2026-10-26, branch visual-overhaul/v3-final-assets)

- Buildings, five commander classes (`commander_<class>`) and `burrow_scrapper` animate from the `chog-units/v001` manifest (22 sheets, 31.9 MB RGBA) with v001 static fallbacks. Battle VFX pack in `public/assets/battle-vfx/v001` with pure planners in `battle-vfx.ts` and `vfx-layer.ts`. Readiness doc section 16.

## Official branding v1 (2026-10-26)

- Logo pack v1 installed from `public/assets/brand/v1` (stacked opening, horizontal header, crown footer). Installable app identity via `src/app/manifest.ts`, `favicon.ico`, `icon.png`, `apple-icon.png` and `public/icons`. Main includes V3 (PR #3) and LICENSE (PR #4).

## Visual overhaul v3, slice 4.1 (2026-10-26)

- Seven troop models corrected toward their cards (Frostshell, Rift Runner, Sparkcaster, Gale Netter, Riftbreaker, Chaos Archer, Chog Guardian). Clip counts and timing unchanged. Twelve sheets 16.7 MB RGBA. Readiness doc section 15.
- Card art: original 2D illustrations everywhere (owner decision). 3D models are battlefield units only. Static fallback troops fade on death again.

## Visual overhaul v3, slice 4 (2026-10-26)

- All twelve troop cards animate from v001 sheets (front and rear views, five clips each) with new 256 card portraits and v001 fallbacks. New sources `build_roster.py` and `roster_lib.py`. The rear view of Slice 4 units mirrors the whole model (`mirror_geo`). Flying units hover. The manifest adds ruleset `hitsAir`/`air`, and `engagedFoe` counts air foes only for `hitsAir` units.
- Twelve sheets total 16.5 MB RGBA and 3.2 MB on disk, all loaded at scene start. Readiness doc section 14 records the details and limits.

## Visual overhaul v3, slice 3.1 (2026-10-26)

- Same v001 unit package, manifest path and Phaser wiring. Both models refined toward cards 01 and 03. Every clip now has a front and a rear three-quarter view in one sheet (`clips` then `rearClips`), chosen by `nextView()` from screen-space heading. Sheets are near board resolution (Choglings 592x592, Boulderback 800x990, about 4.6 MB RGBA total).
- Animated units use an open hit ring around the body. Readiness doc section 13 records the details and limits.

## Visual overhaul v3, slice 3 (2026-10-25)

- Choglings and Boulderback animate from pre-rendered sheets in `public/assets/chog-units/v001` (idle, move, attack, hit, defeat; one front three-quarter view mirrored on X). Source in `tools/blender/chog-units-v001`, masters in `ChogRoyale-Assets/chog-units-v001`.
- `unit-anim.ts` picks frames from authoritative data only (stationary with a ground foe in ruleset reach = swing, HP drop = hit, removal = defeat). BattleCanvas falls back to the v001 static sprite per unit. New 256x256 card portraits are served first with v001 portraits as fallback.
- Troop and building allegiance markers use the tower `TEAM_COLORS`. Readiness doc section 12 records the details.

## Visual overhaul v3, slice 2.1 (2026-10-25)

- Same v003 package and manifest schema, re-rendered from refined scripts. Defender identities corrected against cards 21 and 07, towers and arena polished. Weapon anchors, pivots, ground anchors, geometry projections, ripple layers and Chaos overlays unchanged. Only health-bar tops moved 2 to 5 board px. Runtime size about 1.8 MB.
- Readiness doc section 11 records the changes and limits.

## Visual overhaul v3, slice 2 (2026-10-25)

- Reference pack v1 sits at the repo root (`Chog_Royale_Devin_Asset_Reference_Pack_v1/`). It's reference only, every file `game_ready: false`, and its art bible is identical to the v3 handoff.
- New runtime arena `public/assets/arena/chaos-crossing/v003`: 12 procedural Blender layers plus the v002 chaos overlays, all camera-space, and four team mounts (`lane-red`, `king-red` Bulwark aiming south; `lane-blue`, `king-blue` Chog Guardian aiming north). Importer `scripts/import-arena-v003.ts`, sources in `ChogRoyale-Assets/arena-worlds/chaos-crossing/v003`.
- Renderer prefers v003 and falls back to v002. Schema 2 manifest fields: `layer.space`, `authoredTeamColors`, `structureMounts`, `placement.kind`, `artTopLocalBoardPixels`.
- Full asset queue in `docs/chog-asset-production-manifest.json`. Choglings and Boulderback atlases come next.

## Visual overhaul v3, slice 1 (2026-10-25)

- Handoff v3 lives at repo root (`Chog_Royale_Visual_Overhaul_Handoff_v3_CORRECTED/`). Readiness report in `docs/chog-visual-overhaul-readiness.md`: all 25 cards map to repo ids, commanders are domain classes, `burrow_scrapper` is an extra spawned sprite, and no approved-style asset exists yet.
- `arena-registry.ts` gained `TEAM_COLORS`, `CAMERA_SPACE_LAYERS`/`layerFlipY`, `teamTrimHalves` and `defenderCue`. `defenderPose` now always returns the directional aim for live defenders that are aiming, firing or hit.
- Presentation only. No geometry, pointer mapping, gameplay, server or asset file changes.

## Battle identity and perspective hotfix (2026-10-25)

- Root cause: BattlePanel read `lobby.players[start.seat]`. Lobby players are indexed by join slot, battle seats are shuffled at start, so a swapped shuffle showed the opponent's name as your own on both devices.
- Fix: `battle-identity.ts` resolves self/opponent/seats. Server `StartMessage.self` (optional, additive) carries the own verified username, so reconnects without a lobby still name the player. Older servers fall back to the lobby by join slot.
- Polish: compact phone header with icon sound toggle and volume popover, card names sized to fit, empty ability row collapsed, commander identity grouped with its ability on desktop, mirrored side columns, result Winner badge in the name row.

## Battle Experience V2 (2026-10-25)

- Codex V2 foundations kept: BattleLobby, BattleResult, CrownCelebration, crown-presentation, GameIcon, crown chime. Devin pass added `battle-result-model.ts` (finale view, settlement states, tally) and `commander-candidate.ts` (ready-room NFT labels), both pure and tested.
- Presentation-only scope. No server, settlement, economy, migration or auth changes. Ranked stays closed.


## Responsive UI and audio rescue (2026-10-25)

- Reused BattleHud/Phaser and Colyseus callbacks. Four readable portraits plus secondary next, intact word labels, visible low-energy art, centered desktop board, compact ability and stable selection geometry. Private entry has Create/Join with Code, Unranked has Find Opponent.
- BattleAudio now reports actual readiness, unlocks in entry gestures, handles interrupted contexts, adds original filtered percussion, bounds voices and mixes through a compressor. No proprietary audio or server/combat changes.
- Exact-component presentation fixtures cover all requested sizes. Physical iOS and authenticated two-player acceptance remain separate. Final verification and deployment recorded in docs/responsive-audio-rescue.md.

## P7a production-safe multiplayer host (2026-10-24)

- Explicit activation replaces the NODE_ENV refusal; dev boot unchanged. Health probe, drain hooks, gate-default table, and single-replica constraint documented in `docs/P7a-hosting.md`. No combat/economy/migration changes, no Ranked activation, no deploy.

## P7a stops here. Remaining owner-gated prerequisites: host selection, WSS domain, TLS proxy, secret env, PROD migrations 0010-0022, Privy prod config, settlement activation, ranked abuse policy, live two-player and NFT-holder acceptance.

## P6e.2 economy forensics and recovery safety (2026-10-24)

- Five fixture helpers hardcoded `level: 10`; fixed to `cardLevelForXp(xp)` with a regression test (all test-only, no policy change). Audit gained a `settlement-evidence` coverage check so reconcile candidates are separated from fixture residue.
- Live TEST now holds 141 evidence-less fixture matches plus stalled-cleanup residue from this slice's own reruns (3 negative-balance players); all flagged as residue, none repaired. Full account in `docs/P6e-forensics-recovery.md`.

## P6e.1 economy integrity and abuse audit (2026-10-24)

- Pure audit library plus SELECT-only TEST-guarded operator CLI with human and JSON output. Checks settlement coverage, pending Gold/XP/trophy awards, derived Gold balances, sponsorship receipt/spend match, orphans, duplicates, XP/level invariants, ranked delta/balance rules, plus review-only suspect-match and gift-risk signals with documented false positives.
- Live TEST evidence: no settled matches, no suspect patterns, 2 fixture-shaped XP violations (xp=0/level=10) flagged FAIL with no auto-repair. P6e.2 plan records healers, idempotency, and approval gates.

## P6d card gifting and upgrade sponsorship UI (2026-10-24)

- Added `/app/gifts` with accepted-friend eligibility, original ordinary-card selection, server quote, Gold balance, confirmation, idempotent sponsorship submission and sent/received receipt history. Domain 200 refusals remain distinct from sponsored or duplicate confirmation.
- Quote and mutation values remain server-authoritative. The UI never derives friendship age, recipient XP, Gold or caps, and never exposes party identifiers. Friends and Profile link to gifting. No backend or production schema changes.
- Focused model tests 7/7, typecheck, scoped ESLint and production build pass. P6c route tests reached 13/14 before a TEST Neon connection timeout. Browser fixture route returned 200 with the honest Privy loading gate at 390x844 and 1366x768, with no console errors or overflow. No live gifting claim.

## P5f.2 NFT commander lending UI (2026-10-24)

- Added `/app/loans` with server-backed authenticated loan creation, accepted-friend selection, 1-7 day duration, idempotent retry keys, active lent/borrowed views, history, detail refresh, revoke/return confirmations and neutral auth/conflict/service states.
- Extended the existing commander eligibility read with loan-aware `basis`, `ownership` and expiry metadata using the existing entitlement resolver for borrowed candidates. Deck selection now labels OWNED, BORROWED and LENT, blocks unavailable or expired choices, and keeps the saved claim contract unchanged.
- Focused model tests 38/38, typecheck, scoped ESLint and production build pass. Browser fixtures at 390x844 and 1366x768 render the honest unavailable state because local Privy/schema access is unavailable. No live mainnet NFT acceptance or PROD write was performed.

## P5d.2 clan UI and social integration (2026-10-24)

- Added `/app/clans` using the P5d.1 server-owned clan, roster, invite and governance routes. Clan creation/editing, pending invitations, accepted-friend invites, roster roles, leave/archive, removal and transfer all reread authoritative state after mutations and preserve verified state on failed refreshes.
- Added accessible native confirmation dialogs, role-gated controls, neutral auth/service/conflict errors, capacity display and a Profile account action. Five-tab navigation and HUD width remain unchanged. Focused model tests 4/4, typecheck, scoped lint and production build pass. Browser fixture is unauthenticated and Privy app-config fetch aborted, so no live clan acceptance claim.

## P5d.1 clan membership and governance backend (2026-10-24)

- `clans` (name/tag/tagKey-unique/description/owner/status), `clan_members` (PK pair, roles), `clan_invites` (partial unique pending per clan+target, 7-day expiry) via migrations 0017-0019, TEST only. One-active-clan via `players.activeClanId` plain uuid (no FK: FK closed a tsc inference cycle) with conditional single-statement claims. Owner/officer/member matrix, neutral errors, history retained on archive. 11 routes under `/api/players/me/clans`. Tests 20/20, regressions 52/52, typecheck/lint/build green. No PROD writes, no push, no UI.

## P5c private messaging UI and social integration (2026-10-24)

- Added `POST /api/players/me/messages/conversations` using the existing canonical-pair DAL, accepted-friend check and bidirectional block guard. Unknown, incomplete, pending and blocked peers return one neutral unavailable response. Route tests cover auth, self/invalid input, concurrency, no-message creation and spoof resistance.
- Added `/app/messages` with server-backed inbox, conversation view, mobile back flow, cursor pagination, visible bounded polling, recipient-only read acknowledgement and plain-text 1,000-character composer. Failed sends retain the draft and UUID key for retry. Friends accepted rows and the shared HUD link to the route. No sixth bottom-nav tab was added.
- Verification: focused messaging plus Friends model tests 15/15, opener route 6/6, messaging DAL 15/15, typecheck and scoped ESLint pass, production build pass. Full lint retains one pre-existing P5b `no-explicit-any` error and one existing `/dev/progress` image warning. Browser fixture smoke at 390x844 and desktop shows truthful service-unavailable state with no console errors. Live authenticated messaging remains pending. Local checkpoint pending.

## P5b real private messaging backend (2026-10-23)

- `dm_conversations` (canonical pair, unique) + `dm_messages` (sender-verified, per-sender idempotency key, 1..1000 chars, read_at once-only) via migration 0016, TEST only. Guards at write boundary: accepted friendship + both block directions; block races caught by post-write re-check that removes only a fresh insert. Receipt means stored, never delivered-to-device. Inbox hides blocked pairs, keeps unfriended history; history durable across block/unfriend. Single-instance 20/min send throttle (RATE_LIMITED 429). Routes under `/api/players/me/messages` (list, send, fetch, read). Tests 19/19 new, regressions 33/33, typecheck/lint/build green. No PROD writes, no push, no UI.

## P5a player blocking and social safety (2026-10-23)

- Directional `player_blocks` (migration 0015, TEST only) with unique blocker/blocked pair and no-self check. `blockPlayer` ends friendship/pending rows then inserts idempotently; unblock never restores. `sendRequest`/`acceptRequest` refuse across blocks with neutral FORBIDDEN; search and list hide blocked pairs. `canSociallyInteract` guards both directions for reuse by messaging/clans/gifting/lending. Blocks APIs under `/api/players/me/blocks`; friends UI gains confirm-to-block and blocked list with unblock. Tests 16/16 new, 17/17 Friends regressions green. No PROD writes, no push.

## P4b character animation and battlefield motion (2026-10-23)

- The v001 runtime manifest contains 59 static PNG assets and no sprite sheets or animation frames. Reused the existing Phaser sprites with lightweight procedural tween-like transforms.
- Added `battle-animation.ts` for authoritative spawn, attack, hit and death cue projection, duplicate suppression, reconnect priming support and snap-safe interpolation. `BattleCanvas` now adds directional facing, attack windup/release, hit emphasis, spawn/death motion, pooled match-reset cleanup and reduced-motion handling.
- No combat protocol, entity coordinates, VFX, audio, HUD or server code changed. Focused animation/rendering tests 54 passed, typecheck, lint and production build passed. Local authenticated QA remains pending.

## P4a essential battle audio (2026-10-23)

- Battle audio is presentation-only and driven by existing authoritative frame events, command acks and the end message. `BattleAudio` uses short procedural Web Audio tones because the targeted battle paths contain no audio files.
- Added browser-gesture unlock, persisted mute/volume preferences, cue throttling, event identity dedupe, resume priming, and cleanup on reset/unmount. The approved HUD gains a compact Sound toggle and volume range.
- Focused audio/VFX/HUD tests pass, typecheck and lint pass, and production build completes with existing static-page timeout retries. Live authenticated audio QA remains pending. Local checkpoint committed, no push.

## P3b player, patron and NFT progression integrity (2026-10-23)

- Verification-first pass over settled-match progression. Already correct and left untouched: deployment-independent player stats with draws excluded from wins, private/casual/ranked separation (leaderboard matchmaking-only, trophies ranked-only replay-verified), match history caller-side with per-item matchType, deployment-gated NFT commander appearances, v2-only patron appearances with v1 synthetic exclusion, Paragon at 10 distinct patron matches with idempotent/duplicate-safe processing.
- One proven gap fixed: settled ranked matches counted in stat totals but in no byType bucket. getPlayerStats now returns a ranked breakdown alongside private/matchmaking; dev progress page shows the Ranked row. Additive key, existing consumers unaffected.
- Live pool check (read-only patrons:validate): 1969 resolved indexed Genesis tokens, 0 invalid configs, all six themes, 50/50 selection spread; Tier present on all rows, 995 Aura fallbacks by design. No reindex, no writes.
- Verification: progression 10/10 (incl. new ranked-bucket test), stats route 3/3, progress-model 29/29, typecheck, lint (1 pre-existing warning), build green. No PROD activation, no migrations, no push. Local commit pending.

## P3a real Arena Patron NFT sourcing (2026-10-23)

- Battle already locked genuine indexed Genesis patrons (productionPatronSource + lockedPatronFromNft, fail-closed room lock, v2 evidence, legacy re-verification, v1 synthetic exclusion, Paragon at 10 distinct patron_appearances). The fabricated surface was the public read path.
- `/api/arena/patrons/[tokenId]` and its chaos preview now derive through lockedPatronFromNft, so wrong-collection or unresolved rows fail closed (404/422) instead of serving ad-hoc traits. Provenance adds source, chainId, contractAddress and the filtered attribute snapshot. createPatronAssignment adds the chainId check for parity.
- testLockedPatron is now labelled an offline fixture; genuine acceptance goes through the real indexer write/read path. New route test file covers genuine acceptance, wrong-collection/unresolved/malformed rejection, query-trait injection ignored, and preview behavior. Focused suites (7 new + 12 patron-source + 4 patrons DB), typecheck, lint and build green. No combat, Paragon, migration or PROD changes. Local commit pending.

## P2d card inventory and upgrade experience (2026-10-23)

- `/app/decks` collection now renders all 20 ordinary cards with server-backed progression badges, XP readout and max/locked/ready states. Card detail shows purchased level, XP potential, lifetime XP, target, Gold cost and a ten-level track.
- Gold balance is read from the existing card-XP and Gold endpoints. The upgrade POST uses a UUID idempotency key, expected purchased level, server eligibility, bounded retry behavior and a reread after every domain response. Deck editing and save state remain separate.
- PROD/schema-unavailable responses stay explicit and render no invented values. Focused model tests, card-XP/Gold route contract tests, typecheck, lint and build are green. Browser fixtures verified 390x844 and 1366x768 with no horizontal overflow. Local checkpoint: `fd3fbcb`.

## P2c server-authoritative card stat scaling (2026-10-23)

- 20-card profile map (tank-HP, damage, horn-buff), rate table, round-half-up integer math anchored to authored base stats every time. Unscalable stats pinned with reported reasons; no invented mechanics.
- Engine resolves scaled defs at troop/building spawn, bolt/horn cast and comet/snare/mortar impact; everything else untouched. Config/state carry frozen per-seat snapshots; old evidence (no snapshot) runs at L1 identically. No migration, no format bump.
- Snapshot loaded once from verified progression at match-start lock, deep-copied, client-blind, mid-match-proof; behind cardScaling flag defaulting off with fail-closed L1. Commander parity, settlement, trophy/XP/Gold paths intact.
- Delivery: 17 P2c tests + 258 regression tests green sequentially, typecheck/lint/build green. Committed locally, no push, no deploy, no PROD writes.

## P2b Gold economy and card level upgrades (2026-10-23)

- TEST policy: earn win 60/loss 30/draw 40 (matchmaking+ranked; private 0); upgrade costs L2-L10 100/180/300/480/750/1100/1600/2300/3200. XP thresholds reused from P2a. No $CHOG, blockchain, or real-money flows.
- Purchased levels separated additively (`purchased_level` on card_xp_progress, default 1, check 1-10); XP never advances it and is never consumed. Upgrade moves exactly one level or nothing.
- Migration 0014 (TEST only): earn ledger, spend ledger with idempotency PK, progress column + checks. Derived balances; single-statement atomic upgrades with advisory locks; reconcile refills short earn ledgers.
- Read/upgrade APIs: gold balance+history, upgrade endpoint with duplicate/level-mismatch/insufficient/mapped outcomes, extended progression response. Card XP response semantics updated (level = purchased).
- Delivery: 30 P2b+P2a tests green sequentially, settlement/trophy regressions intact, typecheck/lint/build green. Committed locally, no push, no deploy, no PROD writes.

## P2a authoritative card XP and persistence (2026-10-23)

- Verified-usage XP foundation on TEST: accepted deploy commands per player per card from replay evidence (rejected/ability/commander/unknown excluded), caps 5/card/match and 20/player/match, levels 1-10 on cumulative policy thresholds. Unranked and ranked eligible; private excluded.
- Migration 0013 (TEST only): progress + awards ledger + run markers. Idempotent stage, single-statement recompute apply, reconcile heals interruptions. SettlementService runs XP post-settle; script gates on table presence (PROD-safe).
- Read API only: GET /api/players/me/card-xp returns all 20 cards with level/xp/target/eligible/maxed. No Gold, upgrades, stat changes, or combat edits.
- Delivery: 13 new tests + 19 settlement/ranked regressions green, typecheck/lint/build green. Committed locally, no push, no deploy, no PROD writes.

## P1c ranked frontend integration (2026-10-23)

- `/app/play` now identifies Season 1, eligibility as a server check and the closed ranked queue, with a read-only Progress link. `/app/play/battle?mode=ranked` is blocked by `RANKED_PUBLIC_MATCHMAKING_ENABLED=false` and never mounts the player battle session.
- `/app/progress` reads `/api/players/me/ranked` and `/api/leaderboard/ranked`, renders server trophies, rank, W/L/D, recent deltas, public identities and the current position, and keeps casual standings separate. Empty, locked, auth and unavailable states stay distinct.
- Ranked result feedback only polls a match-specific award after `settled` or `already-settled`, with four bounded reads. No combat, Colyseus, database or migration changes. Checkpoint pending local commit.

## P1b.2 ranked trophies and persistent leaderboard (2026-10-23)

- Season 1 provisional policy on TEST: start 0, win +25, loss -20 with floor at 0, draw 0. No placement, decay, reset, Elo, XP, gold or $CHOG.
- Migration 0012 (TEST only): `ranked_trophy_balances` and `ranked_trophy_awards` ledger with applied-delta + balance_after audit trail. Awards run only over settled replay-verified ranked rows; private/unranked/aborted/refused never award.
- Exact-once per (match, player) via ledger PK; stage+apply statements with advisory locks; reconcile finishes NULL-balance_after rows and never-settled awards. Settlement status never depends on trophy success.
- Read APIs: ranked leaderboard (trophies desc, wins desc, username_key; RANK() positions; season-isolated) and my-ranked (trophies, rank, WLD, recent deltas). Casual board and stats untouched.
- Delivery: 15 new tests + 12 casual/progression regressions green, typecheck/lint/build green. Committed locally, no push, no deploy, no PROD writes.

## P1b.1 ranked queue and match provenance (2026-10-23)

- Separate ranked matchmaking on the existing battle server: `BATTLE_RANKED_QUEUE_ROOM`, mode-aware `MatchCoordinator`, `RankedQueueRoom` sharing the one coordinator. Deck/commander validation, seats, lifecycle and battle room reused; no new combat.
- Server-owned mode identity from queue entry through settlement (`matchmaking` vs `ranked` vs `private`); `matches.match_type` gains `ranked` via additive migration 0011 (TEST only, PROD needs approval).
- Casual leaderboard and stats queries already filter `match_type = 'matchmaking'`, so ranked rows cannot pollute them. No trophy, rating, reward, XP or legacy changes.
- Delivery: `ranked.test.ts` 7/7, battle regressions 67/67, typecheck/lint/build green. Committed locally, no push, no deploy.

## P1a production play hub and battle routing (2026-10-23)

- Added `/app/play` with truthful Unranked, Private Room and Ranked unavailable states.
- Added `/app/play/battle` and moved the existing BattlePanel session into a shared module used by both the player route and `/dev/battle`.
- Player route keeps the existing Colyseus queue, room-code lifecycle, loadout picker, Phaser canvas, reconnect behavior, combat VFX and result state. Dev diagnostics stay hidden on the player route.
- Public Play CTAs and app battle entry links now target `/app/play`.
- Checkpoint: `.fast-build/P1a-PLAY-HUB-CHECKPOINT.md`. Live authenticated QA remains separate.

## UI polish pass (2026-10-23)

- Progress identity no longer breaks usernames at arbitrary characters. Avatar/name flex sizing and handle ellipsis preserve the verified record layout.
- Battle cards keep the approved dock and state bindings while improving cost contrast, name wrapping and long-name readability.
- Battle results now use a violet/gold panel with real result, opponent, crowns, reason, duration, settlement status and the existing Back to lobby action. Checkpoint: `.fast-build/UI-POLISH-CHECKPOINT.md`.
- Browser evidence is external at `C:/Users/USER/Documents/ChogRoyale-Assets/ui-polish-20261023/`. Live authenticated QA remains separate.

## B2.8g.2 combat VFX and gameplay feedback (2026-10-23)

- `BattleCanvas` now gives authoritative HP drops a short team-colored hit burst, strengthens destruction and ability cues, and adds existing aura feedback for building and spawned-unit events. Recorded deploy, projectile, spell, tower-fire and structure effects remain bound to their existing events.
- Chaos warning, active and expiry events now add bounded family-colored board-edge feedback. Event identities are deduplicated across refreshed snapshots and reset for a new match. Reduced motion shortens and removes scale changes from primitive cues.
- Scoped delivery and fixture evidence: `.fast-build/B2.8g.2-CHECKPOINT.md`. No combat, Colyseus, HUD, arena or database code changed.

## B2.8g.1 visual correction (2026-10-23)

- The approved B2.8g.1 environment pass now keeps all six V002 structures inside the authored canvas presentation. Top Core art and its health label use a visual-only Y offset, while ground points, camera mapping, deployment bounds and weapon anchors stay authoritative.
- Structure accents are seat-relative. Friendly mounts use cyan pennants and halos, and opponent mounts use coral accents in either player perspective. The V002 board remains live Phaser art, with the surrounding frame built from existing layers and pointer-transparent CSS.
- Scoped delivery and fixture evidence: `.fast-build/B2.8g.1-CORRECTION-CHECKPOINT.md`. Target images are external at `C:/Users/USER/Documents/ChogRoyale-Assets/battle-visual-targets/`. Live authenticated acceptance remains separate.

## B2.8g.1 arena environment and visual depth (2026-10-23)

- The approved B2.8g.0 HUD remains intact. `battle-hud.css` now gives the fixed shell and arena a restrained green, teal and gold environmental surround with pointer-events disabled on decorative layers.
- `BattleCanvas` keeps the V002 100x160 board, seat mirror, camera mapping and mount coordinates unchanged. Existing mounted towers and Cores gain low contact shadows only, with dimmed shadows for destroyed bases.
- Scoped delivery and fixture evidence: `.fast-build/B2.8g.1-CHECKPOINT.md`. The temporary QA route was deleted. Live authenticated acceptance remains separate.

Last updated: 2026-10-24

## B2.8g.0 battlefield shell (2026-10-23)

- Active `/dev/battle` presentation uses scoped violet/gold panels and the shared Satoshi, Georama and Lilita One fonts. Desktop places the hand and energy beside the full-height board. Mobile keeps a bottom dock.
- `BattleHud.tsx`, `battle-hud.css` and status-only props in `page.tsx` own the slice. `BattleCanvas`, arena assets, coordinate mapping, ruleset v16, networking and persistence are unchanged.
- Scoped delivery and evidence: `.fast-build/B2.8g.0-CHECKPOINT.md`. Existing dirty `.fast-build/STATE.md` stays untouched. Live authenticated acceptance remains separate.

## What this is

- Chog Royale: real-time 1v1 NFT-powered strategy game on Monad, private repo.
- Source of truth for slice history: `.fast-build/STATE.md` (detailed log).

## Stack

- Next.js 16 App Router, React 19, TypeScript, viem 2.57, Privy react 3.50 / server 1.32.
- Drizzle ORM + Neon Postgres; PROD via `DATABASE_URL`, isolated TEST branch via `DATABASE_URL_TEST`.
- Chain: Monad 143 (`rpc.monad.xyz`); Chog Genesis contract `0xc96d…73763`, totalSupply 1969.

## Architecture

- `src/lib`: chain, nft-contract (readOwner/readTokenUri/capability probe), discovery (range-exhaustion + boundary proof, no Enumerable), metadata (SSRF guards, size/timeout/redirect limits, sha256 provenance), commanders engine (ruleset v1: 5 classes, 123 signal rules, power-budget scoring), auth/wallets/onboarding/avatars.
- `src/db`: players (+wallets, roles), nfts (tokens/metadata/ownership observations/checkpoints/trait stats), commanders (rulesets/definitions), patrons (rulesets/immutable match assignments), chaos (rulesets/immutable pulse schedules), legacy (append-only events, achievement catalog + awards).
- `src/app/api`: health, players, nfts (+legacy/achievements per token), commanders, arena/patrons, arena/chaos (+ dev-only onboarding UI).
- `scripts`: ingest-nfts, nft-index (discover/ingest-missing/traits/sync-ownership/coverage), commanders-derive. All idempotent and resumable.
- Tests: vitest, 192 passing (46 combat); DAL routes to TEST via `CHOG_TEST_DB=1` (fail-closed, prod-forbidden).

## Public site (L0/L1, 2026-10-21)

- `/` is the public landing page: `src/app/page.tsx` composes `src/components/site/` (MarketingHeader, HeroWorld, SiteDocumentFlags, fonts, site.css). All site CSS is `site-` prefixed or under `.site-root`. Tokens live in `globals.css` `@theme` as `chog-*` colors and `font-site/data/game`.
- Hero art: proposed G pagoda image, derived to `public/assets/site/hero/` (wide 1672x941, portrait crop 560x941). Rights and editorial approval still pending.
- L0/L1 approved 2026-10-21. L2 About scene (`AboutScene.tsx`, copy in `copy.ts`) built and awaiting review. Mascot is the v001 Reaver commander class template at `public/assets/site/mascots/`, labelled as class art, marketing use not yet cleared.
- Satoshi self-hosted via next/font/local (FFL license file alongside). Georama and Lilita One via next/font/google.
- L2 approved. L3 card carousel (`CardsScene.tsx`, `ChogCardCarousel.tsx`, `cards.css`, `site-cards.ts`) built and awaiting review. Card display data is read from `CARDS_V1`, never hardcoded. The site shows no rarity because the game has none.
- L3 approved. L4 Collect (`CollectScene.tsx`, `CommanderSpotlight.tsx`, `collect.css`, `site-commanders.ts`) built and awaiting review. `ChogCard.tsx` is the shared card frame for L3 and L4. Commander display data comes from `CLASS_ROSTER` and `COMMANDER_COMBAT_PROFILE_V1`.
- L4 approved. L5 spotlight grid (`SpotlightScene.tsx`, `FeatureGrid.tsx`, `ChogCardMini.tsx`, `spotlight.css`, copy in `copy.ts`) built and awaiting review. Six cells: server authority, deck and energy, Arena Patron, telegraphed Chaos Pulse, free/NFT commander parity, replay verification. Cell art is the approved v001 READY_STATIC showcase set plus the Bulwark commander class template, labelled "Commander class art".
- L5 approved 2026-10-21, then copy-corrected against the shipped code 2026-10-22. Six claims were wrong or over-technical and were fixed: the seed and tick rate were dropped from the server-authority cell, energy regen now says it accelerates, "verifies a Chog" became "picks a Chog" because no ownership or existence check happens at match time, "one Chaos Pulse" became three with only the first trait-derived, "play without owning anything" became "without owning a Chog", and the replay cell no longer scopes the check to Core wins. The section note now says the battle needs a dev login and that saved history is off.
- L6 built 2026-10-22: `BentoScene.tsx` (`#world`) + `BentoGrid.tsx` + `bento.css`. A 12-column asymmetric bento (8+4 then 4+4+4) inside one white 28px-radius shell on a mist-to-white ground. Battle tile is a tableau of the Reaver class cutout with a Rift Sentry and a Chaos Comet card layered in front. Social and Lending carry inline SVG motifs only because nothing is built for them.
- L7 built 2026-10-22: `ClosingScene.tsx` (`#enter`) + `SiteFooter.tsx` + `closing.css`, mounted after the L6 bento. The CTA is a type-only block on a white to lilac to white ground, with the messaging 5.1 buttons and the honest "Closed alpha" note next to them. The footer is the DESIGN.md shape (Royal Purple band, four-column white top, copyright and fairness line, fantasy scene) with a CSS sky, sun, glossy ring, beads, four scalloped hills and the Warden, Reaver and Scout class cutouts peeking over the front ridge. The three external URLs are the pre-verified ones, and there are no social buttons because no social account is verified. The scene carries a visible class-art honesty chip outside the aria-hidden scene. CSS-only motion: hill parallax, one mascot rise, sun pulse, 120s ring turn, bead drift, all dropped on reduced motion and Save-Data.
- L8 built 2026-10-22: `SeasonOpening.tsx` + `opening.css`, mounted in `page.tsx` before the header. A 2520ms violet seasonal opening over the pagoda hero: the Reaver class art sweeps in from the upper right and settles tilted -8 degrees, the Chog Royale wordmark slams in with a gold bevel, then a dissolve into the hero that is already rendered underneath. CSS only, no Three.js, no canvas, no new dependency. It plays on every genuine visit to the landing page and stores nothing, so no storage flag can suppress it; it watches `usePathname()` so it restarts only when the route changes back to "/". The whole cycle is one CSS animation and `animationend` does the teardown, so the fade and the cleanup cannot drift apart. Dialog with a focusable Skip, Escape, focus restore to `#main`, a scroll lock with scrollbar compensation, reduced motion reduced to a static 1200ms beat, and Save-Data dropping the drifting haze.
- Phase L8 QA (full page pass, contrast, a11y sweep) not started.
- A1 built 2026-10-22: the authenticated game lobby at `/app` (public route, but the lobby itself is a dev-surface feature). `src/app/app/` holds the route and a server-side ruleset catalog; `src/components/app/` holds the container, the prop-driven view, the nav and the game-side CSS. Reads `/api/players/me`, `/api/players/me/loadout` and `/api/players/me/commanders`. No combat, matchmaking or database logic was duplicated. The PROD `player_loadouts` and `matches` tables still do not exist, so the loadout read answers 500 in production and the lobby shows an honest "deck service is not available" state.
- A2 built 2026-10-22: the decks and collection screen at `/app/decks`, inside the same shell. The shared `/app` layout now owns the Privy provider so the lobby and the deck screen share one session, and the HUD moved into `AppHud`. `src/lib/card-details.ts` builds card descriptions and stat rows from the authored ruleset and is shared with the battle session, so the deck screen and the battle log read the same numbers. The deck screen writes only through the existing loadout endpoint and keeps an honest local draft when that service is unavailable. It shows no levels, upgrades, currencies or rarities, because Chog Royale has none.
- A2.1 acceptance and polish 2026-10-22: the save state is stated once in the save strip (the ribbon badge is only a short token), the save button has a grey disabled treatment when account saving is unavailable, a partial selection is labelled "current selection average" and only a complete seven plus one deck shows the deck average, and the local draft is loaded even when the loadout read fails. "Fleet Recruit" was traced to the free Scout starter (class scout, cost 4, shared Scout class portrait), a valid class template and not an NFT claim, so no commander code changed. The env test now resets the memoized env before its assertions and passes with and without `CHOG_TEST_DB=1`.
- A3.1 built 2026-10-22: the authenticated profile at `/app/profile`, inside the same shell. It reads the real player, loadout, commander and stats endpoints and reuses the lobby derivation (`resolvePlayer`, `resolveCommander`, `resolveDeck`, `toEligibility`). The commander stage and the notice plate were extracted into `CommanderStage` and `AppNotice`, shared with the lobby. The identity header shows the avatar, name, verified-wallet count and real join date; the featured commander shows class, class art, role, cost, ability and the free/NFT origin; the deck panel shows the real saved cards; the record panel shows real settled W/L/D or an honest empty/unavailable state. No leaderboard, trophies, XP, levels or currencies, and no wallet address, player id or DID. A3.2 owns the full stats, history, legacy and leaderboard experience.
- A3.2a built 2026-10-22: the authenticated progress screen at `/app/progress`, inside the same shell. It reads the real player, stats, saved matches and casual leaderboard endpoints. The record hero shows the server win rate and W/L/D; the record panel shows real match counts, crowns, private versus matchmaking splits and first/latest match dates; match history is cursor-paginated (6 per page) with result, opponent, crowns, type, date, caller-side commander and deck preview; the Casual Alpha Leaderboard is offset-paginated (10 per page) with server eligibility, position, order and a real You row. Empty, unavailable, locked and session-expired states are separate, so a 500 never becomes a zero record. No new endpoint, table, migration, settlement, rating or reward. `/dev/progress` is unchanged as the development surface. The Progress nav tab and the profile "Open progress" action point to `/app/progress`.
- A3.2b built 2026-10-22: the Genesis legacy vault at `/app/progress/legacy`, inside the same shell. It reads the real verified-wallet holdings (`/api/players/me/nfts`), the cached commander enrichment (`/api/players/me/commanders`), the token legacy record (`/api/nfts/[tokenId]/legacy`, server-side offset pagination) and the earned-only awards (`/api/nfts/[tokenId]/achievements`). A full-width vault shelf selects a held Genesis token; the detail shows genuine token art when the route resolves one, otherwise correctly labelled shared commander class art. The record shows commander appearances, Arena Patron appearances, victories, defeats, a verified event trail and the four authored achievements with earned/locked/partial states. Commander appearances state the match-start ownership check; Arena Patron appearances state that the match selected the Patron independently. Empty, not-indexed, unavailable, locked and session states are separate. No new endpoint, table, migration, settlement, award engine or ownership logic. The Progress screen has a Genesis legacy vault entry and the Profile record panel links to the vault.
- Public-site ground truth for marketing claims: real-time 1v1 is server-authoritative (Colyseus `BattleRoom`, 100ms tick) but gated to a dev surface; the Arena Patron and Chaos Pulse are live per match and symmetric; `COMMANDER_COMBAT_PROFILE_V1` is class-keyed so free and NFT commanders share one profile; every finished match is replayed and hash-compared on the server, but durable settlement is off by default; there is no XP or level system, only match stats over settled rows.

## Key documents

- `.fast-build/STATE.md`: slice-by-slice build log (B0 through B1.3).
- `.fast-build/ROADMAP.md`: dependency-aware roadmap for all remaining work, with the active B2.8f.3 QA slice, next A4.1 slice, GATE A, A4, B2.8g, B4, B5 and release gates.
- `AGENTS.md`: working rules (no em-dashes, state protocol, test before claim).

## Decisions made

- Reuse existing B1.1/B1.2/B1.3 pipelines; never rebuild or fabricate metadata.
- Single-stream ingestion only (CONCURRENCY=1, 6s gateway spacing, Retry-After + exponential backoff); never launch competing workers.
- Failure writes never regress resolved metadata rows (fixes concurrent-worker race).
- Token 0 absent; collection = token IDs 1..1969; all metadata under one shared IPFS CID.
- Tier is prestige-only in commander derivation; tokenId is identity-only, never a stat input.

## Local asset workflow

- Chogling c001 2D cutout is frozen at `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-2d-production/c001-cutout-prototype-20261019-154531/`, with `REPORT.md` and `gallery.html`. Editable ORA has 11 layers, plus linked-PNG SVG, rig JSON and regeneration scripts. Approved m001 head RGB is preserved before transforms; the generated replacement head is unused. Eight-key walk is 800 ms and punch is 840 ms. Delivery has 18 GIFs and 96 RGBA frame PNGs, including phased three-unit previews, full and 192x256 canvases and neutral character heights 128/96/64/48 px. Independent preservation passed 444/444. Method is promising and the rightward punch reads at 48/64 px, but this candidate is not production-accepted: hip/torso joins, ankle cap lines and a short shuffle stride remain. Zero keyed stance drift and a 2 px full-resolution filtered sole fringe do not validate interpolation or runtime motion. One bounded iteration stopped, no atlas, Phaser test, Tripo, 3D edits, gameplay edits or push.
- Reference workflow proposal: `docs/character-reference-workflow.md`. User selected five NFT commanders plus two original troops. Source evidence and original portraits are outside the repo in `C:/Users/USER/Documents/ChogRoyale-Assets/reference-research-20261018`.
- Verified v1 pilot IDs: 341 bulwark (CHOG #1802), 897 reaver (#389), 171 deadeye (#1632), 1128 scout (#620), 1720 warden (#1212). Original troop pilot: Choglings and Boulderback. Exporter and models are proposed, not implemented.

- c001 troop concepts (Codex image_gen, no references) rejected by the user. c002 troop concepts are hand-authored vector work in `original-troop-concept-review/c002/troop-concepts/`, pending review. Scout i001 approval covers only its red rear head/core and spikes.
- Blender 5.2.2 LTS is installed at `C:/Users/USER/AppData/Local/Programs/Blender Foundation/Blender 5.2/blender.exe`.
- Codex Desktop already has `mcp_servers.blender`, running `C:/Users/USER/AppData/Local/hermes/bin/uvx.EXE` with `mcp-for-blender`.
- Matching Blender add-on is enabled with saved preferences and telemetry disabled. The bridge listens on `127.0.0.1:9876`.
- Blender MCP verified end to end through scene inspection, test `.blend` save, GLB export, and a 384x384 PNG render inspected through MCP. Outputs are in `C:/Users/USER/Documents/ChogRoyale-Assets/mcp-verification-20261018`.

### Chogling mesh audit (2026-10-19)

- Bounded r003 modular alternative stopped at external `chogling-production/r003-modular-animation-20261019-143753/01-chogling-modular-animated.blend`. Rigid capped head/fan, torso, arm/fist and leg/foot parts have two 24-frame walk/punch clips with fixed-camera transparent frames and 128/96/64 px loops. Verdict blocked: exposed hip/knee cuts, shoulder seams and weak small-size punch. Float64 rigid-area ratios are 0.9999998677..1.0000002463 across 98 samples, stance drift <=4.47e-8, walk ground gap <=0.000286639, and 186/186 protected files unchanged. Earlier float32 tiny-triangle flags were numerical cancellation, retained separately. No gameplay integration or Phaser runtime test. Recommended next method is a 2D cutout from approved views, not another 3D correction loop.
- Latest bounded correction is external `chogling-production/r002-final-rig-20261019-061500/07-chogling-corrected-rig.blend`, saved and reopened. Positions/topology/UV hashes match r001, 16 bones, one modifier, zero actions and normalized weights. Accepted belly correction affects 254 vertices. Packed-texture persistence bug fixed by loading edited PNGs as new images before packing. Preservation passed 124/124. Animation/readability verdict remains blocked: right-walk face 2387 area ratio 0.0810277, punch shoulder volume loss and visible crossings. Punch remains guard-like at 128/96 px, arm bend/punch unreliable at 64 px, squat close to neutral. Bounded correction stopped.
- Read-only audit files and original working blend remain in `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-3d-audit/textured-1beb2ae7-20261019-041632/`. Production candidates are separate in `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-production/r001-cleanup-rigprobe-20261019-043633/`. Final preservation validation passed for all 53/53 protected baseline files, including all three unchanged source GLBs.
- Final geometry deliverable: `04-chogling-cleaned.blend` without rig and `05-chogling-rigged.blend` with 16 bones, 15 deform bones. Final mesh has 8,780 vertices, 10,544 triangles, 5,309 positional-weld vertices across three components, and 66 boundary edges confined to the two fitted brow bases. Five small original boundary groups were closed with 23 cap triangles. All 10,521 original face UVs retain their hash, packed source pixels are unchanged, and mesh/UV degenerate counts are zero.
- Geometry changes were bounded: muzzle front-depth adjustment max +0.00587 Y; 101 shoulder-root vertices moved internally by max 0.006854, with no boundary positions moved. The original 251 strict crossing pairs rose to 255 after caps, then fell to 231: 207 fitted-brow pairs and 24 body pairs, including 18 remaining shoulder-root pairs plus 6 elsewhere. Earlier “waist” label was incorrect; the main ROI is at x about +/-0.1, z about 0.32-0.34 near shoulder roots. Do not describe all intersections as resolved.
- Rig probe: all 8,780 vertices have normalized weights, one armature modifier, zero actions. Nine static probes show no collapse below 10%, no coincident-seam tearing, and head rigidity error max 1.28e-7. Posed body crossings remain 24 neutral, 28 left, 31 right, 31 punch, 28 walk-left, 32 walk-right, 27 lean, 28 head, and 39 squat after contact correction. Foot-level and root-height corrections produce stance contacts near 1e-7 and max squat gap 0.000058, but do not establish IK or continuous-animation readiness. Verdict: static-deform feasibility prototype, not production-ready animation. No Tripo regeneration, game-code changes, or push.

## Static sprite kit v001 final handoff (2026-10-20)

- External kit: `C:/Users/USER/Documents/ChogRoyale-Assets/gameplay-sprite-kit/v001/`. User approved v001 static visual direction. Final roster matches fresh current v16 runtime tables: 28 primary entries, including 13 troops with one spawned nondeckable, five commander class templates, four buildings, two fixed structure types and four spells. Separate counts: 20 ordinary cards, 25 card derivatives, six effect primitives for 26 requirements, five exact NFT originals.
- Canonical `manifests/phaser-assets.json` has 64 stable asset records and bindings for 28 entities, 25 cards, five classes, ten abilities and 26 effects. `scale-anchors.json` records measured alpha bounds, pivots and proposed untested display scale. Historical manifests are preserved separately. `PRESENTATION-SPEC.md` proposes child-only transforms without changing authoritative simulation.
- Final status: 28 READY_STATIC, zero PROVISIONAL, zero MISSING, zero READY_ANIMATED. Independent `manifests/roster-reconciliation.json` verifies current roster and source hashes, all 126 RGBA exports (121 transparent cutouts plus five lossless opaque NFT profile PNGs), 181 unchanged copied sources and canonical alpha/padding. Static direction approval supersedes the earlier 2-ready/26-provisional art-review gate. Phaser integration, runtime timing, frame animation and real-device readability remain untested. Frozen c001 cutout motion remains a separate blocked experiment.
- Final offline visual review checks 28 primary plus six VFX on the contact sheet, 24 physical entries at 64/96/128 alpha heights and a two-lane battle composition with four side towers, two cores and two bridges. These are static comparisons, not phone tests.
- Asset-only checkpoint. No gameplay, backend, DB, 3D, Tripo, animation production or push in this handoff.

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

## Audio asset overhaul, 2026-10-27

- Production audio assets are in `public/assets/audio/v001`: Track A is a 49.55 s cyclic wrap-crossfaded CC0 MP3, and the 16 authored local procedural UI cues use the shared `primary` through `reveal` keys. Existing authoritative battle Web Audio cues remain unchanged.
- Track B is a 33.409093 s CC BY-NC development loop at `.audio-dev/battle-loop.mp3`, served only through `/api/dev-audio/battle`; its production manifest path is null and `.audio-dev/**` is excluded from Next tracing.
- Source rights, hashes, waveform/boundary QA and ElevenLabs Free-tier noncommercial decision are recorded in `docs/audio/credits.md`, `docs/audio/quality-report.md` and `docs/audio/audio-manifest.json`. External masters and raw derivatives live in `C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027`.
## Audio refresh autoplay recovery (2026-10-28)

- The shared app audio controller persists preferences in local storage and is mounted by the `/app` layout.
- Refresh recovery now tries autoplay once, then uses temporary capture listeners for the first real pointer or keyboard gesture. The listeners stop on success, provider cleanup, mute, or silent volume.
- `unlock({ fromGesture: true })` can replace a stale autoplay resume, but repeated handlers during the same gesture reuse the in-flight gesture promise. The floating provider-level Enable Sound control was removed. Settings remains the intentional fallback.
- Focused audio tests cover listener lifecycle, mute behavior, unresolved autoplay, and duplicate gesture handlers. Full suite has inherited public-site copy failures unrelated to this fix.
