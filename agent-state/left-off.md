# Left Off

Last updated: 2026-10-18

## Just finished

- B2.5 two-lane arena (ruleset v4, arena-v2): river, two bridges, RIFT_SHIFT ford, deterministic ground routing, lane objectives, target lock, territory + pocket deploys.
- B2.5 integrity hardening (ruleset v5): troops target commanders, solid structure footprints with detours, octile movement with carried remainder, legal-move bot runner, per-match entity ids, stronger replay tests.
- B2.6a commander card economy (ruleset v6): 7 ordinary + 1 commander card decks, deploy from hand for energy, no tick-0 spawn, hold-while-alive cycle policy, class-keyed runtime profile cp-v1 (free == NFT), tuned via real encounters. 249/249 tests + typecheck/lint/build green. Details in .fast-build/STATE.md.
- B2.6b player-controlled abilities (ruleset v7): the 5 actives fire only from validated AbilityCommands (ae-v1 costs 1/1/1 self, 2/2 area), deploy/onDeath triggers stay automatic, ability_ready/expired events, commanderAbilityStatus for a future button, bot policy botAbility. Full suite, typecheck, lint, build, scenarios, balance, runner green.

## Currently working on

- Nothing in progress.

## Next up

- B2.7 defensive building cards, then B3 transport (Colyseus): authenticated match creation, entitlement verification feeding the trusted engine inputs, settlement events feeding legacy intake. Neither started; no fabricated matches exist.

## Known issues / open items

- Balance is bot-measured only (32 games/class). Under manual abilities reaver is weakest (9/32), bulwark/deadeye strongest (22/21). Activation cost is the dominant lever. Commanders rarely outlive one cooldown in bot play.
- Units have no unit-unit body collision yet (overlap allowed).

- Human E2E at `/dev/onboarding` still unverified (Privy login, wallet sync, claim flow).
- Public-gateway throttling returns if ingestion is ever re-run hard; use single-stream path.
- `commanders/[tokenId]` for 1969 returns pending-404 style response only if metadata missing; all resolved now, but handler behavior unchanged.
