# Meet Your Kingdom: the post-training navigation coach

Date: 2026-11-05. Branch `feat/next-player-experience`. Draft PR #26.
No merge, deployment, production migration or live flag change.

## What it is

"Meet Your Kingdom" is a lightweight, optional tour of the real app. It opens
after the Training Camp reports 3/3, can be skipped, can be reopened from the
Profile page and never starts a battle.

The tour lives in the shared `/app` layout (`KingdomTour.tsx`), so a tab change
does not tear it down or restart it. It uses the real routes, the real
Navigation, the real Practice entry and the real card detail sheet. Nothing in
the tour is a second copy of the app.

## Eligibility

The only graduation signal is the authenticated `GET
/api/players/me/tutorial` read:

- The automatic invitation appears only when the server reports
  `completedStages >= 3` and the account is not grandfathered.
- A grandfathered account can start the tour from Profile but is never
  auto-invited.
- A failed, locked or schema-unavailable read hides both the invitation and
  the Profile replay action. It never becomes 3/3 on the client.
- The read runs once when the layout mounts and again after a battle, because
  a battle can graduate the account. Ordinary tab changes do not poll it.

Tour state is account-scoped in `localStorage`:

```text
chog-royale.kingdom-tour.v1.<player id>
```

The stored shape is `completed`, `dismissed`, `prompted`, `active` and
`stepId`. It contains no token, session id, tutorial count or other account
data. Malformed or older JSON falls back to an empty store.

## Steps

| Step | Real route | Real target | What it teaches |
| --- | --- | --- | --- |
| 1. Your home base | `/app` | Lobby tab | Resources, deck summary and the way into battles |
| 2. Choose your arena | `/app/play` | Practice card | Practice, Unranked, Private, closed Ranked, result screens |
| 3. Build your strategy | `/app/decks` | Decks tab | Seven cards plus the commander |
| 4. Meet your troops | `/app/decks` | First Collection card | Cost, role, stats, add and remove |
| 5. Power up your troops | `/app/decks` | Real card progression | Earned XP versus purchased level, Gold and eligibility |
| 6. Choose your champion | `/app/commanders` | Commanders tab | Commander role, free classes, entitlement |
| 7. Track your victories | `/app/progress` | Progress tab | Verified history, progression and closed Ranked |
| 8. Your Chog identity | `/app/profile` | Profile tab | Account identity and the replay action |

The card detail step switches the real Decks screen to its Collection tab and
opens the real card sheet for the upgrade lesson. While the tour is explaining
that sheet, the sheet drops its focus trap and its `aria-modal` promise so the
coach buttons outside it remain reachable. It is still visually layered over
the deck.

Tower upgrades do not exist in this build. The upgrade lesson says so and does
not draw a tower button, price or level.

## Behavior

- Next and Back move through the real routes. The tour pushes a route only
  when a step needs one.
- A manual tab change pauses the tour instead of pulling the player back. The
  player can reopen it from Profile.
- Skip marks the tour dismissed and does not ask again. Finish marks it
  completed. Escape pauses without marking either.
- A resumed tab returns to the saved step once.
- Entering a battle hides the coach. A battle always wins.
- The automatic invitation appears once per account, only on the lobby or the
  Battle Hall, after the branded opening has cleared. It waits while the
  opening dialog is open instead of giving up.
- Every invitation has `Show me around` and `Not now`. Escape dismisses the
  prompt without marking the tour completed.

## Mobile and accessibility

- The coach is positioned from the real target rectangle, clamped inside the
  viewport and above the fixed navigation. Safe-area insets are measured once
  per resize and included in the clamp.
- The coach width is capped at 348px and shrinks on small phones. Content
  scrolls inside the card, with `max-height` bounded by `100dvh`.
- Close, Back, Next and Skip controls are at least 44px tall.
- The coach is a labelled `role="dialog"` without `aria-modal`, because the
  page stays usable. Focus moves into the coach on each step and returns to
  the originating control, or the active tab when the origin is gone.
- `prefers-reduced-motion` disables the invitation entrance and the spotlight
  transition, and uses instant scrolling.
- Hidden Cache Components routes are ignored by every target lookup, so a
  cached Decks or Play page cannot steal the spotlight. Targets are selected
  by visibility, not by document order.

## Verification

- `src/lib/kingdom-tour.test.ts`: eight real steps, exact route matching,
  invitation rules, grandfathering, storage parsing, real progression copy,
  coach placement and safe-area positioning.
- `src/components/app/kingdom-tour-active.test.ts`: shared store notifications.
- `src/components/app/kingdom-tour-panels.test.ts`: invitation, step count,
  controls, spotlight geometry and the absence of fake tower controls.
- `src/components/app/AppNav.test.ts`: all five real tab targets.
- `src/components/app/DecksView.test.ts`: one Collection target, real
  progression data attributes, unavailable states and the sheet close target.
- `src/components/app/PlayHub.test.ts`: the real Practice card target and the
  honest locked Ranked state.
- TypeScript, scoped ESLint and the production build.

Browser evidence lives in
`ChogRoyale-Assets/next-pass-20261104/visual/navigation-coach`. It is a
presentation fixture over the real panel components and real app CSS, not a
live Privy account. The same folder includes a real `DecksView` check:
`sheet-results.json` shows the sheet without `aria-modal` and with Tab leaving
the sheet while the store is active, then `aria-modal="true"` and a working
focus trap when it is not. Live authenticated acceptance and a real phone
remain owner-gated.

## Release state

No migration, flag or production write belongs to this slice. Tutorial
enforcement, migration 0029 and `TUTORIAL_ENFORCEMENT_ENABLED` remain exactly
as documented in `docs/training-camp.md`.
