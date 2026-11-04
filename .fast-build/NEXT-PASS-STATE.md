# Next Player Experience, active milestone

Started 2026-11-04 on `feat/next-player-experience` from `origin/main` `9e93407`
(PR #25 merged). One Fast Build slice per invocation. No merge, deploy,
production migration or live flag change. Draft PR #26 holds the milestone.

## Outcome

Make Chog Royale inviting to learn: a dismissible mobile card popup, Easy
Practice, three guided tutorial battles with server-owned eligibility, a
post-tutorial navigation coach, and a scenic `/app` lobby built from the
existing Chaos Crossing art.

## Existing capabilities

- Card detail view: `DetailSheet` in `src/components/app/DecksView.tsx`, shared
  `.app-sheet` CSS. Status: partial. It has real progression, upgrade and
  deck actions but was a non-modal bottom panel with a scrolling close button.
- Practice difficulties: protocol `PRACTICE_DIFFICULTIES`, server
  `policyFor`, difficulty UI model. Status: working. Easy, Medium, Hard and
  Ultimate exist; Easy uses the same deck, costs, placement checks and rules.
  Medium remains the default difficulty.
- Tutorials / training camp: no matches in `src`. Status: missing.
- Post-tutorial navigation coach: no coachmark or tour code. Status: missing.
- Scenic `/app` lobby: `.app-root` uses a purple gradient. Existing
  Chaos Crossing world art is in `public/assets/arena/chaos-crossing/v003`.
  Status: missing.
- Battle readiness, rematch lifecycle and WebGL cleanup are shipped in PR #25
  and must stay intact.

## Slices

- [x] Slice 1: Mobile card-detail modal. Dismissible, focus-trapped, body
  scroll lock, close always visible, deck action always reachable, real
  progression data.
- [x] Slice 2: Easy Practice. Server-validated fourth difficulty, forgiving
  policy, difficulty copy, rematch retention. No reward change.
- [ ] Slice 3: Tutorial battles 1-3 with authoritative staged completion,
  persistence, resume, retries and gated modes. Safe rollout/backfill.
- [ ] Slice 4: Post-tutorial navigation coach using the real routes and
  features. Reopenable, skippable, mobile-safe.
- [ ] Slice 5: Scenic `/app` lobby atmosphere from existing world art.
  Readable, responsive, reduced-motion and low-end safe.

## Current slice

Slice 2 complete. Slice 3 is next.

## Completed

- 2026-11-04, Slice 1:
  - `DetailSheet` is now a modal overlay (`.app-cardmodal`) with a dimmed
    backdrop, a 44x44 close button, focus trap, Escape, focus restoration,
    body/html scroll lock and safe-area padding.
  - Header and deck action are fixed; card body scrolls internally. Mobile is
    a bottom sheet; 700px and up is centered.
  - Real progression, upgrade and add/remove actions are unchanged. Backdrop
    dismissal uses a pointer-down guard so a scroll drag cannot close or fire
    an action.
  - Files: `src/components/app/DecksView.tsx`,
    `src/components/app/app.css`, `src/components/app/DecksView.test.ts`.
  - Evidence: `ChogRoyale-Assets/next-pass-20261104/visual/decks` at 320x568,
    375x667, 390x844, 430x932, 768x1024 and 1366x768. Every view: close and
    footer visible, outside/X/Escape close, focus returned to the card tile,
    body scroll isolated, real Boulderback progression shown. Temporary
    `/dev/decks-qa` fixture removed; copy in `.../fixture/decks-qa`.
  - Verification: 5 DecksView tests, TypeScript, scoped ESLint. Production
    build runs at the end of the slice.

- 2026-11-04, Slice 2:
  - Added `easy` to the server-owned `PracticeDifficulty` contract, bot
    identity (`practice-easy-v1`), opponent descriptor and room validation.
    Medium remains the default.
  - `easyPolicy` reads the real hand and board but plays the first legal
    affordable card, banks to 2 energy, places troops near its own bridge,
    defends with a plain body instead of a counter, never times commander
    abilities and never uses anti-air or counter targeting. Same deck, costs,
    placement checks and rules as every difficulty.
  - UI: Easy is the first option with honest "Learn at your pace" copy. The
    practice entry and Play Hub describe Easy to Ultimate. The result and
    lobby labels resolve Easy. Battle Again keeps the server-adopted Easy
    choice through the existing selected-difficulty ref.
  - Evidence, 12 identical-deck policy games (6 seeds, both seats): Easy 0,
    Medium 12, 0 draws, every replay identical. A simple novice policy wins
    8/8 against Easy and 0/8 against Medium. Real client: 2 practice cycles,
    entry and both lobbies show Easy, both results show "EASY DIFFICULTY",
    and the second start message is `difficulty: "easy"`. No page errors.
  - Files: `src/lib/battle-protocol.ts`, `src/server/battle/practice.ts`,
    `src/server/battle/practice-room.ts`,
    `src/server/battle/practice-difficulties.test.ts`,
    `src/server/battle/practice-room-difficulties.test.ts`,
    `src/components/app/practice-difficulty-model.ts`,
    `src/components/app/PlayHub.tsx`, `src/components/app/app.css`,
    `src/components/app/BattleEntry.test.ts`,
    `src/app/dev/battle/battle-result-model.ts`,
    `src/app/dev/battle/battle-result.test.ts`.
  - Evidence: `ChogRoyale-Assets/next-pass-20261104/visual/easy-practice`.
    No reward, Gold, XP, account XP, settlement or flag path changed.

## Verification

- Slice 1: `npx vitest run src/components/app/DecksView.test.ts` 5/5,
  `npm run typecheck`, scoped ESLint, `npm run build`.
- Slice 2: 78 focused tests across practice difficulty, room lifecycle,
  BattleEntry and battle-result suites, `npm run typecheck`, scoped ESLint,
  `npm run build`. Browser: 2 Easy practice cycles with Battle Again, no page
  errors, second start difficulty `easy`.
- Browser visual evidence is dev/production-equivalent fixture or injected-auth
  QA, not a live owner account. Live account acceptance remains owner-gated.

## Blockers

- Tutorial eligibility needs a new server-owned progress store and rollout
  policy. Implement behind a safe release plan and do not apply production
  migrations or activate restrictions without owner approval.
- Easy Practice rewards remain the existing no-reward policy. Any bounded
  starter reward is a separate product decision.

## Next action

Slice 3: design the server-owned tutorial progress contract and three guided
Practice battles. Start with the persisted per-player stage record and
authoritative completion events, then the gated room/eligibility checks, then
the coach UI. Cover retries, reconnect/resume, duplicate completion, existing
player backfill and the rollout flag. Do not apply production migrations or
lock modes for existing players without owner approval.

## References

- `ChogRoyale-Assets/next-pass-20261104/references/README_REFERENCE_MAP.md`
- Owner bug image: `owner-input/01-current-card-panel-mobile.png`
- Recordings and contact sheets for interaction principles only.
- Do not modify `AGENTS.md`.
