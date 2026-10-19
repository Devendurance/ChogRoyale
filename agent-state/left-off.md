# Left Off

Last updated: 2026-10-19

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
- Next: browser checks for B3.2b queue and B3.2c reconnect, then saved player loadouts.
- User review of the B2.7c5 hold. Swarm and breaker share a cheap core (choglings, sprites, snare, archer, guardian, scout) and both still beat revised control 0/16. Spawner building still waits on that review. No matches have been written to any database.

## Known issues / open items

- PROD has 7 leftover test players (did:privy:test_<8hex>, created 2026-10-18 13:42-17:00) with 5 wallets and 9 roles from the unrouted players.test.ts. Deleting them needs explicit user approval. Real player (did:privy:cmvcak...) untouched.

- Balance is bot-measured only (32 games/class). v11 round robin: bulwark 15, reaver 19, deadeye 23, scout 13, warden 10 (v10: 16/18/18/15/13). Earlier reaver 9/32 came mostly from the biased bot. Commanders rarely outlive one cooldown in bot play.
- Units have no unit-unit body collision yet (overlap allowed).

- Human E2E at `/dev/onboarding` still unverified (Privy login, wallet sync, claim flow).
- Public-gateway throttling returns if ingestion is ever re-run hard; use single-stream path.
- `commanders/[tokenId]` for 1969 returns pending-404 style response only if metadata missing; all resolved now, but handler behavior unchanged.
