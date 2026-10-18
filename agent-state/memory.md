# Memory

Durable facts, conventions, and gotchas that should survive across sessions.

## User workflow

- Long sessions keep state in `agent-state/`: `project-state.md`, `memory.md`, `left-off.md`.
- Rules and preferences live in `AGENTS.md`. Read it first.
- Auto-commit and push meaningful checkpoints per current `AGENTS.md`. Repo stays private.
- Blender experiments and test outputs belong in `C:/Users/USER/Documents/ChogRoyale-Assets`, outside the source repository. Reuse the existing MCP connection, bind its bridge to loopback, and preserve live Blender work.

## Project facts

- Env names (never values): `DATABASE_URL`, `DATABASE_URL_POOLED`, `DATABASE_URL_TEST`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `IPFS_GATEWAYS` (unset, defaults to filebase + pinata), `CHOG_TEST_DB`.
- Commander free starters are in-code templates (`free-<class>`), not DB rows.
- Trait model: distinct-NFT counts, str/num-distinct, nulls excluded (Accessory/Side sparse by design).
- Tier distribution: Common 1279 / Uncommon 590 / Rare 60 / Epic 30 / Legendary 10.
- Ownership authority is the transfer-event scan (`ownership-transfers` checkpoint); ingest re-checks are belt-and-suspenders.

## Gotchas

- On-chain token IDs differ from artwork/display numbers. Always follow `token_uri_original` and `image_original`, never build filenames from token ID.
- `nft_metadata.content_hash` hashes fetched JSON bytes. JSONB exports preserve semantics and need a separate exported-file hash. Commander hashes are separate derivation hashes.
- Chog visual DNA (measured on r001 pixels): cream face #eee8d8, or brown #552d1f to #613222 on Skin Black. Backswept 4 to 5 two-tone rear spikes in the Skin color (Red #ee0e0e, Origin violet #5c36b1, Black charcoal #212327 with grey #919191). Blush #d6407c on all five samples. No nose, no ears. Skull form has no spikes. Collection: Form Chog 1899 / Skull 60, Side Right 1309 / Left 650. Skin Pink 557 and Yellow 246 are not in the local samples.
- Image read tool keeps only the last two images, so view at most two per call and record observations right away.
- NFT portrait Skin trait colors can describe outer spikes rather than the face. Sample region colors from real artwork. `DESIGN.md` is referenced but missing.

- Public IPFS gateways throttle sustained streams: filebase serves 200 in ~1s when idle but 429s under load; pinata and dweb 429 even single requests. Fix is idle cooldown + single-stream, not retries. Dedicated gateway would need signup + key in `IPFS_GATEWAYS`.
- Monad public RPC is slow and variable (multi-second reads); tokenURI is immutable on-chain so re-reads are skippable when DB already has URI + owner.
- drizzle-kit migrate CLI fails silently (exit 1, no error) against the TEST branch; PROD works. Workaround: scripts/migrate-test-run.ts applies ./drizzle via the app Neon client. Keep the script for future migrations.
- Earlier 896-vs-895 commander drift was a concurrent-worker race (failure write overwrote a resolved row). Guarded in `recordMetadataFailure`; self-heals on re-ingest.
- Dev server on :3000 only; :3100 is blocked by Privy frame-ancestors allowlist. Stale :3000 compile once served 500 on `commanders/[tokenId]`; restart fixes.
- Windows/git-bash quirks: `$_` in inline powershell gets eaten, use temp `.ps1` files and delete after; `tasklist` needs `//FI`; `wmic`, `setsid` unavailable; background jobs survive tool timeouts, always re-check process list.
- Combat movement (v5) is cell-by-cell octile: straight 10, diagonal 14, budget speed*10 plus carried remainder (moveCarry). Route costs use octile too. Equal-cost crossing ties still occur, so ties break on smallest lateral detour first.
- Structure reach is measured to the footprint ring (half-size + 1), so melee units stop up to `range` cells outside the ring. Test "arrived" with reach2, not center distance.
- Use stepMatch freely in tests: entity ids come from state.nextEntityId, so stepped runs and runMatch produce identical hashes.
- v6 configs: every deck is 7 ordinary + `cmdr:<commanderId>` and needs a commander slot. Use deckWith()/scenarioConfig() (src/lib/arena-scenarios.ts), which default to cmdr:free-bulwark last and infer free slots. freeStarterSlot(cls) builds trusted free snapshots.
- Commander combat numbers live in COMMANDER_COMBAT_PROFILE_V1 / ABILITY_RUNTIME_V1 (combat.ts), never in B1 stats. Bot round robins are cost-sensitive: deadeye at cost 4 jumped to 29/32 wins.
- Bots must play the commander deliberately (botMove saves energy for a held commander); without that, commanders were almost never deployed and balance data was meaningless.
- Structures only fire on tick % 10 === 0. Use a no-troop control run to isolate troop damage, not tick parity.
- Arena-v2 river is y 74..86: test deploys at y 74..86 are rejected. Use y<=73 (p0) or y>=87 (p1).
- Scenario evidence lives in src/lib/arena-scenarios.ts (shared by tests and scripts). botMatch plays from real hands. Hand-blind fixed command lists get mostly rejected.
- Bot decisions must stay mirror-equivariant (bot-fairness.test.ts): no shared counters across players, p1 coordinates are y -> 160 - y mirrors, first mover alternates. Same-tick seq order changes entity ids and id tie-breaks, so a fixed P0-first order biases results. Check engine symmetry with engineMirrorCheck before trusting win rates.
- engineMirrorCheck only covers cards in the decks it runs. Any per-player offset in spawn/targeting must point "toward own home" (P0 -y, P1 +y), never a fixed +y (v10 swarm bug, found only once choglings entered the v11 mirror decks). Add every new card to a mirror-checked deck.
- Same-deck "mirror" matchup games are not true mirrors: each player's lane counter uses its own seed offset. Proven with laneSwapCheck (botMatch swapSides): swapping lane sequence + turns swaps every outcome exactly without Chaos and with mirrored Chaos. Through v12 the raw riftSchedule was NOT side-neutral (31/40 exact). v13 fixed it in combat interpretation (40/40).
- Ranked Chaos rule (v13): B1 schedules name absolute zones (north = P1 home third, south = P0 home third). Combat closes Ember Rift / Rift Shift zone sets under the y mirror and spreads the authored budget over the closure (rankedChaosZones, rankedHazardTick). Never change B1 chaos.ts for this. Frost/Surge/Rally are board-wide. Evidence: npm run chaos:fairness, src/lib/chaos-fairness.test.ts.
- DB test isolation: every DAL-writing suite calls routeDalToTestDb() in beforeAll. getDb() throws under VITEST without it (players.test.ts once wrote to PROD this way). requireTestDatabaseUrl also refuses the prod endpoint via pooled/direct URL variants. Fixed-id suites list their owned fixture ids up front and clean them in beforeAll AND afterAll with batched inArray deletes. hookTimeout is 60s because a 10s hook abort left rows that broke the next run (legacy idempotency: 3 false failures, reproduced).
- Any engine tie-break that orders by y must be owner-relative (P0 -y, P1 +y). v14 fixed detourCorner, which sent both players toward -y on equal-cost footprint detours. Smarter bots reach new states, so run the per-tick mirror-decision probe for every new policy.
- Two bot policies: botMove (simple baseline, first affordable card) and smartMove (src/lib/smart-bot.ts). Pass policies via botMatch opts.policies / runMatchup 4th arg. Neither bot wastes meaningful energy at 20-tick cadence, so cap waste isn't a balance lever.
- Anything added to the per-tick `damage` map must be added BEFORE the damage pass in stepMatch. Ember Rift hits were queued after the pass and silently dropped from B2.3 to v12 (found in v13). Test real HP effects, not only events.
- Measure scenario encounters at the decisive tick (last swarm death, attacker death). After that, survivors walk into towers and fixed-horizon HP/loss numbers mislead.
- Live browser E2E (Privy login) needs a human; no headless token path (dashboard test credentials disabled).

## B3.1 battle transport (Colyseus 0.18)
- Never set `client.auth.token` in @colyseus/sdk: it appends `_authToken=<token>` to the WebSocket URL. Pass the Privy token as `new Client(url, { headers: { authorization } })`; only the matchmaking POST carries it, read by the room's static `onAuth`.
- @colyseus/ws-transport imports `express` statically despite listing it as optional; express 5.2.1 is a direct dep.
- `npm run battle:server` takes about 20s to start (Privy server-auth import graph). Killing the npm shell can leave the tsx child listening on 2567.
- npm installs need `--legacy-peer-deps` because of the pre-existing @types/node ^20 vs vitest peer conflict.
