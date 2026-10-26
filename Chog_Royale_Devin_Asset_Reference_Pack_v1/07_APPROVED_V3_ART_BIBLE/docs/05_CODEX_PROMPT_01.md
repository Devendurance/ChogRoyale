# CODEX — PROMPT 01 (RUN THIS FIRST IN THE CHOG ROYALE REPO) — v3

You are implementing a **bounded first vertical slice** of the approved Chog Royale 2.5D visual overhaul in the CURRENT repository. Read `Chog_Royale_Visual_Overhaul_Handoff_v3_CORRECTED/README.md` and docs 00, 00B, 01–04 and inspect its `references/` images and manifests first. Treat the references as visual authority, **NOT as ready-to-use atlas assets**.

## APPROVED DIRECTION
- Keep Phaser and current game rules. Bright, polished, premium original stylized-3D *appearance via 2D pre-rendered assets*.
- Arena: lush sunlit grass, turquoise middle river, two wooden/stone bridges, vibrant crystals/flora, six Chog-themed towers.
- **LOCKED player POV:** ENEMY RED on TOP; LOCAL PLAYER BLUE on BOTTOM.
- **LOCKED facing:** TOP/RED tower cannons and mounted defenders face DOWN toward the player side. BOTTOM/BLUE tower cannons and mounted defenders face UP toward the enemy side.
- Mounted defenders must be recognizable Chog Royale characters, not generic humans: TOP RED Bulwark-style defenders; BOTTOM BLUE Chog Guardian-style defenders, subject to actual gameplay data.
- **Identity lock:** Do not genericize characters. Preserve original Chog species feel and commander/NFT recognizability. The original 25-card roster is the canonical identity anchor. The approved five-character poster is a style/polish benchmark, not a loose redesign brief.
- Full 25-card roster covered in art bible. Approved five-character poster is design reference only.

## FIRST, READ ONLY RELEVANT REPO FILES
Establish Phaser version, battle scene, entity render/animations, asset paths, UI card art loader, tower placement, bridge/river collision/pathing, team orientation and tests. Do not perform a broad audit. Read `git status` and preserve unrelated changes. Identify exact code-to-asset mapping and what visual source assets already exist.

## IN THIS FIRST SLICE
1. Write a compact factual file `docs/chog-visual-overhaul-readiness.md` (or reuse existing docs convention) with render architecture, immutable gameplay invariants, current asset registry, actual readiness of new standalone animation/arena layers, key blockers, and plan for a single playable visual slice. Identify all 25 card IDs in existing data, noting any naming/category differences from `manifests/cards.json`.
2. If enough **actual separate arena assets** exist, implement the smallest playable arena presentation improvement using existing scene/loader/layers, maintaining all existing battlefield geometry, legal bridge paths, spawning/deployment areas, hitboxes, towers, attack state, HP bars and UI. Correct draw order, brightness, tower orientation, and attachment/pivot handling. Keep a simple safe fallback to old assets, following the project's existing practices.
3. If separated approved-style art assets DO NOT exist, **do not pretend** the flattened approved arena is a finished playable background. You may implement a low-risk asset registration/render-layer seam and a restrained visual polish pass using current real assets (e.g. non-dark grass grading, contact shadows, sensible depth) ONLY if visibly beneficial and safely testable. Otherwise stop after the actionable readiness report. Explain exactly which assets are blocking faithful overhaul.
4. Do not replace characters with cropped poster images. Do not fabricate animation frames or replace existing animation with static pictures. Do not build a new game, change the engine, edit domain values, or alter routing/AI/physics/netcode.
5. Treat **identity drift as a bug**. If a new asset or concept pass makes units feel less like the original Chogs or commanders/NFTs, document it and block approval.
6. Run the smallest relevant tests/typecheck/build/lint available; inspect a gameplay scene visually if browser capture is available. Report exact changed files, commands/results, screenshots (if captured), completed vs blocked, and NEXT asset dependencies. Clearly distinguish "code ready" from "final art installed".

## ACCEPTANCE
- No gameplay regressions.
- Opponent red rendered above local-player blue.
- Top red towers face down; bottom blue towers face up.
- No blue/red logical ownership inversion.
- No doubled baked-in towers/bridge objects.
- No dead-on-arrival image paths.
- No misleading claim of a 25-card finished revamp.
- No identity drift away from original Chog / commander recognizability.
- Preserve existing branch state; don't push or deploy without approval.

Work within this one bounded slice and stop with a precise handoff.
