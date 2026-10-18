# Left Off

Last updated: 2026-10-18

## Just finished

- B2.5 two-lane arena (ruleset v4, arena-v2): river, two bridges, RIFT_SHIFT ford, deterministic ground routing, lane objectives, target lock, territory + pocket deploys. Scenarios A-K via `npm run arena:scenarios`; 219/219 tests + typecheck/lint/build green. No migration, no PROD writes. Details in .fast-build/STATE.md.

## Currently working on

- Nothing in progress.

## Next up

- B2.6 commander deck changes, B2.7 expanded cards/buildings, then B3 transport (Colyseus): authenticated match creation, entitlement verification feeding the trusted engine inputs, settlement events feeding legacy intake. Neither started; no fabricated matches exist.

## Known issues / open items

- Human E2E at `/dev/onboarding` still unverified (Privy login, wallet sync, claim flow).
- Public-gateway throttling returns if ingestion is ever re-run hard; use single-stream path.
- `commanders/[tokenId]` for 1969 returns pending-404 style response only if metadata missing; all resolved now, but handler behavior unchanged.
