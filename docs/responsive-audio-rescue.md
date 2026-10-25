# Responsive UI and audio rescue

2026-10-25. Scoped production presentation changes, using the existing renderer, art, pointer handlers, room callbacks and audio cue contracts.

## Root causes and fixes

- Plain app CSS referenced font aliases that Tailwind's inline theme did not emit. Invalid `font` shorthands lost both family and size. Scoped `.app-root` aliases restore the existing Satoshi, Georama and Lilita One fonts. Computed Private heading changed from Arial 16px to Lilita One 28px.
- Desktop's 260-300px hand rail divided four cards into roughly 50px strips. The hand now has a bounded 420px rail with four 82.5x110px cards at the requested desktop sizes. Equal support tracks center the arena without reducing its height for the hand.
- Low-energy portraits combined heavy grayscale with a dark blanket. Lighter treatment preserves recognizable art. Names wrap only between words, with intact-word ellipsis when necessary. Next remains secondary, costs remain prominent, and ability/audio targets are at least 44px tall.
- Selection guidance added an in-flow row and resized the canvas between selection and deselection. The guidance now overlays the tray. The 100x160 board, Phaser lifecycle and canvas-rectangle pointer mapper are unchanged.
- Entry grid tracks distributed viewport-height whitespace, and a generic child rule stretched the action row. Private now has Create Private Room plus a compact labelled code form. Unranked has Find Opponent. The game plate is bounded to 640px and primary buttons use content width.
- PlayHub spacing is tighter. Onboarding's 520px cap no longer loses to desktop column rules, and its existing username form has bounded controls and field spacing. Decks and Commanders retain their existing grids, with restored shared typography.

## References and rights

- Inspected `Downloads/ChogRoyale_Devin_Visual_Handoff_FULL.zip`, extracted README, brand/components, rights and review documents, plus actual sampled sequences from C and D. Those videos informed composition and hierarchy. No reference art ships.
- Located `Downloads/1000314579.mp4`: AAC mono, 44.1kHz, 134.874s. Reference level measurement: mean -24dB, peak -5.1dB. C and D also contain AAC, with durations 56.125s and 339.148s. Level measurements and extracted visual sheets are evidence of inspection, not a subjective listening approval.
- The exact mobile/desktop visual target PNG filenames and current task recording were not found locally. Their comparison and the supplied silent-recording diagnosis cannot be claimed. No competitor sound was extracted into the game.

## Audio

- Readiness now requires an actually running context, unmuted preference, positive volume and visible page. The control says Enable Sound until ready. Entry actions unlock synchronously before network waits. Mute is applied before unlock, and enabling restores a zero-volume preference to the restrained default.
- Added a silent gesture buffer, interrupted-context resume, state subscriptions, disposal protection, no stale queued cues, original filtered percussion, a compressor, cached deterministic noise and a 15ms scheduling lookahead. The maximum is 16 voices. Start/result cues can clear crowd voices.
- Existing authoritative deploy/spawn, tower/siege fire, impacts, structure HP/destruction, spells, abilities, Chaos and result cues remain bound to legitimate events. Ordinary melee has no public attacker/release event, so impacts use observed authoritative HP loss without inventing attack timing.
- Actual Chromium gesture capture reaches running/Sound On. Decoded card selection peak 0.166, mute approximately 2e-34, unmute 0.151, recorded authoritative frame HP-loss impact 0.186. Half-volume live RMS is 0.596 of full volume. No browser errors.
- Actual-engine OfflineAudioContext output verifies 19/19 nonzero cue types, 19/19 silent at zero volume, exactly 0.5 half-volume RMS and maximum peak 0.1353. This is objective output evidence. Physical speaker levels and subjective sound approval remain separate.

## Browser evidence

Evidence root: `C:/Users/USER/Documents/ChogRoyale-Assets/responsive-audio-rescue-20261025/`.

| Viewport | Active HUD | Private entry | Unranked entry |
| --- | --- | --- | --- |
| 360x800 | battle-360x800.png | private-360x800.png | unranked-360x800.png |
| 390x844 | battle-390x844.png | private-390x844.png | unranked-390x844.png |
| 844x390 | battle-844x390.png | private-844x390.png | unranked-844x390.png |
| 1366x768 | battle-1366x768.png | private-1366x768.png | unranked-1366x768.png |
| 1920x1080 | battle-1920x1080.png | private-1920x1080.png | unranked-1920x1080.png |

- Additional `play-`, `lobby-`, `decks-`, `commanders-` and `onboarding-` screenshots exist at all five sizes. All 40 final captures have no horizontal overflow, no undecoded images and no page errors. `layout-evidence.json` contains measured bounds.
- Canvas ratio remains 0.625. Mobile cards measure 68.5x91.3px at 360 and 76x101.3px at 390. Energy and the 44px ability remain inside the viewport. Desktop canvas center matches viewport center.
- `input-evidence.json`: 22/22 checks pass for taps, mouse drags, emulated touch drags, both perspectives, all five viewport sizes and retained canvas identity through resize.
- `live-routes.json`: all requested real routes returned 200 with honest signed-out/loading states and no overflow. Ranked rendered its closed gate. No auth bypass or account writes were used.
- Screenshots show an explicitly labelled presentation fixture using real BattleHud/Phaser and recorded server frames. The fixture source is archived outside the repository and removed from release code. These are not authenticated multiplayer acceptance screenshots.
- `audio-live/trusted-gesture-hud-audio.wav` and `.webm` contain actual browser output. Per-action recordings and `live-audio-evidence.json` sit beside them. The 19-cue audition and offline metrics are in the sibling `audio-rescue-20261025/` folder.

## Verification and limits

- Focused UI/audio/onboarding suites: 31 passed across four suites. An additional unchanged `battle-input.test.ts` suite could not import the installed viem/noble-curves dependency. Browser pointer verification passes independently. No dependency or engine changes were made to mask that local install issue.
- Final scoped lint and full typecheck pass. The single production build passes, compiling in 74s and generating all 62 pages. No fixture route is included. Exact logs are in the external evidence folder.
- Physical iOS Safari gesture/playback, browser toolbar changes on real devices, authenticated two-player acceptance, subjective audio approval and exact owner-target comparison remain unverified. Fixtures cannot establish server acceptance or live audio event delivery.
- No combat, balance, NFT, economy, settlement, database, Colyseus deployment, infrastructure, payment or authentication policy changes. Ranked remains closed. Existing unrelated dirty files remain outside the release commit.
