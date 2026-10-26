# CODEX — PROMPT 02 (USE ONLY AFTER GENUINE PRODUCTION ASSETS EXIST) — v3

Use this only after the repo contains real separated arena layers and real battle-ready unit/building/spell assets or atlases that obey the v3 locks.

Before doing anything, re-read:
- `docs/00_TEAM_ORIENTATION_LOCK.md`
- `docs/00B_CHOG_IDENTITY_LOCK.md`
- `docs/01_ART_BIBLE.md`
- `docs/02_ARENA_SPEC.md`
- `docs/03_ASSET_PIPELINE.md`

Then implement the next bounded slice of the Chog Royale visual overhaul using the real assets now present.

Non-negotiables:
- Preserve current Phaser gameplay and combat logic.
- Enemy red = top, player blue = bottom.
- Top red tower cannons/defenders face down; bottom blue tower cannons/defenders face up.
- Preserve Chog identity and commander/NFT recognizability.
- Do not swap in any asset that is prettier but less recognizably the same unit.
- Keep a rollback path / safe fallback.
- Verify changed asset anchors, pivots, draw order, animation state wiring and performance.

If any provided asset violates the v3 identity lock or arena orientation lock, stop and report the conflict before continuing.
