# CHOG ROYALE — FINAL APPROVED TEAM ORIENTATION LOCK (v3)

## ABSOLUTE REQUIREMENT FOR LOCAL PLAYER POV
- **TOP HALF = OPPONENT / ENEMY = RED.** Top king/rear tower, left and right lane towers, crest gems, flags/banners, team decorations, tower HP/affiliation UI, defender visual identity are RED.
- **BOTTOM HALF = LOCAL PLAYER / FRIENDLY = BLUE.** Bottom king/rear tower, left and right lane towers, crest gems, flags/banners, team decorations, tower HP/affiliation UI, defender visual identity are BLUE.
- Tower defender design: **TOP RED = recognizable Bulwark-styled Chog Royale commander**; **BOTTOM BLUE = recognizable Chog Guardian-styled Chog Royale defender**. Verify how actual game maps occupants and do not replace canonical tower gameplay entities/logic.
- **Facing direction:** TOP/RED tower cannons, mounted defenders and any fixed weapon orientation must point **DOWNWARD** toward the player side. BOTTOM/BLUE tower cannons, mounted defenders and any fixed weapon orientation must point **UPWARD** toward the enemy side.
- The center turquoise river and two bridges are NEUTRAL. Environmental blue crystals and water stay cyan/blue regardless of territory. Do not recolor all blue pixels red in the opponent half.
- Preserve approved arena composition, vivid daylight, grassy field, river, crystal border, landscape and overall camera. Earlier blue-top/red-bottom and wrong-facing tower variants are INCORRECT and must not be used.

## Multiplayer is PLAYER-RELATIVE, never SERVER-ID-RELATIVE
- Your own team is rendered BLUE at the bottom of your own camera. Opponent is rendered RED at the top of your own camera, regardless of the network team's immutable ID/seat.
- If gameplay already has local/spectator orientation and transforms, compose the new textures with the existing mapping rather than inverting/rewriting combat coordinates, ownership, spawn regions, tower locations, bridge pathing or netcode.
- Do not hardcode e.g. `teamA === blue` or `north === enemy` if that is false in the existing rules. Derive display team from the local-player perspective without changing domain team values.
- If replay/spectator camera orientation is unspecified, retain existing behavior and document it rather than guessing.

## Implementation checks
1. Two local player identities / both network seats: each player sees their own BLUE towers at bottom, RED enemy at top, while attack targeting, server ownership and win/loss remain correct.
2. 3 top towers RED with red flags/crests and Bulwark Chog-art defenders; 3 bottom towers BLUE with blue flags/crests and Chog Guardian-art defenders.
3. Top red tower cannons visibly aim downward; bottom blue tower cannons visibly aim upward.
4. Water stays turquoise; other neutral crystal props retain their original visual colors.
5. No double-painted towers under gameplay towers, no mirrored UI/touch or invalid bridge crossings.

## Source priority
1. This lock (v3) and actual gameplay invariants.
2. `references/ARENA_CORRECTED_red_top_blue_bottom.png` for ART DIRECTION only, a manually composited player-relative preview based on the approved concept. It is not standalone production terrain, tower layers or an animation atlas.
3. `docs/00B_CHOG_IDENTITY_LOCK.md`, `docs/02_ARENA_SPEC.md`, `docs/01_ART_BIBLE.md`, approved character concept poster and original card identity references.

If a document or old prompt disagrees with this file, **this file wins**.
