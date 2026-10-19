# Project State

Last updated: 2026-10-19

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

### Chogling mesh audit (2026-10-19)

- Bounded r003 modular alternative stopped at external `chogling-production/r003-modular-animation-20261019-143753/01-chogling-modular-animated.blend`. Rigid capped head/fan, torso, arm/fist and leg/foot parts have two 24-frame walk/punch clips with fixed-camera transparent frames and 128/96/64 px loops. Verdict blocked: exposed hip/knee cuts, shoulder seams and weak small-size punch. Float64 rigid-area ratios are 0.9999998677..1.0000002463 across 98 samples, stance drift <=4.47e-8, walk ground gap <=0.000286639, and 186/186 protected files unchanged. Earlier float32 tiny-triangle flags were numerical cancellation, retained separately. No gameplay integration or Phaser runtime test. Recommended next method is a 2D cutout from approved views, not another 3D correction loop.
- Latest bounded correction is external `chogling-production/r002-final-rig-20261019-061500/07-chogling-corrected-rig.blend`, saved and reopened. Positions/topology/UV hashes match r001, 16 bones, one modifier, zero actions and normalized weights. Accepted belly correction affects 254 vertices. Packed-texture persistence bug fixed by loading edited PNGs as new images before packing. Preservation passed 124/124. Animation/readability verdict remains blocked: right-walk face 2387 area ratio 0.0810277, punch shoulder volume loss and visible crossings. Punch remains guard-like at 128/96 px, arm bend/punch unreliable at 64 px, squat close to neutral. Bounded correction stopped.
- Read-only audit files and original working blend remain in `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-3d-audit/textured-1beb2ae7-20261019-041632/`. Production candidates are separate in `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-production/r001-cleanup-rigprobe-20261019-043633/`. Final preservation validation passed for all 53/53 protected baseline files, including all three unchanged source GLBs.
- Final geometry deliverable: `04-chogling-cleaned.blend` without rig and `05-chogling-rigged.blend` with 16 bones, 15 deform bones. Final mesh has 8,780 vertices, 10,544 triangles, 5,309 positional-weld vertices across three components, and 66 boundary edges confined to the two fitted brow bases. Five small original boundary groups were closed with 23 cap triangles. All 10,521 original face UVs retain their hash, packed source pixels are unchanged, and mesh/UV degenerate counts are zero.
- Geometry changes were bounded: muzzle front-depth adjustment max +0.00587 Y; 101 shoulder-root vertices moved internally by max 0.006854, with no boundary positions moved. The original 251 strict crossing pairs rose to 255 after caps, then fell to 231: 207 fitted-brow pairs and 24 body pairs, including 18 remaining shoulder-root pairs plus 6 elsewhere. Earlier “waist” label was incorrect; the main ROI is at x about +/-0.1, z about 0.32-0.34 near shoulder roots. Do not describe all intersections as resolved.
- Rig probe: all 8,780 vertices have normalized weights, one armature modifier, zero actions. Nine static probes show no collapse below 10%, no coincident-seam tearing, and head rigidity error max 1.28e-7. Posed body crossings remain 24 neutral, 28 left, 31 right, 31 punch, 28 walk-left, 32 walk-right, 27 lean, 28 head, and 39 squat after contact correction. Foot-level and root-height corrections produce stance contacts near 1e-7 and max squat gap 0.000058, but do not establish IK or continuous-animation readiness. Verdict: static-deform feasibility prototype, not production-ready animation. No Tripo regeneration, game-code changes, or push.
