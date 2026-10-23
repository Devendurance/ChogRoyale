# Left Off

Last updated: 2026-10-23

## P4b character animation and battlefield motion, complete (local commit)

- Added authoritative animation cue projection and tests. Existing v001 static art now gets responsive spawn pop, movement interpolation with correction snap, directional facing, attack windup/release, HP hit emphasis, bounded death collapse/fade, event dedupe, reconnect priming and pooled cleanup on match reset.
- Preserved arena/HUD/audio/VFX/input/gameplay. No new animation assets or dependencies. Runtime manifest inspection found no animation frames or sheets.
- Verification: focused animation/render suites 54/54, typecheck green, full lint green, production build green. Localhost smoke reached the unauthenticated `/dev/battle` gate only. No live authenticated gameplay claim.
- Local checkpoint is committed with the scoped BattleCanvas, battle-animation helper/tests and state-log updates. Do not start P5.

## P4a essential battle audio, complete (local commit, no push)

- Added `battle-audio.ts` procedural cue engine and pure event projection tests. Cues use authoritative deploy/spawn, spell, tower/siege fire, impact, structure HP, death/destruction, commander ability, Chaos pulse, ack and result signals.
- Added compact battle HUD Sound toggle and volume control with browser-gesture unlock, local mute/volume persistence, reconnect-safe priming, dedupe, throttling and cleanup. Battle input, Phaser lifecycle and combat state are unchanged.
- Verification: focused tests 20/20, typecheck green, focused lint green, full lint green with one pre-existing `/dev/progress` warning, production build green after existing static-page retries. Localhost smoke reached the unauthenticated dev-battle gate only, so no live authenticated audio claim.
- Local checkpoint is committed. Preserve `.fast-build/STATE.md`, `DESIGN.md`, and `docs/Chog Royale messaging.md`. Stop after P4a.

## P3b player, patron and NFT progression integrity, complete (local commit, no push)

- Verified by inspection plus existing tests: deployment-independent stats, W/L/D correctness, private/casual/ranked separation, deployment-gated commander appearances, v2-only patron appearances, Paragon 9-vs-10 with idempotent reprocessing, invalid-evidence refusal, ownership checks. Fixed one proven gap: ranked bucket missing from stats byType (ranked rows settled but invisible in the breakdown).
- Scoped change: `getPlayerStats` ranked breakdown, dev progress Ranked row, new ranked-bucket test. Verification: progression 10/10, stats route 3/3, progress-model 29/29, typecheck, lint (1 pre-existing warning), build green. Live pool read-only: 1969 resolved, 0 invalid.
- Local commit: pending (scoped: progression.ts, progression.test.ts, dev progress page, agent-state). `.fast-build/STATE.md`, `DESIGN.md`, `docs/Chog Royale messaging.md` untouched. No PROD activation, no migrations 0010-0014, no push, no deploy.
- Next: owner review, including the still-gated live NFT-holder acceptance match. Do not start P4.
