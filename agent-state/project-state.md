# Project State

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

Last updated: 2026-10-23

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
