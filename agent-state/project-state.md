# Project State

Last updated: 2026-10-18

## What this is

- Chog Royale: real-time 1v1 NFT-powered strategy game on Monad, private repo.
- Source of truth for slice history: `.fast-build/STATE.md` (detailed log).

## Stack

- Next.js 16 App Router, React 19, TypeScript, viem 2.57, Privy react 3.50 / server 1.32.
- Drizzle ORM + Neon Postgres; PROD via `DATABASE_URL`, isolated TEST branch via `DATABASE_URL_TEST`.
- Chain: Monad 143 (`rpc.monad.xyz`); Chog Genesis contract `0xc96d…73763`, totalSupply 1969.

## Architecture

- `src/lib`: chain, nft-contract (readOwner/readTokenUri/capability probe), discovery (range-exhaustion + boundary proof, no Enumerable), metadata (SSRF guards, size/timeout/redirect limits, sha256 provenance), commanders engine (ruleset v1: 5 classes, 123 signal rules, power-budget scoring), auth/wallets/onboarding/avatars.
- `src/db`: players (+wallets, roles), nfts (tokens/metadata/ownership observations/checkpoints/trait stats), commanders (rulesets/definitions), patrons (rulesets/immutable match assignments), chaos (rulesets/immutable pulse schedules), legacy (append-only events, achievement catalog + awards).
- `src/app/api`: health, players, nfts (+legacy/achievements per token), commanders, arena/patrons, arena/chaos (+ dev-only onboarding UI).
- `scripts`: ingest-nfts, nft-index (discover/ingest-missing/traits/sync-ownership/coverage), commanders-derive. All idempotent and resumable.
- Tests: vitest, 192 passing (46 combat); DAL routes to TEST via `CHOG_TEST_DB=1` (fail-closed, prod-forbidden).

## Key documents

- `.fast-build/STATE.md`: slice-by-slice build log (B0 through B1.3).
- `AGENTS.md`: working rules (no em-dashes, state protocol, test before claim).

## Decisions made

- Reuse existing B1.1/B1.2/B1.3 pipelines; never rebuild or fabricate metadata.
- Single-stream ingestion only (CONCURRENCY=1, 6s gateway spacing, Retry-After + exponential backoff); never launch competing workers.
- Failure writes never regress resolved metadata rows (fixes concurrent-worker race).
- Token 0 absent; collection = token IDs 1..1969; all metadata under one shared IPFS CID.
- Tier is prestige-only in commander derivation; tokenId is identity-only, never a stat input.

## Local asset workflow

- Reference workflow proposal: `docs/character-reference-workflow.md`. User selected five NFT commanders plus two original troops. Source evidence and original portraits are outside the repo in `C:/Users/USER/Documents/ChogRoyale-Assets/reference-research-20261018`.
- Verified v1 pilot IDs: 341 bulwark (CHOG #1802), 897 reaver (#389), 171 deadeye (#1632), 1128 scout (#620), 1720 warden (#1212). Original troop pilot: Choglings and Boulderback. Exporter and models are proposed, not implemented.

- c001 troop concepts (Codex image_gen, no references) rejected by the user. c002 troop concepts are hand-authored vector work in `original-troop-concept-review/c002/troop-concepts/`, pending review. Scout i001 approval covers only its red rear head/core and spikes.
- Blender 5.2.2 LTS is installed at `C:/Users/USER/AppData/Local/Programs/Blender Foundation/Blender 5.2/blender.exe`.
- Codex Desktop already has `mcp_servers.blender`, running `C:/Users/USER/AppData/Local/hermes/bin/uvx.EXE` with `mcp-for-blender`.
- Matching Blender add-on is enabled with saved preferences and telemetry disabled. The bridge listens on `127.0.0.1:9876`.
- Blender MCP verified end to end through scene inspection, test `.blend` save, GLB export, and a 384x384 PNG render inspected through MCP. Outputs are in `C:/Users/USER/Documents/ChogRoyale-Assets/mcp-verification-20261018`.
