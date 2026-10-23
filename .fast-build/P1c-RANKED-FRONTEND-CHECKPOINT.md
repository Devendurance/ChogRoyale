# P1c Ranked Frontend Integration

Date: 2026-10-23
Baseline: `8ba1770` (Ranked trophies implemented)

## Scope

- `/app/play` now presents Season 1 ranked identity, server-checked eligibility, closed matchmaking and a read-only Progress link.
- `/app/play/battle?mode=ranked` is blocked by the closed `RANKED_PUBLIC_MATCHMAKING_ENABLED` gate before the shared `BattlePanel` mounts.
- `/app/progress` reads the existing authenticated `/api/players/me/ranked` and `/api/leaderboard/ranked` contracts. It shows server trophies, position, season, W/L/D, recent awarded deltas, public avatars, tied positions and the current player's position. Casual standings remain separate.
- Ranked result feedback reads the exact match award only after `settled` or `already-settled`, with four bounded requests. Private and unranked results never display trophies.

## Verification

- `npx vitest run src/components/app/ranked-model.test.ts`: 4/4.
- `npx vitest run src/components/app/ranked-model.test.ts src/app/api/players/me/ranked/route.test.ts src/app/api/leaderboard/ranked/route.test.ts`: 10/10.
- `npm run typecheck`: pass.
- `npm run lint`: pass with one pre-existing `src/app/dev/progress/page.tsx` `img` warning.
- `npm run build`: pass.
- Browser fixture checks on localhost:3000: signed-out `/app/play`, ranked URL gate, signed-out `/app/progress`; no console errors observed. No authenticated ranked match was claimed.

## Release boundary

No database migrations, PROD writes, deployment, public ranked activation, combat changes or Colyseus changes. Public ranked remains blocked pending PROD migrations 0011 and 0012, settlement-enabled runtime, public multiplayer deployment, ranked acceptance coverage and anti-farming policy.
