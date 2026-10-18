# Memory

Durable facts, conventions, and gotchas that should survive across sessions.

## User workflow

- Long sessions keep state in `agent-state/`: `project-state.md`, `memory.md`, `left-off.md`.
- Rules and preferences live in `AGENTS.md`. Read it first.
- Do not push without explicit approval. Repo stays private.
- Meaningful checkpoints get committed (per AGENTS.md auto-commit rule); push only when approved.

## Project facts

- Env names (never values): `DATABASE_URL`, `DATABASE_URL_POOLED`, `DATABASE_URL_TEST`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `IPFS_GATEWAYS` (unset, defaults to filebase + pinata), `CHOG_TEST_DB`.
- Commander free starters are in-code templates (`free-<class>`), not DB rows.
- Trait model: distinct-NFT counts, str/num-distinct, nulls excluded (Accessory/Side sparse by design).
- Tier distribution: Common 1279 / Uncommon 590 / Rare 60 / Epic 30 / Legendary 10.
- Ownership authority is the transfer-event scan (`ownership-transfers` checkpoint); ingest re-checks are belt-and-suspenders.

## Gotchas

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
- Live browser E2E (Privy login) needs a human; no headless token path (dashboard test credentials disabled).
