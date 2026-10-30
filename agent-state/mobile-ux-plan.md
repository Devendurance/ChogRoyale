# Mobile UX / app-shell polish plan

## Frame

- Artifact: one scoped app-shell polish pass covering mobile hierarchy, Account XP presentation, PWA launch/audio recovery, and browser-safe fallbacks.
- Preserve: battle/result logic, server-authoritative progression, routes, audio mixer ownership, and production state.
- Success criteria:
  - High-value identity, currency, and account progression remain readable on 390px without crowding the shell.
  - Secondary actions move into an accessible compact surface without removing existing functionality.
  - Profile and Progress share one clear Account Level presentation with authoritative values and explicit unavailable states.
  - Installed app launch has a short branded opening, and audio recovery re-arms after browser context suspension without bypassing autoplay policy.
  - 390x844 and 1366x768 checks show no horizontal overflow, clipped controls, or unusable bottom navigation.
  - Typecheck, scoped lint, focused tests, production build, and real browser screenshots pass.

## Phases

1. Frame and architecture alternatives.
2. Select the smallest coherent shell design.
3. Implement shared shell, Account XP, PWA opening, and audio recovery slices.
4. Verify focused behavior and browser evidence.
5. Review diff, update state/rules, commit and push without merge/deploy.

## Current evidence

- App layout already owns one persistent AppAudioProvider and CatalogProvider.
- Manifest starts at `/app`, while the branded SeasonOpening only mounts on `/`.
- AccountLevelModule is reused but currently renders its own panel, causing nested card frames in Progress.
- AppHud always exposes four utility controls plus optional extras, which crowds narrow screens.
- Audio gesture recovery is installed only from the initial `needsUnlock` snapshot and does not re-arm after a later context suspension.
