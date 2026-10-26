# Chog Royale visual overhaul: cloud handoff

Branch `visual-overhaul/v3-slice2` on `github.com/Devendurance/ChogRoyale`. Not merged, not deployed.

## Commits

- `1e1fa56` slice 1: player-relative orientation (red top, blue bottom, defenders keep directional aim during fire and hit).
- `88323d8` reference pack v1 (reference only, nothing game-ready).
- `9096930` slice 2: v003 pre-rendered arena and red/blue team defender mounts, v002 fallback.
- `5774ee0` slice 2.1: Bulwark and Chog Guardian identity correction, tower and arena polish. Complete, not WIP.
- `911bb69`: Blender scripts, review images and this handoff.
- `37a6c93` slice 3: animated Choglings and Boulderback, new card portraits, blue/red troop rings. Approved Slice 2.1 is the arena and defender baseline.
- `04fffaf` slice 3.1: Choglings and Boulderback identity refinement, rear three-quarter view for upward movement, 2x masters downsampled to board resolution, open hit ring for animated units.
- `1838fbe` slice 4 checkpoint: Blender sources for the remaining ten troops.
- `d7fb366` slice 4: sheets, portraits, runtime wiring, tests and review set for the remaining ten troops.
- Slice 4.1 (the commit after `d7fb366`): identity correction of seven models, original 2D card art restored in every card interface, static fallback death fade fix.

## Status

Done and integrated in Phaser: v003 arena (12 Blender layers plus the reused v002 Chaos overlays), four mount roles (`lane-red`, `king-red` Bulwark aiming south, `lane-blue`, `king-blue` Chog Guardian aiming north). Renderer falls back to v002 if v003 fails to load. Battle tests 121/121, typecheck, scoped lint and `next build` passed at `5774ee0`.

Slice 3: Choglings and Boulderback animate from pre-rendered sheets (idle, move, attack, hit, defeat) in `public/assets/chog-units/v001`, with new card portraits and the v001 sprite and portrait as fallbacks. Troop rings are now blue for the viewer and red for the opponent. Battle tests 135/135, typecheck and `next build` pass.

Slice 3.1: both units rebuilt toward their cards (wrap-around cyan sunburst, irregular stone plates and dominant boulder shoulders), every clip rendered in a front and a rear three-quarter view, view picked from screen-space heading in `unit-anim.ts` `nextView()`. Readiness doc section 13 has the details and the limits.

Slice 4: all twelve troop cards animate (idle, move, attack, hit, defeat in front and rear views) with new card portraits. Sources in `tools/blender/chog-units-v001/scripts/build_roster.py` and `roster_lib.py`. Flying units hover, ranged and air-hitting units engage air targets per the ruleset. Readiness doc section 14 has the details and the limits.

Slice 4.1: Frostshell, Rift Runner, Sparkcaster, Gale Netter and Riftbreaker rebuilt toward their cards, small silhouette fixes on Chaos Archer and Chog Guardian, and the static fallback sprites fade on death again. Owner decision: every card interface keeps the original 2D illustrations, and the 3D models are battlefield units only. The generated 3D portraits stay on disk unused. Readiness doc section 15 has the details and the limits.

Not done: owner approval of the Slice 3.1, Slice 4 and Slice 4.1 battlefield units, buildings, spells, commanders, `burrow_scrapper`, spell VFX, live two-login match, phone test, live tower fire, performance.

## Where things live

- Approved v3 handoff and art bible: `Chog_Royale_Visual_Overhaul_Handoff_v3_CORRECTED/` and `Chog_Royale_Devin_Asset_Reference_Pack_v1/07_APPROVED_V3_ART_BIBLE/`.
- Original 25-card identity (canonical): `Chog_Royale_Devin_Asset_Reference_Pack_v1/02_CARDS/01_CANONICAL_ORIGINAL_IDENTITY/`. 3D style studies: `02_CARDS/02_STYLIZED_3D_CONCEPTS_NOT_FINAL/`. Arena, tower, defender, material and lighting references: `01_ARENA/`, `03_MATERIALS/`, `04_LIGHTING_AND_STYLE/`.
- Game assets: `public/assets/arena/chaos-crossing/v003/` with runtime manifest `manifests/arena.runtime.json`.
- Unit sheets and portraits: `public/assets/chog-units/v001/` with `manifests/units.runtime.json`. Frame logic: `src/app/dev/battle/unit-anim.ts`.
- Asset queue: `docs/chog-asset-production-manifest.json`. History and limits: `docs/chog-visual-overhaul-readiness.md` sections 10 to 15.
- Review images: `docs/visual-overhaul/review/slice4-1/` (Slice 4 vs 4.1 models with 1x and 3x battle frames, mobile river-fight crops, seven contact sheets, both seats at 390x844, desktop, flyers, fallback, ring investigation), `docs/visual-overhaul/review/slice4/` (12-unit roster sheet with original card, 3D render, front and rear sprites and card art, batch identity reviews, ten contact sheets, native card checks, both seats at 390x844, desktop, river-fight zoom, two playback videos, air-crossing shots, fallback), `docs/visual-overhaul/review/slice3-1/` (original vs Slice 3 vs 3.1 comparisons, front and rear identity renders, contact sheets, native card check, both seats at 390x844, playback videos, fallback), `docs/visual-overhaul/review/slice3/` (unit comparisons, contact sheets, card check, both seats at 390x844, a short playback video, fallback), `docs/visual-overhaul/review/slice2-1/` (Bulwark and Guardian comparisons, assembled mounts, both seats at 390x844 and 1366x768 in `after/`, before/after, fallback) and `docs/visual-overhaul/review/slice2/` (slice 2 identity sheet and seat comparison).
- Renderer and registry: `src/app/dev/battle/BattleCanvas.tsx`, `src/app/dev/battle/arena-registry.ts` (tests beside it). Importer: `scripts/import-arena-v003.ts`.

## Blender pipeline

Copied into `tools/blender/chaos-crossing-v003/`:

- `scripts/common.py`: camera contract (ortho, 52 degree pitch, ground Y stretched by 1/cos), lights, materials, outlines.
- `scripts/build_arena.py`: the 12 arena layers on a 1200x1840 master. Writes `_geometry-check.json`, which must match expected pixels.
- `scripts/build_mounts.py`: four mount roles on 512x640 masters, plus identity renders. `PREVIEW=1` renders defenders only at 16 samples. `LOWQ=1` makes cheap test renders. Partial role rebuilds merge into `_mounts-record.json`.
- `scripts/export_gameplay.cjs`: downsamples to 600x920 layers and 256x320 mount parts, writes `manifests/display.json` and `mounts.json`.
- `scripts/preview.cjs`, `montage.cjs`, `assemble.cjs`: review composites.
- `manifests/`: last export manifests, mount record and geometry check.

The scripts hardcode the original Windows paths (`C:/Users/USER/Documents/ChogRoyale-Assets/arena-worlds/chaos-crossing/v003` as the workspace, and the repo `node_modules/sharp`). In the cloud, put the scripts in a workspace with `scripts/`, `masters/`, `gameplay/` and `manifests/` folders, then update `ARENA_ROOT` in `scripts/import-arena-v003.ts` and the sharp path in `montage.cjs` and `assemble.cjs`.

Rebuild order:
1. `blender -b --factory-startup --python scripts/build_arena.py -- <abs>/masters/layers`
2. `blender -b --factory-startup --python scripts/build_mounts.py -- <abs>/masters/mounts`
3. From the repo root: `node <workspace>/scripts/export_gameplay.cjs`
4. `npx tsx scripts/import-arena-v003.ts`

Units: `tools/blender/chog-units-v001/scripts/build_units.py` (imports `common.py` from the v003 scripts), then `pack_units.cjs <masters> <public>/assets/chog-units/v001 [review]`. `card_check.cjs <repo>/public <png> [prev_dir] [label]` renders the native-size card sheet. A full unit render with both views takes about 7 minutes. Slice 4 units build from `build_roster.py` with the same arguments and flags (about 5 minutes per unit, two Blender processes can run in parallel). The packer reads all twelve masters from one folder. Copy `masters-s31/choglings` and `masters-s31/boulderback` beside the Slice 4 masters before packing. `ChogRoyale-Assets/chog-units-v001/masters-s41` holds all twelve current masters. Card-only re-renders use `CARDONLY=1` without `PREVIEW`, and Choglings and Boulderback cards render through `build_roster.py` (`CARD_POSES_S31`). `PREVIEW=1` renders identity and gameplay stills for both views in about 25 seconds per unit.

Master renders and `.blend` files weren't committed. They regenerate deterministically from the scripts, and full renders take about 14 minutes.

## Tools the cloud needs

Node and the repo dependencies (`npm ci`, which includes sharp and playwright-core), Blender 5.2 with EEVEE (`BLENDER_EEVEE`, not `BLENDER_EEVEE_NEXT`) and its bundled numpy, and a GPU or software GL for EEVEE in headless mode. Checks: `npx vitest run src/app/dev/battle`, `npx tsc --noEmit`, scoped `npx eslint`, `npx next build`. Fixture captures need a qa-v2 harness page that isn't in the repo. `review/slice2-1/capture.cjs` documents the flow.

## Open identity and quality issues

- Bulwark's crest reads as a tall mohawk band, not the card's wide fan.
- Guardian spikes are straight faceted cones, not the card's curved painted spikes. From behind, a sliver of the cream face shows at the head edge.
- Primitive modelling is still below the painted concept boards.
- Defender poses are static. Fire and hit are code cues.

## Next step

Get owner review of the corrected troops in `review/slice4-1/`. Buildings, spells, commanders and `burrow_scrapper` remain on the v001 art.

## Rules for continuing

- Don't rebuild the v003 arena, mounts, importer or renderer. Refine the existing scripts and re-export.
- The original 2D card art is the live card art everywhere and the identity anchor. 3D assets are battlefield units only. Keep the Chog species identity (face mask, round eyes, blush, rear spike fan, heavy outline) and commander NFT likeness. Reject a prettier revision that is less recognizable.
- Keep the approved bright, saturated 3D look with warm upper-left light.
- Enemy red at the top and local blue at the bottom for both seats, from `owner === seat`. Never change server owner values. Top cannons aim down (`aim-south`), bottom cannons aim up (`aim-north`), including during fire and hit.
- Don't change gameplay, geometry, deployment bounds, input mapping, server or multiplayer code. Compare the weapon anchors and geometry check before importing.
- Keep v002 as the fallback. Don't crop concept or poster images into sprites.
- No push to main, merge or deploy without owner approval. Commit as `Devendurance <enduranceudoh888@gmail.com>` with no AI trailers.
