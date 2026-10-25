# CHOG ROYALE — APPROVED CRYSTAL RIVER ARENA / IMPLEMENTATION SPEC (v3)

## Definitive reference
`../references/ARENA_CORRECTED_red_top_blue_bottom.png` (portrait composition mockup, 941x1672). Supersedes opposite-colored and wrong-facing drafts. **Player-relative render: ENEMY RED towers/team at the TOP; LOCAL PLAYER BLUE towers/team at the BOTTOM.** Blue = your own team from the local player POV, not an intrinsic fixed network team ID. This is a visual rendering rule, NOT permission to rewrite server/player identity, world positions, or tower ownership. Follow `00_TEAM_ORIENTATION_LOCK.md` for spectator, flip and multiplayer edge cases.

## Visual construction
- **Camera:** elevated near-orthographic 3/4 top-down view, stable throughout gameplay, no tilted vanishing-point distortion that breaks movement or targeting.
- **Terrain:** sunny yellow-green grass with subtle blades/flower patches, gentle stone footpaths, controlled low-contrast detail in high-traffic gameplay areas; no dark mottled carpet texture.
- **River:** electric turquoise river crossing horizontally through the middle with white foam accents, occasional low-cost ripples; banks made of sunlit limestone chunks and small planted flowers.
- **Two bridges:** symmetrically aligned to existing left/right walkable crossing geometry. Chunky timber deck with stone posts and cyan/blue gem trim. Preserve collision/pathing (do not alter actual bridge area to fit art).
- **Border:** crystal formations, evergreen clusters, carved stone, warm torchlets, a hint of cascading waterfalls near outer edge; leave central battle fields uncluttered.
- **Towers:** three per team as depicted (two lane towers and one rear/king tower); original footprint and attack/damage logic untouched. Swap in cohesive Chog-world architecture: stone base, broad gold trim, team-color banners/crest, real Chog-origin defender silhouette.
- **Mounts:** TOP/RED enemy defender design uses Bulwark visual vocabulary (red helmet crest, gold armor, shield), while BOTTOM/BLUE friendly defender design uses Chog Guardian visual vocabulary (recognizable teal spikes, blue armor/shield). All mounted figures must be actual recognizable Chog Royale character designs, not generic kings. These are art-direction assignments; confirm actual tower-occupant/game data before claiming canonical identity. Never swap combat units or change game rules to force a screenshot match.
- **Facing direction:** TOP/RED tower cannons and mounted defender aiming direction must point **DOWNWARD** toward the bottom side. BOTTOM/BLUE tower cannons and mounted defender aiming direction must point **UPWARD** toward the top side.
- **Shadows:** ambient occlusion baked into produced terrain/structures; separate dynamic elliptical contact shadows under moving troops and props, not deep photographic black.
- **Light:** warm sunny directional key from upper-left, soft cool daylight fill, vivid greens/white-stone highlights, selective crystalline cyan glow; no global dusk tint or heavy vignette.

## Identity guardrails
- This arena is part of **Chog Royale**, not a generic fantasy battler.
- Tower defenders must preserve clear Chog Royale identity, not drift into unrelated generic human kings.
- All future arena-adjacent character art should obey `docs/00B_CHOG_IDENTITY_LOCK.md`.

## The arena is composed of separate logical layers
Suggested render stack, adjusted to actual scene architecture:
1. Stable base grass/path terrain (no live towers or defenders baked in).
2. Water with animated UV/tiles/ripples as feasible.
3. Bridge floor and bank details compatible with existing collision routes.
4. Ground decoration under units (grass tufts, little stones, flower clusters; kept out of drag/tap zones).
5. Contact shadows and target rings.
6. Units, deployables, interactive towers sorted with correct world-Y/front overlap.
7. Foreground bridge rails / occluding stones / tower turrets if necessary.
8. Projectiles, impact and spell VFX (respect clarity and target hitboxes).
9. Healthbars, names, target UI, card/energy HUD unaffected by visual effects.
10. Foreground outer-edge flora/corners that never mask relevant targets or interactive UI.

**DO NOT** install the approved flattened reference as a single full-scene background and independently overlay towers/defenders: their painted duplicates would remain. Treat it as palette/composition reference until suitable clean background/foreground pieces are produced. A concept-preview dev toggle is permissible but must be clearly labelled 'non-playable mock'.

## Geometry invariants — hold these exactly
- River line, legal crossing surfaces, bridge widths/positions, all tower coordinates and combat hitboxes, deployment zone boundaries, troop routing/navmesh/pathfinding, camera projection, spawn locations, ability radii, targeting and selection remain tied to current data.
- Player-relative visual allegiance must show LOCAL PLAYER blue at bottom and ENEMY red at top, with health bars/banners/defenders derived from the true local-player/team state. Do not equate top or bottom with an absolute server team ID. Spectator/replay modes follow existing perspective rules or explicitly document an intentional camera setting.
- Ability placement must remain possible; keep river and bridge geometry clear to the camera used in game.
- Don't infer new pixel dimensions from 941x1672 art; derive viewport/scaling/layout from actual code and devices.

## Mobile and accessibility
- Test narrow portrait viewport and desktop video capture. UI labels, HP bars and targeting rings remain above detailed grass.
- Saturated blue/red should remain distinguishable independent of chroma through crest and shape cues.
- FX intensity should remain legible amid 8+ troops and overlapping spells; cap particles and respect reduced motion preference if implemented.

## Output layer families needed from an artist/pre-render pipeline
`arena/ground`, `arena/river`, `arena/bridge_left`, `arena/bridge_right`, `arena/river_banks`, `arena/edge_environment`, `arena/foreground_occluders`, `towers/blue_*`, `towers/red_*`, `towers/defender_*`, `fx/water_ripples`, `fx/torch`, `fx/crystal_glow`. Choose exact names after reading the repository's asset system. Export clean transparency, consistent world anchors, and multiple required states.
