# Final audio overhaul acceptance

Branch: `codex/final-audio-overhaul`, based on main `6907259`. The owner authorized pushing and opening a PR, with no merge or production promotion.

## Delivered behavior

- One persistent `/app` audio controller mixes music, interface cues and the existing authoritative battle effects through independent gains and a master limiter.
- Lobby music continues across app navigation and private ready rooms. Actual match state selects the configured battle track. Important cues and results reduce the music gain without reducing crown or result effects.
- Music transitions are cancellable. Hidden pages stop sources and preserve offsets. Saved mute and zero-volume preferences survive navigation and refresh, including migration from the original battle-only settings.
- Settings expose master, background music, interface effects and battle effects with independent volume and mute controls. Blocked playback has an explicit Enable Sound action.
- The 16 original interface cues are produced locally. There are no browser generator calls, exposed credentials or runtime ElevenLabs dependency.
- Upgrade and sponsorship celebration cues require confirmed server outcomes. Disabled controls, ordinary typing, hover and scroll remain silent. Generic and semantic handlers avoid duplicate cues.

## Rights and assets

Track A, `Misterbates - Spooky Halloween`, is the supplied CC0 lobby soundtrack. The prepared cyclic loop is 49.55 seconds, measured at -16.1 LUFS and -2.4 dBFS true peak.

Track B, `Mrthenoronha - Village game theme loop`, is the supplied CC BY-NC 4.0 battle soundtrack. The development loop is 33.409093 seconds, measured at -16.6 LUFS and -4.7 dBFS true peak. It remains outside production assets and requires appropriate separate permission before commercial production use.

The configured ElevenLabs subscription reported Free tier. No ElevenLabs sound was generated. All 16 interface files are original procedural renders, with the existing procedural battle sound engine preserved.

See [credits](credits.md), [asset manifest](audio-manifest.json), [measurements](quality-report.md), and [UI mappings](ui-mappings.md).

## Verification environment

Browser checks use desktop Chrome and Chromium touch emulation at 390×844 and 1366×768. Privy identities and account reads are injected or mocked for these checks. Multiplayer evidence uses the actual local Colyseus battle engine with test authentication dependencies. This is not production account, settlement, NFT entitlement or physical-device acceptance.

No physical Safari/iOS, Chrome/Android or installed-PWA device was available. Perceptual listening on the owner's speakers or headphones remains a final subjective review. Objective loop, level and clipping measurements are recorded separately.

Raw QA scripts, reports, source masters and the SFX audition reel live outside the repository in `C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027`. Temporary authentication aliases and QA source files are removed before the release build.

## Browser and multiplayer evidence

| Check | Result | Evidence boundary |
| --- | --- | --- |
| App navigation, visibility, app exit/re-entry, volume persistence and legacy silence after reload | 6 checks passed across both viewport sizes | Real app routes and Web Audio, injected login and mocked account reads |
| Mouse, keyboard, touch, disabled controls, Next Link, zero master volume, confirmed and refused upgrades | 15 checks passed | Real controls and Web Audio. Upgrade responses are mocked to verify client ordering, not economic rules |
| Lobby A to battle B, result ducking without restart, hide/show, mute/unmute and return to A | 7 phase assertions passed, one context | Real provider and Web Audio driven by a temporary phase fixture, separate from multiplayer evidence |
| Runtime audio requests | 17 production assets and the additional development Track B endpoint returned 200 | No missing audio response in the focused phase run |
| Real local match and reconnect | Shuffled seats `[1, 0]`, both players ready, same-room refresh recovery, 2–1 victory/defeat after overtime at 3:07 | Real engine with injected authentication. This run did not establish unlocked audio playback |

The multiplayer harness clicked the exit control, then incorrectly waited for a URL change. The app returns to its idle stage in place. That final assertion timed out, so this run does not claim a fully verified multiplayer return step. The separate provider fixture verified the music return to lobby. Its temporary route emitted one hydration warning and was removed after the test.

The observed music bus gain dropped from `0.1144` during the active phase to `0.0416` at results. Track B remained the same source through the result transition, then resumed correctly after visibility and mute pauses. This is instrumented playback evidence, not perceptual approval on a physical phone.

External reports are `qa-coordinator/app-report.json`, `qa-ui/ui-report.json`, `qa/runs/audio-phase-qa-20261028/report.json`, and `qa/runs/audio-live-acceptance-20261028/acceptance-summary.json`. Both players' result captures at both sizes are retained in the last directory.

Settings screenshots: [390×844](review/settings-390x844.png), [1366×768](review/settings-1366x768.png). These show the injected account and mocked reads used by the browser checks.

## Final release checks

- Relevant unit/regression suites: 110 tests passed across 11 files, including audio lifecycle, mixing, production silence, identity, result and interaction coverage.
- Standalone `npm run typecheck` and scoped ESLint for all audio changes passed.
- Clean production build passed with normal Privy imports and no QA route.
- Production smoke: all 17 public audio assets returned 200, `/api/dev-audio/battle` returned 404, and none of 93 server traces contained `.audio-dev` or `battle-loop.mp3`.
- Production route/chunk checks found no temporary audio QA route or injected `qa-alice`, `qa-bob` or Privy alias strings.
- Full repository lint retains 24 existing errors and one warning in unchanged files. The audio work does not expand that baseline.

Production smoke evidence is in `qa-coordinator/production-report.json`. No merge, production promotion, schema change or production account mutation was performed.
