# Final UX and visual polish

Bounded finishing pass on `polish/final-ux-identity-share`, based on main merge `e985247a89396eec2dd69c8bc65b7a0b87c7596a`. The polish PR is for review only and must remain unmerged. There are no server, simulation, database, economy, NFT entitlement or card-art changes.

Delivery: [PR #7](https://github.com/Devendurance/ChogRoyale/pull/7), open for owner review. It has not been merged or promoted to production.

## Approved asset release

PR [#6](https://github.com/Devendurance/ChogRoyale/pull/6) was checked at head `b4ee72753957d616d93ba343b7f054b5bb75e1bc`. GitHub reported MERGEABLE/CLEAN, both reported Vercel checks succeeded and no required checks were configured. The head and changed files matched the recorded final asset milestone. The draft was marked ready and merged using that exact expected head.

- Merge commit: `e985247a89396eec2dd69c8bc65b7a0b87c7596a`.
- Production deployment: `dpl_16rc2SKp9n7ASUdjossrCRhPJkUN`, READY, target production, source main at the merge commit.
- Production alias: [chogroyale.vercel.app](https://chogroyale.vercel.app).
- All 32 public asset files changed by PR #6 returned HTTP 200 with SHA-256 matching local approved files. See [production-assets.json](final-ux-polish/review/production-assets.json).

## Five acceptance areas

| Area | Result and evidence |
| --- | --- |
| Friends | Clear header/Messages action, compact identity, full-width search and separated relationship sections. Real catalog avatars with generic fallback, prioritized actions, cancelable destructive confirmations, explicit empty/unavailable states. Real route with mocked profile/social APIs passed search/send/accept/decline/remove/block/unblock and delayed server confirmation at 390x844 and 1366x768. No horizontal overflow. [Evidence](final-ux-polish/review/friends-evidence.json). |
| Private invites | Case-sensitive nine-character room validation, current-origin canonical URL, clickable code/icon/keyboard copy, native sharing and copy-link/manual-selection fallback. Login and setup preserve the invite. Join is attempted once after verified setup, with explicit ready-up preserved. Saved recovery for that same room wins on refresh. Invalid, expired, full/started and unavailable cases remain explicit. The server uses one locked refusal for both full and started rooms, so copy states both possibilities. |
| Official crowns | Verified 256x236 alpha WebP reused by HUD, ready room, crown flights and result emblems. Defeat is a CSS desaturation/tilt treatment. The master is unchanged. Natural proportions, both flight destinations, dedupe, reduced motion and landing-time cue behavior remain intact. Unrelated trophies remain unchanged. |
| HUD identity | Self is left/blue and opponent right/red for either server seat. Names still derive through `battleIdentity`. Crown refs and values follow their authoritative owners. Both names, both seat permutations and mobile long-name cases verified. |
| Result identity | Self is top/blue and opponent bottom/red regardless of winner. Win/loss/draw fixtures preserve actual supplied crowns and winner badges. Waiting settlement remains waiting. Focus/exit and audio paths remain in the existing components. |

The [identity fixture report](final-ux-polish/review/identity-fixtures.json) covers 36 cases: both sizes, both players, both seat permutations, HUD and win/loss/draw, plus long-name/reduced-motion cases. Four additional screenshots inspect mid-flight crowns. Counter landing coordinates were checked against the actual rendered target bounds. No page errors, horizontal overflow or broken visible crown images were observed.

The [sharing and logged-out join report](final-ux-polish/review/invite-sharing.json) verifies text/icon/keyboard copying, native-share emulation, copy-link fallback and the host staying in the same real local room. Bob opened the invitation while logged out, signed in through the injected test provider, and joined once with zero creates and no automatic ready-up. The [error and fallback report](final-ux-polish/review/invite-errors.json) covers invalid/expired/locked/network/setup failures, onboarding return, share cancellation and selectable manual copy text.

## Real local multiplayer

Two complete matches used the unchanged battle server at its normal 100 ms tick with injected test authentication and mocked account reads.

| Match | Seats | Outcome and recovery |
| --- | --- | --- |
| [First report](final-ux-polish/review/local-multiplayer/m1-retry-report.json) | Endychog 0, Phantom 1 | 1,800 ticks, Endychog won 1-0, 62 accepted intents. Both clients had identical final hashes and replayIdentical true, zero page/console errors and zero failed asset loads. |
| [Second report](final-ux-polish/review/local-multiplayer/m2-resume-report.json) | Endychog 1, Phantom 0 | 1,800 ticks, Endychog won 2-1, 60 accepted intents. Both clients had identical final hashes and replayIdentical true, zero errors/failed loads. Phantom refreshed the invite URL during the active match and recovered the same seat: one initial join plus one resume, zero creates, resumed true. The URL contained only mode and room. |

Names, crown values, HUD left/right order, result top/bottom order and overflow were asserted on both devices at both sizes. Two expected deployment-on-structure refusals per player were retained as authoritative refusals. These are real simulation sessions with injected auth, not production account acceptance.

## Final validation

| Check | Result |
| --- | --- |
| Relevant client/input/room/session tests | 222/222 across 21 files, after the resume fix |
| TypeScript | Pass, both standalone typecheck and production build typecheck |
| ESLint on every changed TS/TSX file | Pass |
| Repository-wide ESLint | 24 existing errors and one warning in unchanged files, detailed below |
| Production build | Pass, 65 pages, original configuration and real Privy imports restored |
| QA cleanup | Temporary Privy source/alias, allowed-dev-origin setting and QA route removed. Original next.config.ts and tsconfig.json restored. Production chunks and route manifest checked for leaked QA identifiers/routes. |

The exact file list is in [changed-files.txt](final-ux-polish/changed-files.txt). Unrelated local `.fast-build/STATE.md`, DESIGN.md, messaging copy and demo-production files are preserved and excluded.

## Evidence limits

- Friends data and all auth/profile reads in local QA are controlled fixtures, clearly named in screenshots. They do not establish real account or production social acceptance.
- Multiplayer QA uses the unchanged real Colyseus `BattleRoom`/`BattleSession` and simulation, with injected identity, entitlement and patron dependencies. No real Privy login, NFT ownership, settlement, production writes or reward activation is claimed.
- Native sharing is a mocked supported browser API, including a simulated hidden-page interval and AbortError. Clipboard failure and manual text selection are browser tested. Installed WhatsApp/Telegram/Messages and physical-device share sheets remain unverified.
- Phone captures use Chromium viewport/touch emulation. Physical iOS/Android, Safari, PWA and subjective audio acceptance remain unverified.
- Repository-wide lint has 24 existing errors and one warning in unchanged files. Changed-file lint passes. Existing errors are CommonJS require rules in asset tooling/review scripts and explicit-any rules in two API test files. The warning is the existing dev progress image.

## Screenshots

Selected captures are committed in [review/fixtures](final-ux-polish/review/fixtures). The full local capture set and reusable QA scripts are outside the repository at `C:/Users/USER/Documents/ChogRoyale-Assets/final-polish-20261027`.

| Surface | Mobile | Desktop |
| --- | --- | --- |
| Friends, API fixture | [390x844 viewport](final-ux-polish/review/fixtures/390-populated-viewport-FIXTURE.png), [friend rows](final-ux-polish/review/fixtures/390-friends-scrolled-viewport-FIXTURE.png) | [1366x768 viewport](final-ux-polish/review/fixtures/1366-populated-viewport-FIXTURE.png) |
| Endychog HUD, shuffled seat 1 fixture | [390x844](final-ux-polish/review/fixtures/390x844-endy-endySeat1-active.png) | [1366x768](final-ux-polish/review/fixtures/1366x768-endy-endySeat1-active.png) |
| Phantom HUD, shuffled seat 0 fixture | [390x844](final-ux-polish/review/fixtures/390x844-phantom-endySeat1-active.png) | [1366x768](final-ux-polish/review/fixtures/1366x768-phantom-endySeat1-active.png) |
| Endychog victory fixture | [390x844](final-ux-polish/review/fixtures/390x844-endy-endySeat1-win.png) | [1366x768](final-ux-polish/review/fixtures/1366x768-endy-endySeat1-win.png) |
| Phantom defeat fixture | [390x844](final-ux-polish/review/fixtures/390x844-phantom-endySeat1-loss.png) | [1366x768](final-ux-polish/review/fixtures/1366x768-phantom-endySeat1-loss.png) |

Both outcomes and draw captures for both players are included in the same folder.

Real local ready-room, HUD and result captures are in [local-multiplayer](final-ux-polish/review/local-multiplayer):

| Surface | Mobile | Desktop |
| --- | --- | --- |
| Private host ready room | [390x844 viewport, full page capture](final-ux-polish/review/local-multiplayer/host-ready-390x844.png) | [1366x768 viewport, full page capture](final-ux-polish/review/local-multiplayer/host-ready-1366x768.png) |
| Joined room before ready-up | [390x844 viewport, full page capture](final-ux-polish/review/local-multiplayer/joined-not-ready-390x844.png) | [1366x768 viewport, full page capture](final-ux-polish/review/local-multiplayer/joined-not-ready-1366x768.png) |
| Endychog HUD, seat 1 | [390x844](final-ux-polish/review/local-multiplayer/alice-start-seat1-390x844.png) | [1366x768](final-ux-polish/review/local-multiplayer/alice-start-seat1-1366x768.png) |
| Phantom HUD, seat 0 | [390x844](final-ux-polish/review/local-multiplayer/bob-start-seat0-390x844.png) | [1366x768](final-ux-polish/review/local-multiplayer/bob-start-seat0-1366x768.png) |
| Endychog victory | [390x844](final-ux-polish/review/local-multiplayer/alice-end-seat1-390x844.png) | [1366x768](final-ux-polish/review/local-multiplayer/alice-end-seat1-1366x768.png) |
| Phantom defeat | [390x844](final-ux-polish/review/local-multiplayer/bob-end-seat0-390x844.png) | [1366x768](final-ux-polish/review/local-multiplayer/bob-end-seat0-1366x768.png) |
