# CHOG ROYALE — VISUAL OVERHAUL / CODEX HANDOFF v3.0
**Approved visual direction · corrected 25 October 2026 (identity-preserving revision)**

## Read first
This bundle translates the user's approved Chog Royale concepts into an engineering/art-production brief for an existing Phaser game. It is **not** a bundle of finished game-ready animated sprites or 3D models. References are flattened concept illustrations. Keep the game a 2D/2.5D Phaser project unless repository evidence and the owner explicitly justify a change.

## MOST IMPORTANT v3 CHANGE
The project direction is now explicitly:
> **Make Chog Royale look premium, bright, and stylized in a Clash-Royale-level quality band, while preserving the original Chog identity and commander/NFT recognizability.**

If there is ever a conflict between **generic polish** and **recognizable Chog identity**, **Chog identity wins**.

### Approved source of truth, in precedence order
**NON-NEGOTIABLE: read `docs/00_TEAM_ORIENTATION_LOCK.md` and `docs/00B_CHOG_IDENTITY_LOCK.md` before any changes.**

1. `docs/00_TEAM_ORIENTATION_LOCK.md` — final local-player POV rules. **ENEMY RED on TOP, LOCAL PLAYER BLUE on BOTTOM.** Top red cannons/defenders face downward toward the player; bottom blue cannons/defenders face upward toward the enemy. Previous reversed-color and wrong-facing drafts must not be used.
2. `docs/00B_CHOG_IDENTITY_LOCK.md` — final identity-preservation rules. The original 25-card roster is the canonical identity anchor for species, silhouette, commander/NFT likeness, signature props and recognizable personality.
3. `references/ARENA_CORRECTED_red_top_blue_bottom.png` — corrected composition reference for the APPROVED bright, lush crystal-river arena: **ENEMY RED on TOP; LOCAL PLAYER BLUE on BOTTOM**. This preview is a color/defender compositing mock based on the approved arena, not production-ready layered art.
4. `references/APPROVED_five_character_direction.png` — approved **quality / render / material / polish direction** for Choglings, Boulderback, Sparkcaster, Bulwark, Warden. This is a style-quality reference, **not a license to genericize away from Chog identity**.
5. `references/BEFORE_roster_25_cards.png` and `references/BEFORE_roster_25_cards_compact.png` — canonical baseline identities for all 25 cards.
6. `references/BEFORE_match_arena.png` — baseline match environment.
7. `docs/01_ART_BIBLE.md`, `docs/02_ARENA_SPEC.md`, and `docs/03_ASSET_PIPELINE.md` — implementation-specific interpretation.

### What's in the pack
- `docs/00_TEAM_ORIENTATION_LOCK.md`: highest-priority team/orientation/facing rules.
- `docs/00B_CHOG_IDENTITY_LOCK.md`: highest-priority character identity and commander/NFT fidelity rules.
- `docs/01_ART_BIBLE.md`: global art direction + all 25 card-specific visual briefs.
- `docs/02_ARENA_SPEC.md`: layered arena, tower identity, camera/lighting, layout preservation, and cannon-facing direction.
- `docs/03_ASSET_PIPELINE.md`: exactly what a playable 2.5D asset deliverable requires.
- `docs/04_ROADMAP_AND_ACCEPTANCE.md`: ordered slices, gates, quality and performance criteria.
- `docs/05_CODEX_PROMPT_01.md`: start here in the Chog Royale repo.
- `docs/06_CODEX_PROMPT_02.md`: use later once genuine animation atlases exist.
- `manifests/cards.json`: all 25 cards in machine-readable form; descriptors are visual/production labels, not verified game mechanics.
- `manifests/required_assets.json`: expected asset families and readiness gates.
- `references/`: approved concept art and before screenshots.

### Critical reality check
- A 3D-looking PNG is still a 2D image. No rig, animation frames, 3D geometry, texture atlas, collision model, or clean layer separation is embedded in the concept images.
- The corrected arena reference has baked-in towers, defenders, water, and scenery. Do not use it as a single live game background under independent towers without accounting for duplicates, overdraw and obscured units. It is an art-direction reference until separated production layers exist.
- The five-character poster is **not** five production sprite atlases. Do not crop small poster panels into battlefield sprites and claim the overhaul is finished.
- Codex can integrate, debug and test assets; asset art still needs to be genuinely produced. An asset generator, artist, 3D pipeline or curated pre-rendered animation source is required to fill missing assets.
- No repository has been inspected to make this brief. Inspect the actual project before changing architecture, routes, asset registries, game state, positions, animations, or renderer behavior.

## Owner-approved facts vs proposed implementation
**Approved:** stylized 3D-inspired character artwork; bright fantasy crystal arena; **red ENEMY top / blue LOCAL PLAYER bottom**; top red cannons face down, bottom blue cannons face up; tower-mounted actual Chog Royale character identity; retain Phaser; Option A (pre-rendered 2.5D sprites); preserve original Chog species feel and commander/NFT recognizability.

**Proposed pending repo validation:** animation list and directional views; asset folder naming; size tiers; categorization of last five cards as commanders; specific tower defenders (Chog Guardian-like on blue, Bulwark-like on red); implementation milestones and technical approach. Verify in existing code and gameplay before treating those as mechanics.

## Recommended first action
Put this folder in the repo as a design/handoff folder (not automatically in its public asset directory) and run `docs/05_CODEX_PROMPT_01.md` with Codex from the repo root. Do not ask Codex to replace all 25 visuals in a single uncontrolled pass.
