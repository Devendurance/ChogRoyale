# CHOG ROYALE — IMPLEMENTATION ROADMAP & DEFINITION OF DONE

## Guiding principle: vertical slices, not a mass skin swap
Character/arena approvals are **visual approvals**, not evidence that production game assets exist. Replacing 25 cards in one blind coding pass is disallowed. Land one playable slice, confirm it against references, then scale.

### Stage 0 — Repo truth and asset readiness (Codex first task)
- Determine Phaser version, scene composition, camera coordinate system, portrait/landscape scaling, assets/texture loaders, unit/view/animation registry, tower/river/pathfinding data, card UI, test setup.
- Determine whether the five commanders in images are actually domain type commanders. Record facts without modifying mechanics.
- Find existing game assets and naming, reconcile with 25-card manifest; create evidence-based readiness status and missing asset list.
- Capture existing battle screenshot and relevant unit/card rendering sample if toolchain supports it.
- Establish a small safe visual integration seam and a feature flag to choose current visuals vs new visual assets, *only if beneficial to the current architecture*.

### Stage 1 — Arena in Phaser, playable
- Produce or procure source-separated terrain, river, bridge, tower, rails/occluders and decoration images according to approved concept and exact existing geometry.
- Wire separated assets through current loader and layering, keeping current combat positions and routing identical.
- New bright color/lighting, contact shadows, water motion with conservative performance limits; no baked gameplay towers in background.
- Correct player-relative art orientation: **RED enemy at TOP / BLUE local player at BOTTOM**. Confirm orientation using actual local-player state rather than hardcoded multiplayer identifiers. Preserve team ownership, tower targeting, deploy boundaries and bridge paths.
- Test tower targeting, placement, collisions and both bridges; compare actual capture against reference.

**Stage 1 gate:** full 6-tower arena looks recognizably like approved art, all units/towers interact normally, no doubled towers, no occlusion/pathing regressions.

### Stage 2 — First two characters plus card/UI sample
- Produce production-ready battle frames (not poster crops) for Choglings and Boulderback for actual states/directions used.
- Integrate using existing unit IDs/animation controller or smallest adapter, preserving old-asset fallback.
- Apply correct feet pivot, HP/target UI depth, contact shadows and directional handling.
- Add updated card art for both and visually verify at compact and full sample sizes.

**Stage 2 gate:** idle/move/attack/hit/defeat (as applicable) visibly correct under real match conditions; no jitter/cropping/vanishing characters; no state-to-animation mismatches.

### Stage 3 — Remaining creatures/troops then structures and spells
- Troops: Chaos Archer, Frostshell, Rift Runner, Sparkcaster, Chog Guardian, Hexwing, Rift Sprites, Gale Netter, Riftbreaker, Ember Mauler.
- Structures: Rift Sentry, Decoy Totem, Chog Burrow, Rift Mortar.
- Spells: Chaos Bolt, Rally Horn, Chaos Comet, Rift Snare.
- Complete a small group, test visually, then extend; conserve performance on packed boards.

### Stage 4 — Commander set and tower defenders
- Produce true Chog forms for Bulwark, Reaver, Deadeye, Scout, Warden; preserve originals' signature accessories and identities.
- Install actual Chog-design defenders on towers and appropriate attack/idle states. Do not change towers into independent domain units.
- Revisit in-game effects, damage state art and visual hierarchy.

### Stage 5 — Release-level validation
- Portrait/mobile, desktop, narrow/broad viewport, game speed modes and multiple team orientations when present.
- Regression tests: same tower HP, card costs, unit damage/range/speed, target selection, deploy regions, spawn order, bridge crossing, obstacle/hitboxes, team ownership. Visual update must not alter gameplay values.
- Art review: approved look, readability at actual sprite display size, coherent lighting, no copied third-party branding.
- Performance review: record FPS/memory on actual device(s) if available; don't claim 60fps or mid-range-mobile performance without measurements.
- Document remaining gaps, temporary assets and copyright/provenance.

## What constitutes completion
- **Design approved**: two approved renders and written bible (already done).
- **Asset produced**: actual standalone images/atlases/animation states with verified alpha, pivots, consistent viewpoints; not yet done by this pack.
- **Gameplay integrated**: runtime actually loads and displays those assets in all appropriate states with tests; not yet done by this pack.
- **Fully shipped**: all 25 cards and arena fulfill both asset and integration criteria on target devices; not yet done.

## Stop/go decision rules
- If there are no separated arena textures or character atlases, Codex must state exactly what is missing rather than fake completion.
- If it is impossible to keep pathing/towers correct with new background, keep existing scene and return a precise blocker, not a geometry rewrite.
- Do not change architecture/engine or make a broad refactor to chase visual polish.
- Preserve the working tree, tests, unrelated local changes; no push/deploy without user permission.
