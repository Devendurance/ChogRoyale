# P2d Card Inventory and Upgrade Experience

Date: 2026-10-23
Baseline: f289ff4, P2c server-authoritative card stat scaling

## Scope

- Extended the existing authenticated `/app/decks` collection with all 20 ordinary card progression states.
- Added server-backed purchased level, XP potential, lifetime XP, XP target, Gold cost, Gold balance and max/locked/ready presentation.
- Added a separate card detail progression panel and upgrade action. Loadout editing and save conflict behavior remain unchanged.
- Upgrade requests use the existing POST contract with `cardId`, `expectedLevel` and a fresh UUID idempotency key. Responses are reread before the UI reports a confirmed level.
- Added explicit unavailable, session and setup-lock states for the existing production schema gate. No fixture values ship.

## Verification

- `npx vitest run src/components/app/decks-model.test.ts --pool=forks --maxWorkers=1`: 30 passed.
- `CHOG_TEST_DB=1 npx vitest run src/app/api/players/me/card-xp/route.test.ts src/app/api/players/me/card-xp/upgrade/route.test.ts src/app/api/players/me/gold/route.test.ts --pool=forks --maxWorkers=1`: 9 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with the existing `src/app/dev/progress/page.tsx` `no-img-element` warning.
- `npm run build`: passed.
- Browser fixture, authenticated local Endychog session, schema-unavailable response: collection rendered all 20 cards at 390x844 and 1366x768. `scrollWidth` matched the client width at both sizes. Card detail opened at mobile width without overflow.

## Evidence

- `C:/Users/USER/Documents/ChogRoyale-Assets/p2d-card-progression-20261023/collection-mobile-390x844-schema-unavailable.png`
- `C:/Users/USER/Documents/ChogRoyale-Assets/p2d-card-progression-20261023/collection-desktop-1366x768-schema-unavailable.png`

## Release boundary

Production migrations 0010-0014 are not applied. The browser pass therefore verifies the honest unavailable state only. No live production upgrade or multiplayer progression claim is made. No database, combat, Colyseus, deployment or push changes were made.
