# Left Off

Last updated: 2026-10-18

## Just finished

- B2.5 two-lane arena (ruleset v4, arena-v2): river, two bridges, RIFT_SHIFT ford, deterministic ground routing, lane objectives, target lock, territory + pocket deploys.
- B2.5 integrity hardening (ruleset v5): troops target commanders, solid structure footprints with detours, octile movement with carried remainder, legal-move bot runner, per-match entity ids, stronger replay tests.
- B2.6a commander card economy (ruleset v6): 7 ordinary + 1 commander card decks, deploy from hand for energy, no tick-0 spawn, hold-while-alive cycle policy, class-keyed runtime profile cp-v1 (free == NFT), tuned via real encounters. 249/249 tests + typecheck/lint/build green. Details in .fast-build/STATE.md.
- B2.6b player-controlled abilities (ruleset v7): the 5 actives fire only from validated AbilityCommands (ae-v1 costs 1/1/1 self, 2/2 area), deploy/onDeath triggers stay automatic, ability_ready/expired events, commanderAbilityStatus for a future button, bot policy botAbility. Full suite, typecheck, lint, build, scenarios, balance, runner green.

- B2.7a deployable buildings (ruleset v8): Rift Sentry (ground-only turret) and Decoy Totem (lure), solid footprints, crossing-mouth clearance, finite lifetimes, building-aware targeting. Full suite, typecheck, lint, build, scenarios, balance, runner green.
- B2.7b tactical cards (ruleset v9): Chaos Comet (delayed blast, 42 structure damage), Rift Snare (slow + chip), Rift Sprites (1e air pair), stale status-percent bug fixed, building matchup harness (npm run buildings:matchup). 295 tests, typecheck, lint, build, all scripts green. Details in .fast-build/STATE.md.
- Mirror fairness (ruleset v10): dev bot made side-neutral (per-player seeded lanes, mirrored depth, alternating first mover), zone band off-by-one fixed, engine mirror check 144/144, side wins now 36/36 and 35/37. Reaver is no longer weakest once the bot is fair.
- B2.7c1 (ruleset v11): Gale Netter (3e anti-air, 40 vs air, 12 vs ground) and Riftbreaker (4e demolition, 66 vs buildings, building-first targeting). Swarm spawn offset mirror bug fixed. v11 matchup (128 games) + engine mirror 128/128 x2. Neon DB test unverified (connect timeouts). Details in .fast-build/STATE.md.

## Currently working on

- Completed `docs/character-reference-workflow.md`, a proposal for five NFT commanders and two original troops. All five metadata-derived classes and saved derivation hashes match. Original 1000x1000 portraits visually reviewed and preserved outside repo with genuine metadata evidence. Source/API review found no issues. Lint, typecheck, 261 tests, and production build passed.
- Next for asset production: review the workflow, implement the narrow read-only exporter, then approve full-body interpretations and troop concepts before Tripo generation. No exporter, full reference packs, or models generated in this research task.

- No game feature recorded as in progress here. Preserve existing game work in the working tree.
- Local Blender MCP setup verified end to end through scene inspection, `.blend` save, GLB export, and a 384x384 PNG render inspected through MCP. Test outputs are in `C:/Users/USER/Documents/ChogRoyale-Assets/mcp-verification-20261018`.
- Verification uses a separate Blender instance, PID 31608, with the bridge at `127.0.0.1:9876`. Original Blender PID 28880 was left untouched.

## Next up

- Rerun src/db/nfts-index.test.ts when Neon is reachable. B2.7c2 roster (cheap swarm decks dominate the bot harness, Netter can sit dead in hand), then B3 transport (Colyseus): authenticated match creation, entitlement verification feeding the trusted engine inputs, settlement events feeding legacy intake. Neither started; no fabricated matches exist.

## Known issues / open items

- Balance is bot-measured only (32 games/class). v11 round robin: bulwark 15, reaver 19, deadeye 23, scout 13, warden 10 (v10: 16/18/18/15/13). Earlier reaver 9/32 came mostly from the biased bot. Commanders rarely outlive one cooldown in bot play.
- Units have no unit-unit body collision yet (overlap allowed).

- Human E2E at `/dev/onboarding` still unverified (Privy login, wallet sync, claim flow).
- Public-gateway throttling returns if ingestion is ever re-run hard; use single-stream path.
- `commanders/[tokenId]` for 1969 returns pending-404 style response only if metadata missing; all resolved now, but handler behavior unchanged.
