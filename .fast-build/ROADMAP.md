# Fast Build Roadmap

Last updated: 2026-10-23
Repository: `C:\Users\USER\Documents\ideas\chog-royale`
Branch: `main`
HEAD: `dfd04c8` (A3.2b Genesis Legacy)
Status: planning registered, no implementation started

## Authority

- `.fast-build/STATE.md` is the detailed build log. It currently holds uncommitted B2.8f and B3 history. Never reset, truncate, or replace it.
- This file is the dependency-aware roadmap and handoff index. Read it with `STATE.md` and the three `agent-state/` files at the start of every session.
- Fast-Build skill: `C:\Users\USER\.config\opencode\skills\fast-build\SKILL.md`.
- One invocation builds one slice. Stop after verification and a state checkpoint.
- Status values: DONE, READY, ACTIVE, BLOCKED, GATED, NOT AUTHORIZED.

## Product

- Name: Chog Royale.
- Outcome: real-time 1v1 NFT-powered strategy game on Monad.
- Live surface: public landing page and the authenticated `/app` shell (lobby, decks, profile, progress, Genesis legacy). The battle client lives at `/dev/battle` and is dev-gated.
- Primary journey: login -> lobby -> decks -> profile -> progress -> Genesis legacy -> battle.

## Completed baseline

Do not rebuild these. They are code-complete per their handoff reports. Signed-in acceptance is still outstanding.

| Milestone | Commit | Evidence status |
| --- | --- | --- |
| Landing L0 to L9 | `0f8b201` latest | Code complete. Owner approval recorded in the A1 handoff. |
| A1 Lobby | `d930916` | Code complete. Awaiting signed-in journey. |
| A2 Decks and Collection | `e6ac6da` | Code complete. Awaiting signed-in journey. |
| A2.1 Corrections | `3135f82` | Code complete. |
| A3.1 Player Profile | `2a9775f` | Code complete. Awaiting signed-in journey. |
| A3.2a Progress, history, leaderboard | `b595d49` | Code complete. Real rows need settlement. |
| A3.2b Genesis Legacy | `dfd04c8` | Code complete. Real rows need legacy activation. |
| B2.8a to B2.8e gameplay | Commits in `STATE.md` | Code complete. Several browser and phone QA items pending. |
| B2.8f arena, HUD, tower fire | `757df9a`, `24ff663`, `915ab18` | Code complete. Live QA pending. |

## Existing capabilities

- Auth: Privy client and server verification, onboarding, username claim, avatar, verified wallets, roles. Working.
- App shell: shared Privy provider in the `/app` layout, HUD, five-tab nav, honest loading, empty, and unavailable states. Working.
- Decks: real ruleset catalog, saved loadout with revision check, local draft fallback. Working, authenticated acceptance pending.
- Profile, progress, legacy: read existing APIs and add no persistence. Working, real-data acceptance pending.
- Battle: Colyseus authoritative room, ruleset v16, matchmaking, reconnect, settlement and legacy code paths. Working in dev, production tables and flags gated.
- Social: no friends, clans, lending, chat, gift, or economy tables or routes. Missing.
- Settings: no `/app/settings` route. Missing.
- Commanders page: nav item exists but is disabled. Missing.
- Public play route: no approved route. `/dev/battle` is gated.
- Audio and character animation: no approved in-repo runtime assets. Missing or blocked.

## Remaining gaps

- Authenticated end-to-end acceptance has not been run.
- Progress, history, leaderboard, and legacy show unavailable in production because migrations `0007` to `0009` and settlement or legacy are not active.
- Settings, commanders, and cross-app feedback are incomplete.
- Combat presentation is static for characters. VFX assets exist externally but are not wired.
- Social and lending systems are specified in the PRD and not built.
- Production deployment, security hardening, ranked ruleset, and mobile testing are not ready.

## Active slice

### B2.8f.3 Live battle presentation QA

Continuity slice for the existing B2.8f work. This is a verification slice, not a new feature.

- Goal: close B2.8f with a live authenticated presentation pass. Verify arena layers, mounted defenders, HUD, tower fire, seat mirroring, and reduced motion.
- Reuse: existing `/dev/battle`, `BattleCanvas`, `BattleHud`, `arena-registry`, `sprite-registry`, `hud-view`.
- Depends: B2.8f code at `915ab18`. Owner login and two onboarded accounts for the live match. A real phone for the device portion.
- Accept: one full live match with tower fire visible and correctly mirrored, no clipped muzzle flash at the top Core, HUD readable at 390x844 and 1366x768, reduced motion safe, no console errors.
- Verify: one live browser pass on `localhost:3000` plus the battle server. Focused battle UI tests only if code changes. Do not run the full combat suite for presentation QA.
- Gate: BLOCKED BY OWNER for the authenticated live match and the real phone. The code is complete. Do not mark it done from the existing harness evidence.
- Evidence: `915ab18`, `STATE.md` B2.8f.1 and B2.8f.2 sections.

## Next executable slice

### A4.1 Settings and account surface

Full record is in the A4 section. This is the next slice that can be built without owner authentication. Its authenticated acceptance remains owner-gated.

## GATE A: Real player acceptance

### A0.1 Authenticated shell acceptance

- Goal: owner logs in and walks lobby, decks, profile, and the honest unavailable states.
- Reuse: existing routes and a real account.
- Depends: owner Privy login.
- Accept: each route shows real account data or the correct failure state. No bypass and no fabricated data.
- Verify: manual checklist at 390x844 and 1366x768. Store screenshots outside the repo.
- Gate: BLOCKED BY OWNER.

### A0.2 Authenticated data acceptance

- Goal: verify progress, match history, casual leaderboard, Genesis legacy, and battle settlement with real rows.
- Reuse: existing APIs and battle server.
- Depends: B5.1 and B5.3, a real NFT holder for legacy, two accounts for battle.
- Accept: one settled match appears once, replay verification passes, legacy events match the token record, failure cases stay unavailable.
- Verify: manual checklist plus read-only DB checks.
- Gate: GATED by production migrations, settlement activation, and owner participation.

### A0.3 Full journey sign-off

- Goal: sign off login -> lobby -> decks -> profile -> progress -> legacy -> battle.
- Depends: A0.1 and A0.2.
- Accept: one documented journey with real data and accurate error states.
- Gate: BLOCKED BY OWNER.

## A4: Application completion

### A4.1 Settings and account surface

- Goal: add `/app/settings` with real identity, editable display name and avatar, verified wallet summary, sign out, and a link from the app shell.
- Reuse: `/api/players/me`, `/api/players/avatars`, `/api/players/me/wallets`, the existing `displayName` and `avatarId` profile patch in `POST /api/players/onboard`, `AppHud`, `AppNav`, `AppNotice`. No new persistence.
- Modules: `src/app/app/settings/page.tsx`, `src/components/app/SettingsScreen.tsx`, `SettingsView.tsx`, `settings-model.ts`, `settings-types.ts`, `AppHud.tsx`, `AppNav.tsx`, `app.css`.
- Depends: none for the build. Final acceptance depends on A0.1.
- Accept: route renders inside the shared `/app` layout, one h1, 360px fit, loading, ready, empty, unavailable, 401, and 403 states are separate, display name and avatar save only after server confirmation, no wallet address or Privy id is rendered.
- Verify: focused model tests, `npm run typecheck`, `npm run lint`, `npm run build`, login gate check on `localhost:3000`.
- Gate: authenticated branch is owner-gated. Do not claim it is live from the login gate alone.

### A4.2 Commanders gallery

- Goal: activate the disabled Commanders tab with a real gallery of the five free classes and eligible NFT commanders.
- Reuse: `/api/players/me/commanders`, `/api/commanders/classes`, `CommanderStage`, class art, existing card detail conventions.
- Depends: A0.1 for acceptance. No hard build dependency on A4.1.
- Accept: free starters and eligible entries render, class art is labelled as class art, an unresolved NFT claim is not shown as owned, no invented rarity or stats.
- Verify: focused model tests, typecheck, lint, build, login gate check.
- Gate: authenticated branch is owner-gated.

### A4.3 Cross-app feedback and error states

- Goal: one consistent account feedback layer for 401, 403, 409, 500, 503, and network failures across the app.
- Reuse: `AppNotice`, existing route error envelopes, existing state models.
- Depends: A4.1 and A4.2.
- Accept: no duplicate notices, no failed read becomes empty or zero, retry works, session expiry offers sign-in, conflict keeps local work.
- Verify: model tests, typecheck, lint, build, targeted browser checks.
- Gate: none for the build. Live failure states are owner-gated.

### A4.4 Play guide and rules reference

- Goal: add a supporting page that explains deploy, energy, Chaos, crowns, and the real card roster from the live ruleset.
- Reuse: `src/app/app/catalog.ts`, `CARDS_V1`, `COMMANDER_COMBAT_PROFILE_V1`, `card-details.ts`, existing design tokens.
- Depends: A4.3.
- Accept: every number and name comes from the ruleset. No levels, currencies, rarities, rewards, or ranked claims.
- Verify: focused model tests, typecheck, lint, build, 360px browser pass.
- Gate: none. This slice can be dropped if the owner wants A4 smaller.

### A4.5 App shell integration and nav completion

- Goal: finish the shell after the new routes exist. Active states, settings entry, mobile fit, one h1 per page, no dead controls, no dev-only links in the primary nav.
- Reuse: `AppHud`, `AppNav`, existing route map.
- Depends: A4.1 to A4.4.
- Accept: every tab resolves or is explicitly labelled unavailable, 360px has no overlap, keyboard focus order is sensible, sign out works from every route.
- Verify: typecheck, lint, build, browser pass at 360, 390, and 1366.
- Gate: owner visual acceptance.

## B2.8g: Combat presentation

### B2.8g.1 VFX wiring from the approved presentation kit

- Goal: wire the existing READY_ANIMATED VFX for ability, impact, death, and tower fire events.
- Reuse: external `gameplay-presentation-kit/v001` manifests, `BattleCanvas`, `sprite-registry`, authoritative battle events. Do not copy reference-game assets.
- Depends: B2.8f code. B2.8f.3 for live acceptance.
- Accept: mapped events show the correct effect, effects clean up, reduced motion shows a static or shortened form, no ruleset or hash change, no new asset source.
- Verify: focused battle presentation tests, typecheck, lint, build. No full combat suite unless combat changes.
- Gate: asset mapping gap. Six VFX bindings are still missing in the external kit. Do not invent them.

### B2.8g.2 Impact and ability feedback

- Goal: improve hit, damage, ability, and death readability with existing art and code.
- Reuse: `BattleHud`, `BattleCanvas`, `hud-view`, existing event stream.
- Depends: B2.8g.1.
- Accept: damage and impact cues are distinguishable, reduced motion removes screen shake, authoritative timing is unchanged, no fake hit events.
- Verify: focused tests, typecheck, lint, build, browser pass.
- Gate: none.

### B2.8g.3 Battle audio

- Goal: add short deploy, hit, ability, tower, and result cues with a mute and volume control.
- Reuse: existing event names. Settings surface from A4.1 if available.
- Depends: A4.1 for preferences, B2.8g.2 for event mapping.
- Accept: audio starts only after a user gesture, mute and volume persist locally, reduced motion does not mute by itself, no background track, no copyrighted reference audio.
- Verify: focused tests, typecheck, lint, build, browser check.
- Gate: BLOCKED BY ASSET AND OWNER. No approved in-repo audio set exists. The owner must supply or approve royalty-free audio.

### B2.8g.4 Character animation

- Goal: replace static character poses with approved frame animation.
- Reuse: existing sprite bindings and event timing.
- Depends: an owner-approved READY_ANIMATED character set.
- Accept: verified frame animation, correct pivots, no procedural transforms presented as animation, real-device readability.
- Verify: asset manifest validation, focused rendering tests, browser and device pass.
- Gate: BLOCKED BY ASSET. The v001 kit is READY_STATIC. The c001 cutout and r002 or r003 3D experiments are not production-accepted. Do not fake this with tweens.

### B2.8g.5 Illustrated arena and device QA

- Goal: close the illustrated battle presentation with measured desktop, mobile, and real-device checks.
- Reuse: v002 arena, mounts, HUD, VFX, audio when available.
- Depends: B2.8f.3 and B2.8g.1 to B2.8g.4 as applicable.
- Accept: no clipped scenery, mounted defenders align to authoritative cell centers, seat mirroring is correct, ford and Chaos overlays follow authoritative state, real phone touch and frame rate are acceptable.
- Verify: one fixed-camera browser matrix plus one real-device pass.
- Gate: real device is owner-gated.

## B4: Social systems

### B4.1 Friends foundation

- Goal: friend request, accept, unfriend, block, and privacy rules with a real backend.
- Reuse: `players` identity, existing auth guards, error envelope, audit patterns.
- Depends for build: owner authorization for social scope. Depends for release: B5.1 migration process and production approval.
- Accept: request, accept, unfriend, and block work. Duplicate requests are idempotent. Blocked users cannot invite or lend. No wallet or Privy id leaks. Rate limits exist.
- Verify: DB tests on the isolated TEST branch, route tests, typecheck, lint, build.
- Gate: GATED. New schema and a public social surface require owner approval.

### B4.2 Friends UI and battle invites

- Goal: friends list, requests, presence only if available, and private battle invites.
- Reuse: B4.1 and the existing private room flow.
- Depends: B4.1.
- Accept: no fake presence, an invite creates a real private room, offline and blocked states are honest.
- Verify: model tests, route tests, browser pass.
- Gate: owner approval for social UI.

### B4.3 Clans foundation

- Goal: create, join, leave, roles (owner, mod, member), and clan identity.
- Reuse: B4.1 privacy and moderation patterns.
- Depends: B4.1, owner approval, migration process.
- Accept: one clan per player, role permissions enforced server-side, no battle power from membership, moderated names.
- Verify: DB tests, route tests, typecheck, lint, build.
- Gate: GATED. No clan chat until moderation is designed.

### B4.4 Clan UI and safe interactions

- Goal: clan page, roster, join requests, and the supported social interactions.
- Reuse: B4.3.
- Depends: B4.3.
- Accept: no unrestricted chat, block and report paths exist, rate limits exist.
- Verify: model tests, browser pass, abuse-case tests.
- Gate: GATED by moderation and owner approval.

### B4.5 NFT commander lending

- Goal: temporary in-game use-right lending between verified friends. No NFT custody, transfer, staking, or ERC-721 approval.
- Reuse: `commanders`, verified wallets, `ownerOf`, friendship tenure, settled match history, battle entitlement.
- Depends for build: B4.1 and explicit owner authorization. Depends for release: B5.3, legal review, security review.
- Accept: 30 continuous days and 30 verified matches are checked server-side, EIP-712 authorization is verified, one active loan per NFT, one borrowed commander per recipient, expiry and ownership change fail closed, owner loses use during the lease.
- Verify: DB and route tests on TEST, signature and replay tests, entitlement tests. No production enablement without approval.
- Gate: BLOCKED BY OWNER. Do not build economic or custodial flows without explicit authorization.

### B4.6 Economy

- Goal: none until authorized.
- Status: NOT AUTHORIZED. The PRD describes an optional $CHOG catch-up and cosmetic store. Do not implement payments, custody, pricing, or token flows.
- Gate: owner decision, legal and compliance review, onchain verification, and a separate roadmap.

## B5: Production readiness

### B5.1 Migration review 0007 to 0010

- Goal: review and prepare the production migration set.
- Reality check: the repo has `0007`, `0008`, and `0009`. There is no `0010` at HEAD. A `0010` may be created by B4.1 or B4.3.
- Reuse: `drizzle/`, `scripts/migrate-test-run.ts`.
- Depends: owner approval and a reviewed backup.
- Accept: every migration is reviewed for constraints, indexes, rollback notes, and data safety. TEST is applied. PROD is not applied in this slice.
- Verify: `npm run db:generate` only if schema changed, TEST migration run, read-only `to_regclass` checks.
- Gate: GATED. No PROD migration without explicit owner approval. Never run `drizzle push`.

### B5.2 Deployment and environment configuration

- Goal: make the app and battle server deployable with validated env, secrets, health checks, and WSS.
- Reuse: `src/lib/env.ts`, health route, Privy allowlist, battle server.
- Depends: B5.1.
- Accept: missing env fails closed, secrets stay out of the repo, health checks are real, Privy allowed origins match the deployed host, battle server uses secure WebSockets.
- Verify: local build and config audit. No deploy.
- Gate: GATED for execution. Audits can run now.

### B5.3 Settlement and legacy production readiness

- Goal: activate durable settlement and legacy on production after migrations.
- Reuse: `SettlementService`, `LegacyProcessor`, `BATTLE_SETTLEMENT`, `BATTLE_LEGACY`, replay verification.
- Depends: B5.1, owner approval, two accounts, a real NFT holder.
- Accept: one match settles exactly once, replay hash matches, no duplicate rows, legacy events match the token record, failed verification is refused, abort writes nothing.
- Verify: one controlled live match plus read-only DB checks.
- Gate: BLOCKED BY OWNER and PROD migration approval.

### B5.4 Security and permissions

- Goal: close B0.6 and review the shipped surface.
- Reuse: existing guards, rate limits, audit tables, WS auth, replay privacy.
- Depends: none for the audit. Production fixes depend on B5.1.
- Accept: every route has the correct guard, tokens never appear in URLs or logs, rate limits cover write and queue paths, errors do not leak secrets, replay and evidence stay private.
- Verify: focused auth and route tests, typecheck, lint. No broad refactor.
- Gate: production changes are approval-gated.

### B5.5 Multiplayer production testing

- Goal: prove two real clients, queue, private rooms, reconnect, settlement, and failure handling.
- Reuse: battle server and existing tests.
- Depends: B5.3 and B5.4.
- Accept: queue and private room both work, reconnect resumes, disconnect aborts without a record, settlement appears once, no cross-player data leaks.
- Verify: two-account live run plus focused tests.
- Gate: owner and participants required.

### B5.6 Ranked readiness

- Goal: decide and specify a ranked ruleset before building it.
- Depends: product decision, B5.5, a written rating model, placement, decay, season, anti-abuse, and private-room exclusion.
- Accept: no ranked UI or rating code before the ruleset is approved. The current casual leaderboard stays unranked.
- Verify: design review only in this phase.
- Gate: NOT STARTED. Owner decision required.

### B5.7 Real mobile device testing

- Goal: verify touch, safe areas, performance, audio unlock, and reconnect on real iOS and Android devices.
- Reuse: B2.8g presentation and the existing battle client.
- Depends: B2.8g.5 and B5.5.
- Accept: drag and tap deploy, no scroll capture, safe areas respected, stable frame rate, audio unlocks on gesture, reconnect works.
- Verify: one documented device matrix.
- Gate: BLOCKED BY OWNER devices.

### B5.8 Community alpha rollout

- Goal: open the approved alpha to a small group.
- Depends: A0.3, B5.1 to B5.7, and all release gates.
- Accept: approved public Play route, real settlement, documented support and rollback path, no unreviewed claims.
- Gate: BLOCKED BY OWNER. No deploy or push in this roadmap.

## Release gates

| Gate | Requirement | Blocks | Owner action | Status |
| --- | --- | --- | --- | --- |
| R1 | Hero illustration commercial rights | Public site launch | Confirm rights for the G hero image | OPEN |
| R2 | Chog NFT artwork display rights | Site and legacy token art | Confirm commercial display permission | OPEN |
| R3 | Official wordmark and crest assets | Brand-complete site and app | Supply or approve final assets | OPEN |
| R4 | Font distribution and licensing | Public site launch | Confirm Satoshi FFL compliance and Google font terms | REVIEW |
| R5 | Authenticated end-to-end acceptance | Alpha and launch | Complete A0.1 to A0.3 | OPEN |
| R6 | Production migrations and settlement | Real progress, history, legacy, ranked | Approve B5.1 and B5.3 | OPEN |
| R7 | Approved public Play flow | Community alpha | Decide the public route and gating | OPEN |
| R8 | Reviewed GitHub backup checkpoint | Release | Review and authorize a push or backup | OPEN |

## Owner approvals

- A0.1 and A0.2 authenticated acceptance.
- B2.8f.3 live match and real phone.
- B5.1 production migrations `0007` to `0009`, and any later `0010`.
- B5.3 settlement and legacy flags.
- B4 social schema, clan scope, and lending authorization.
- B5.6 ranked ruleset.
- R1 to R8 release gates.
- Any push, deploy, or production database change.

## Execution limits for future sessions

- One vertical slice per fresh session.
- No full repository discovery.
- No repeated ZIP or video processing.
- No unrestricted recursive scanning.
- No subagents.
- No repeated build or test loops.
- No unrelated refactoring.
- No full combat suite for UI-only work.
- One targeted verification pass, then one completion checkpoint.
- Checkpoint progress after each slice.
- Use existing components, business logic, design tokens, and APIs.
- Frontend work uses `localhost:3000` only.
- Preserve unrelated processes.
- Do not start extra development servers.
- No product code changes without a slice record.

## State and Git rules

- Do not reset, truncate, or replace `.fast-build/STATE.md`. It is the detailed log and currently holds uncommitted B2.8f and B3 content.
- Do not commit `DESIGN.md` or `docs/Chog Royale messaging.md` unless the owner asks.
- Commit only scoped roadmap or state files.
- No push, no deploy, no production database change.
- Run `git status --short` at the start and end of each slice.
- Run `git diff --check` before completion.

## Planning session verification

- Fast-Build skill loaded from `C:\Users\USER\.config\opencode\skills\fast-build\SKILL.md`.
- Branch `main`, HEAD `dfd04c8`.
- `STATE.md` preserved with its existing uncommitted content.
- `DESIGN.md` and `docs/Chog Royale messaging.md` preserved as untracked files.
- No product code changed.
- No tests run.
- No database writes.
- No push and no deploy.

## Next action

Start A4.1 Settings and account surface in a fresh session. Read this file, `.fast-build/STATE.md`, and the three `agent-state/` files first. Build only A4.1. Stop after one targeted verification pass and update the state files.
