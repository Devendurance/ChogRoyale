# Lobby resources and Account XP polish

Review PR: https://github.com/Devendurance/ChogRoyale/pull/20. Implementation commit: `3bfbd16`.

- Branch: `codex/lobby-resources-xp-polish`, based on merged main `a67c7ac`. PR #19 was already merged by the owner, so this follow-up has its own review branch. No merge or production deployment performed for this slice.
- Lobby summary reads existing authenticated Gold, stats and Account XP endpoints. Balance and earned crowns require nonnegative integers. Level and XP reuse the existing Account XP validator. Failed reads never become zero or Level 1.
- Returning to `/app` refreshes the resource reads, including returns from battle. Late reads are generation-guarded and scoped to the authenticated identity. HTTP failure status survives non-JSON error responses.
- The Gold plus action opens a keyboard-accessible disclosure with an Earn Gold link to Battle Hall. It explicitly says purchases are unavailable. There is no shop or payment placeholder pretending to transact.
- The level summary links to `/app/progress`. The shared expanded module on Profile and Progress shows a crest, level-specific XP, lifetime XP, the next lifetime threshold and a real progress bar. MAX omits a fabricated next threshold.
- Scoped lobby sizing puts commander and deck/battle side by side on desktop, keeps the Battle action above mobile navigation, and avoids breaking card names across individual letters on desktop.
- Fixed the existing Turbopack Tailwind rule applying to CSS Modules. It produced `undefined` class names in the browser. CSS Modules now bypass that loader and export real class names. Only the two app progression/summary modules use this format in the current repository.

## Evidence

These are presentation fixtures using sample account values and real game artwork. They are not a live Privy session, real balances, a completed battle, or physical iOS/PWA acceptance. The temporary fixture route was removed before build and commit.

| Screen | Before | After |
| --- | --- | --- |
| Lobby, 390 x 844 | [Before](C:/Users/USER/Documents/ChogRoyale-Assets/home-polish-pr19/before-home-mobile.jpg) | [After](C:/Users/USER/Documents/ChogRoyale-Assets/home-polish-pr19/after-home-mobile.jpg) |
| Lobby, 1366 x 768 | [Before](C:/Users/USER/Documents/ChogRoyale-Assets/home-polish-pr19/before-home-desktop.jpg) | [After](C:/Users/USER/Documents/ChogRoyale-Assets/home-polish-pr19/after-home-desktop.jpg) |
| Profile, 390 x 844 | [Before](C:/Users/USER/Documents/ChogRoyale-Assets/home-polish-pr19/before-profile-mobile.jpg) | [After](C:/Users/USER/Documents/ChogRoyale-Assets/home-polish-pr19/after-profile-mobile.jpg) |
| Profile, 1366 x 768 | [Before](C:/Users/USER/Documents/ChogRoyale-Assets/home-polish-pr19/before-profile-desktop.jpg) | [After](C:/Users/USER/Documents/ChogRoyale-Assets/home-polish-pr19/after-profile-desktop.jpg) |

- Mobile checks found no horizontal overflow in the lobby or expanded Account XP panel. The Gold disclosure stayed within the viewport and opened using Enter.
- Desktop at 1366 x 768 showed Battle ending at y=661 and bottom navigation ending at y=748. These bounds are from the labeled fixture, not an authenticated account.
- The opening component, audio manager, battle rules, backend endpoints, reward rules, and stored preferences were not edited.

## Verification

- Focused summary, account/progression/profile, audio and media tests: 108 passed.
- TypeScript, scoped ESLint, production build and diff checks passed before final review. The focused suite was rerun after the cached-route freshness correction.
- Next owner acceptance: use a real authenticated session to verify current Gold/crowns/level values and follow the compact summary into Progress on a physical phone.
