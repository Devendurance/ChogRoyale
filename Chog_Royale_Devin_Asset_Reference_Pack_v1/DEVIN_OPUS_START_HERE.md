# DEVIN + OPUS — CHOG ROYALE VISUAL OVERHAUL / ASSET PRODUCTION HANDOFF

Current repo state provided by owner: Slice 1 locally committed as `1e1fa56` on `visual-overhaul/v3-slice1`; 115 tests passing; seat-relative team mapping fixed; no final approved-style art integrated yet. Treat this as reported context and verify it in the repo.

## Source and priority
Read `README.md`, `manifest.json`, `card_manifest.json`, and `07_APPROVED_V3_ART_BIBLE/docs/00_TEAM_ORIENTATION_LOCK.md` + `00B_CHOG_IDENTITY_LOCK.md`. Then inspect relevant game render/asset registry and source truth in repo. Use 2D originals as CANONICAL character identity; stylized 3D concept renders as ART QUALITY/MATERIAL references only.

## Immediate task — bounded asset-production planning + one playable vertical slice
1. Inventory actual asset paths, battle scene, exact 600x920 arena coordinates and layer registry, tower sockets/anchors and existing unit render/animation contracts. Do not change core engine/combat state.
2. Create a production `asset_manifest` that maps every requested final runtime asset to its required source concept PNG and canonical Chog identity. Treat bundled reference crops as **not game-ready**. Do not rename generic generated images as final art or extract a fake 3D model from them.
3. Determine what dedicated image-production or modeling/pre-rendering pipeline is available. If no such pipeline is available, do not claim to have produced all missing artwork. Provide a concrete queue and implement only real visuals from genuine sources.
4. Start with separated arena terrain/tower layers and TWO correctly aimed mounts, then Choglings and Boulderback. New sources must have transparent alpha where required and correct registration/anchors. Use the current repo's atlas/animation conventions.
5. Compare each new character to its original 2D source. Reject a redesign if it loses Chog eyes/face/crest or commander NFT's unique features even if the shading looks premium.
6. Verify both seats in current dev fixtures and at least one live match if feasible; do not assert mobile/live/performance passed without testing.
7. Report produced files vs still missing assets, changed repo files, exact test results, and visual screenshots. Do not push, open PR, or deploy without owner approval.

## Non-negotiables
- ENEMY RED TOP / LOCAL PLAYER BLUE BOTTOM, irrespective of immutable network seat.
- RED cannon/defender on top points DOWN. BLUE cannon/defender at bottom points UP. Static illustrations sometimes show incorrect facing; this written lock takes precedence.
- Do not bake six towers into a base terrain layer, duplicate bridge assets, or drift terrain away from path/collision geometry.
- 25 cards = 12 troops, 4 buildings, 4 spells, 5 commanders. Plus additional spawn-only `burrow_scrapper` reported by Slice 1 (not counted among the 25 cards).
- Preserve existing gameplay code, touch targets, camera, nav/pathing, combat and multiplayer networking.
- No unapproved generic fantasy replacements.
