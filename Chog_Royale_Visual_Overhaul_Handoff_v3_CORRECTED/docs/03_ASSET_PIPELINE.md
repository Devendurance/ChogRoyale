# CHOG ROYALE — 2.5D ASSET & ANIMATION PIPELINE

## Core engineering decision
Use Phaser's existing sprite/texture/animation facilities and pre-rendered 3D-look transparent assets. Do **not** migrate to Unity, Godot, Three.js, React Three Fiber, or real-time 3D as part of this task. Reuse the existing scene/renderer/camera/asset registry until a repo-specific conflict is documented.

## Two art representations per card
1. **Hero/card art**: expressive, high-resolution, visually close to approved 3D render. Use for deck/build UI/marketing. Portrait crop safe for the 72x96 and 46x61 sample screenshot; recheck actual UI dimensions.
2. **Battle sprite**: purpose-rendered 3/4 view, consistent head/body proportions in world space, stable pivot at feet/base, transparent canvas with safe bleed and no color fringe. An action-pose poster cannot substitute for this.

## Animation coverage depends on *real code*
Start by enumerating each existing character's actual display states. Suggested naming for mobile 2.5D troops (only create necessary states): `idle`, `move`, `attack`, `hit`, `defeat`, `deploy`; include `cast`, `fly`, `shield`, or `special` only if gameplay needs them. Determine directions from actual facing logic (a minimal 4-direction set if truly needed, 8 only if camera requires it; do not mirror asymmetrical bodies and weapons blindly).

Buildings: `idle`, `activate`, `fire`, `hit`, `destroy` as applicable. Spells: `cast`, `travel`, `impact`, `area_loop` as applicable. Hero/commanders: same runtime contract as troops plus their actual ability states. Do not invent abilities or status effects.

## Preferred delivery shape
- Atlas PNG/WebP + JSON frame manifest compatible with the installed Phaser version; each frame registered to a common pivot; document frame rate per state and fallback frame on missing animation.
- Normal source art at higher resolution than render display; downsample with proper filtering into actual game scale. Determine atlas dimensions by the runtime limits (mobile devices can have lower texture limits); prefer sensible texture paging rather than one huge 25-unit atlas.
- Preserve consistent base lighting across all characters. Team affiliation by unobtrusive team rings/shields/flags; do not apply blanket shader tint that erases brand colors.
- Stable naming: `cardId/view/action/frame` in the asset pipeline; map to existing asset keys in an adapter instead of renaming game domain IDs.
- For every source asset: transparent background, no drop shadow baked beyond silhouette (use dynamic contact shadow), no ground slice, pose consistent with idle/walk action, license/provenance noted.
- Use production layer transparency for rivers, rails, towers and VFX. Include occlusion masks or z-order notes when art overlaps walkable geometry.

## Suggested prototype requirements (not fixed implementation quotas)
- **First exemplar troop:** Choglings — idle/move/attack or precisely whichever states are used in current code.
- **Second exemplar:** Boulderback — squat/heavy silhouette to stress-test unit scaling and shadow handling.
- **First commander/card-art validation:** Bulwark or Warden; do not make 5 posters into sprites.
- **Test card UI**: sample render at both screenshot sizes plus actual game viewport resolution.
- **Test in-world**: entity foot position aligns with existing transform and HP bar; frame orientation matches target/projectile direction; no sprite jitter from inconsistent pivots.

## Initial render pipeline options
Use a genuine 3D modeling/rigging/rendering tool or a frame-consistent character generation pipeline. Single-view generative still images rarely maintain costume detail, limbs or face identity across independent walk/attack frames. When they fail continuity tests, do not ship them. A skilled artist may create 2D frame-by-frame animation that looks 3D; actual underlying mesh is not required for Option A.

## Required asset validation
- PNG/WebP dims and alpha checked programmatically; sprites are physically transparent, not checkerboard or solid backgrounds.
- Atlas frame names validated against JSON manifest; all cited files exist and load without errors.
- Frame bounding box and pivot alignment comparable across loop frames; no wobble or cropping on attack frames.
- Compression and GPU memory appropriate for mid-range mobile; no overlarge single textures, no giant particle overdraw, no per-frame Graphics-generated dynamic textures for decorative effects.
- No duplicate towers/bridge/river baked into overlapping layers.
- Keep fallback to existing assets for every card until verified production replacement exists.

## Phaser documentation
Relevant current guides: https://docs.phaser.io/phaser/concepts/textures and https://docs.phaser.io/phaser/concepts/animations . Depth ordering: https://docs.phaser.io/phaser/concepts/gameobjects . Some shader FX are WebGL-only; avoid assuming Canvas mode supports them.
