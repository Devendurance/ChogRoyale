# Battle Experience V2 Handoff (Codex, 2026-10-25)

WIP checkpoint. Handoff only. No combat, settlement, economy or migration changes.

- Base commit: `4812c04648e977bee8dd48fe43e89dcbe1b033ea` (main, P7.1 XP seat fix)
- Branch: `handoff/battle-experience-v2-20261025`
- Checkpoint SHA: `4dc44daecc2b6580abb879c0e21da38f99341d58`
- Remote: `https://github.com/Devendurance/ChogRoyale/tree/handoff/battle-experience-v2-20261025`
- Status: 19 files, 958 insertions, 455 deletions. No push to main. No deploy. No broad tests run.

## Changed files (branch vs base)

Modified:

- `src/app/dev/battle/BattleHud.tsx` (scoreboard uses GameIcon crowns, CrownCelebration mount, BattleResult replaces inline result panel, board ref for flight origin)
- `src/app/dev/battle/BattlePanel.tsx` (lobby delegates to BattleLobby, passes player name to HUD)
- `src/app/dev/battle/LoadoutPicker.tsx` (borrowed/lent states, schema-validated draft, extracted stylesheet, GameIcon headers)
- `src/app/dev/battle/battle-audio.ts` (new `crown-earned` procedural chime, 0.45s gap)
- `src/app/dev/battle/battle-audio.test.ts` (crown chime play/mute test)
- `src/app/dev/battle/battle-hud.css` (fixed shell width/box-sizing, 25px crown art, removed inline result styles, start-ribbon intro, reduced-motion trims)
- `src/components/app/ProgressView.tsx` (CrownGlyph and trophy tile use GameIcon)
- `src/components/app/app.css` (battle shell bound tightened so fixed HUD owns the viewport)

Added:

- `src/app/dev/battle/BattleLobby.tsx` + `battle-lobby.test.ts` (production ready room: room code, VS readiness, confirms via LoadoutPicker)
- `src/app/dev/battle/BattleResult.tsx` + `battle-result.css` (modal victory/defeat/draw/abort finale with crowns, reason, duration, settlement, ranked award)
- `src/app/dev/battle/CrownCelebration.tsx` + `crown-celebration.css` (authoritative crown-flight from destroyed structure to score chip, bounded, pointer-transparent, reduced-motion safe)
- `src/app/dev/battle/crown-presentation.ts` + `crown-presentation.test.ts` (pure cue projection: score delta plus matching enemy structure loss, primed/suppressed on init and resume)
- `src/app/dev/battle/loadout-picker.css` (extracted picker styles)
- `src/components/game/GameIcon.tsx` + `game-icon.css` (original crown, trophy, victory, defeat, ready, deck SVG set)

## Completed

- Desktop responsive shell fix (full-width fixed HUD, box-sizing, shell bound).
- Scoreboard crown art swap to shared GameIcon set, used in HUD and progress.
- Pre-match lobby extraction with readiness states and room code.
- Victory/defeat/draw/abort finale modal with focus trap, settlement and ranked award lines.
- Crown flight VFX keyed only to confirmed score deltas with matching enemy structure transitions.
- Crown chime wired through the existing Web Audio unlock path with mute respect.
- Focused lobby and crown-presentation tests plus the audio chime test.

## Partially implemented

- LoadoutPicker lending labels (OWNED/BORROWED/LENT) and read states; server re-check at ready and match start remains the authority and is unchanged here.
- Start-ribbon match intro (CSS only); timing against real match start is unverified.
- qa-v2 fixture shell exists in the working tree at `src/app/dev/battle/qa-v2/page.tsx` but is NOT committed on this branch (temporary harness, same policy as the earlier deleted qa-progress route). A copy is preserved in the handoff ZIP.

## Missing

- Live two-player acceptance (queue, private room, reconnect, real phone touch).
- Physical iOS/Android pass and subjective audio/visual approval.
- Ranked queue stays closed (`RANKED_PUBLIC_MATCHMAKING_ENABLED=false` untouched).
- No settlement, legacy, migration, or economy changes in this checkpoint.

## Screenshots and fixtures (external, not in Git)

- Source dir: `C:/Users/USER/Documents/ChogRoyale-Assets/battle-experience-v2-20261025`
- Views captured: prematch, ready, active, crown, victory, defeat at 360x800, 390x844, 1366x768, 1600x900, 1920x1080.
- Evidence JSON: `layout-evidence.json`, `input-evidence.json`, `prematch-flow-evidence.json`, `motion-audio/motion-audio-evidence.json`, `local-engine-transitions.json` (+ single-lane and draw variants).
- Logs: `capture.log`, `before.log`, `input.log`, `prematch-flow.log`, `draw-evidence.log`, `final-sequence-motion-audio.log`, `resume-motion-audio-run.log`, `motion-audio-run.log`, `icon-motion-run.log`.
- Harness scripts: `generate-authoritative-fixtures.ts`, `setup-fixture.cjs`, `capture.cjs`, `before.cjs`, `input-check.cjs`, `prematch-flow.cjs`, `draw-evidence.cjs`, `icon-motion-evidence.cjs`, `motion-audio/motion-audio-evidence.cjs`.
- Reference images (`reference-C-decks.png`, `reference-D-start.png`, `reference-D-finale.png`, `reference-gameplay.png`, `reference-gameplay-end.png`) are study-only competitor captures. They stay outside Git and outside the ZIP.
- Motion `.webm` files stay outside the ZIP as large raw video references. Paths are listed in the ZIP manifest.

## Known issues

- Top Core muzzle flash can clip at the canvas top in seat 0 (pre-existing, unchanged).
- Fire/hit/idle art is non-directional (pre-existing, unchanged).
- qa-v2 harness intercepts `/qa-fixture.json` and account reads with local-engine snapshots. It proves layout only, never authentication, settlement, or server acceptance.
- `.fast-build/STATE.md` working-tree edits were left uncommitted on purpose (unrelated dirty file, preserved in place).
- `DESIGN.md` and `docs/Chog Royale messaging.md` remain untracked and untouched.

## How to run the presentation fixtures

1. From a clean checkout of this branch, restore the harness copy from the ZIP (`qa-v2/page.tsx`) to `src/app/dev/battle/qa-v2/page.tsx` (temporary, do not commit).
2. Generate engine snapshots: `npx tsx` on the archived `generate-authoritative-fixtures.ts` (writes `local-engine-transitions.json`; variants via `--single-lane` and `--no-actions`).
3. Serve the app on port 3000 (`npm run dev` or `next start -p 3000` on a production build).
4. Serve the JSON at `/qa-fixture.json` and stub `/api/players/me/loadout` plus `/api/players/me/commanders` with the saved-deck shape from `capture.cjs`.
5. Open `/dev/battle/qa-v2?view=` with one of `prematch`, `ready`, `active`, `crown`, `victory`, `defeat` (seat via `&seat=1` for the defeat side).
6. Drive with the `window.__qa` probe: `advance`, `repeat`, `repeatCurrent`, `finish`, `core`, `resume`, `readyCallbackFixture`, `longStatus`.
7. Delete `src/app/dev/battle/qa-v2/` before any release commit.

## Handoff ZIP

- File: `battle-experience-v2-20261025-handoff.zip` (sibling of this report in the assets folder).
- Contains: harness copy, evidence JSON, logs, harness scripts, presentation PNGs (competitor reference PNGs excluded), motion-audio PNGs and evidence JSON (webm excluded), `initial-fast-build.diff`, `MANIFEST.txt`.
- Verify: `git diff --check` clean at checkpoint; secret scan of the staged diff found no tokens or private keys.

## Devin completion pass (2026-10-25)

Verdict on the Codex claims, checked against code and fixture evidence:

- Desktop shell: PARTIAL, now fixed. The board's decorative frame overhung the viewport bottom at 1366x768 and 1920x1080 and slid under the scoreboard. `--chud-board-w` now sizes the canvas so the whole frame fits. The right column groups the ability with the hand.
- Crown flight: PARTIAL, now fixed. Projection logic was correct (seat mapping, Core multi-crown, priming, dedupe). The WAAPI whole-iteration easing compressed the hover and arc so the crown faded out near the counter. It now uses per-keyframe easing, lands solid, pulses the chip and pops +1. The chime sounds on landing (measured 14 ms after arrival, the scheduler lookahead).
- Finale: PARTIAL, now fixed. Victory and Defeat shared one look and the exit button lost its game font. Results now differ by scrim, emblem motion, title and winner badge. Crowns tally from `end.crowns` with soft ticks. Settlement shows a distinct chip per server state.
- Start ribbon: PARTIAL, replaced by a 1.9s pointer-transparent VS reveal with commander art, Battle stamp and Arena Patron line.
- Lobby lending labels: PARTIAL, now OWNED, BORROWED, LENT, PENDING and UNVERIFIED with loan expiry, never loan ids. Debug ruleset copy removed. Entitlement checks unchanged.
- Far Core HP label and muzzle flash: clamped inside the canvas (presentation only).
- Directional fire, hit and idle sprites: NOT ADDRESSED. Needs new art, outside this UI scope.
- Live two-player, physical iPhone and subjective audio: INCONCLUSIVE.

Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/battle-experience-v2-devin-20261025`.
