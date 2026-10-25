# Chog Royale — Devin/Opus Visual Asset Reference Pack v1

This is the **individual-reference extraction pack** requested by the owner after the 4 Chog Royale art boards.
It contains individually named concept/reference PNGs: **25 canonical original Chog designs, 25 individual 3D style concepts, 25 identity comparison boards**, plus environment pieces, towers, defender concepts, style/material references, VFX, animation-pose examples, approved art bible and Codex/Devin instructions.

**Important:** This is NOT yet a game-ready 2.5D sprite/atlas deliverable. Individual PNG files are *crops from composite illustration boards*. They include painted backgrounds, lighting, or framing; most do NOT have real transparency and none are verified animation atlases. Do not integrate them as final sprites or use the complete arena as a live background with its baked-in towers. New clean, separated, transparent production assets and consistent sprite animations still need to be authored.

## How to use
1. Put this entire folder in the Chog Royale repo under a handoff/non-public path.
2. Open `DEVIN_OPUS_START_HERE.md` and give it to Devin/Opus from repo root.
3. Use `manifest.json` to locate every piece and understand `game_ready` and extraction origin. Every cut-out is marked `game_ready: false` (correctly).
4. Reuse `07_APPROVED_V3_ART_BIBLE/` to preserve the approved palette and the most important hard locks.

## Visual rules
- Enemy **RED TOP** / Local player **BLUE BOTTOM** relative to each client's POV.
- Top RED cannon defenders point **DOWN**; bottom BLUE cannons/defenders point **UP**. The concept art may show wrong aim directions: textual rules override that image.
- Keep original Chog face structure, compact anatomy, colored head-quills, iconic costume, commander NFT features and props. Premium style must not make characters generic.
- Bright sunlit turquoise river / grassy stone-and-crystal arena, consistent warm upper-left sunlight, cool sky fill, clean bloom and rich toy-like materials.
- Stay in Phaser 2.5D; preserve battle rules, coordinates, hitboxes, rendering orientation, collisions, multiplayer state and verified Slice 1 work.

## Highest-priority production assets still missing
- Separated production quality arena base/ground and decor on actual **600x920 world canvas**, no baked-in towers; bridge/river alignment must be measured against live code.
- Red and blue tower parts, independent front/back rims and mounts, defender sprites and correct upward/downward aim, transparent 256x320 sources with sockets + anchor coordinates.
- Choglings + Boulderback alpha animation atlases (idle, move, attack, hit, defeat); card images derived from approved identity-faithful renders. Card cropping previews required at **72x96** and **46x61**.
- Full roster individual game-view assets after visual approval; 25 art cards plus spawned `burrow_scrapper` unit if code uses it.
- Animated spell VFX, shadow rings, hit and muzzle effects as applicable to live mechanics.

## What is actually included
- individually named reference extracts for the above (including concept defender poses), not final runtime textures.
- machine-readable `manifest.json` and `card_manifest.json`.
- original combined boards and v3 official art bible.
- optional earlier Chog Royale logo art.

**No repo changes, deployment, push, or PR are performed by this pack.**

## UI-size previews
`02_CARDS/04_PROVISIONAL_UI_PREVIEWS_NOT_APPROVED` contains 50 cropped/scaled samples for testing card-layout sizing at 72x96 and 46x61. They are deliberately labeled provisional because their source 3D study images are not final, identity-approved art, and they lack true transparent originals. Do not ship as permanent card assets.
