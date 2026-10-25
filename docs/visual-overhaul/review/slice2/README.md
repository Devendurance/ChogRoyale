# Visual overhaul v3 slice 2 evidence

Fixture presentation evidence only. It covers the temporary qa-v2 harness and recorded local-engine snapshots. It isn't a live two-login match, a phone test or a performance test.

- `after/`: both seats at 390x844 and 1366x768, with full-page and board-only captures. `evidence.json` holds the Phaser scene probe: layer flips, tints and visible defender texture keys.
- `fallback-v002/`: the same fixture with the v003 manifest forced to 404. The renderer falls back to v002 with the slice 1 behaviour. The only errors are the two intentional 404s.
- `seat0-vs-seat1.png`: the two seats side by side. Both show red Bulwark towers on top and blue Chog Guardian towers at the bottom.
- `identity-vs-original.png`: original Bulwark card, the v003 Bulwark model, original Chog Guardian card, the v003 Guardian model.
- `king-mounts.png`: the king-red and king-blue mount assemblies.
- `capture.cjs`: the capture script. Copy the qa-v2 harness into `src/app/dev/battle/qa-v2/page.tsx`, run `next dev`, run `node capture.cjs`, then delete the harness. Set `LABEL=x FALLBACK=1` for the fallback run.
- `make-asset-manifest.cjs`: writes `docs/chog-asset-production-manifest.json`.

Asset sources live in `../arena-worlds/chaos-crossing/v003/`: `scripts/`, `masters/` (1200x1840 layers and 512x640 mounts, with `.blend` files), `gameplay/` (runtime exports) and `manifests/`. Rebuild steps:

1. `blender -b --factory-startup --python scripts/build_arena.py -- <abs>/masters/layers`
2. `blender -b --factory-startup --python scripts/build_mounts.py -- <abs>/masters/mounts`
3. From the repo root, `node <v003>/scripts/export_gameplay.cjs`
4. `npx tsx scripts/import-arena-v003.ts`
