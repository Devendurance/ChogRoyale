# Left Off

Last updated: 2026-10-18

## Just finished

- B2.5 two-lane arena (ruleset v4, arena-v2): river, two bridges, RIFT_SHIFT ford, deterministic ground routing, lane objectives, target lock, territory + pocket deploys.
- B2.5 integrity hardening (ruleset v5): troops target commanders, solid structure footprints with detours, octile movement with carried remainder, legal-move bot runner, per-match entity ids, stronger replay tests. 232/232 tests + typecheck/lint/build green. Details in .fast-build/STATE.md.

## Currently working on

- Nothing in progress.

## Next up

- B2.6 commander deck changes, B2.7 expanded cards/buildings, then B3 transport (Colyseus): authenticated match creation, entitlement verification feeding the trusted engine inputs, settlement events feeding legacy intake. Neither started; no fabricated matches exist.

## Known issues / open items

- Balance: a lone free commander destroys 2 towers + Core in ~235-400 ticks (B2.3 1:1 stat mapping). Must be addressed in B2.6.
- Units have no unit-unit body collision yet (overlap allowed).

- Human E2E at `/dev/onboarding` still unverified (Privy login, wallet sync, claim flow).
- Public-gateway throttling returns if ingestion is ever re-run hard; use single-stream path.
- `commanders/[tokenId]` for 1969 returns pending-404 style response only if metadata missing; all resolved now, but handler behavior unchanged.
