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
- Earlier 896-vs-895 commander drift was a concurrent-worker race (failure write overwrote a resolved row). Guarded in `recordMetadataFailure`; self-heals on re-ingest.
- Dev server on :3000 only; :3100 is blocked by Privy frame-ancestors allowlist. Stale :3000 compile once served 500 on `commanders/[tokenId]`; restart fixes.
- Windows/git-bash quirks: `$_` in inline powershell gets eaten, use temp `.ps1` files and delete after; `tasklist` needs `//FI`; `wmic`, `setsid` unavailable; background jobs survive tool timeouts, always re-check process list.
- Live browser E2E (Privy login) needs a human; no headless token path (dashboard test credentials disabled).
