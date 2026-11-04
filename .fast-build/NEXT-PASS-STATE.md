# Next Player Experience, active milestone

Started 2026-11-04 on `feat/next-player-experience` from `origin/main` `9e93407`
(PR #25 merged). One Fast Build slice per invocation. No merge, deploy,
production migration or live flag change.

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
  `policyFor`, difficulty UI model. Status: partial. Medium, Hard and Ultimate
  exist. Easy is missing.
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
- [ ] Slice 2: Easy Practice. Server-validated fourth difficulty, forgiving
  policy, difficulty copy, rematch retention. No reward change.
- [ ] Slice 3: Tutorial battles 1-3 with authoritative staged completion,
  persistence, resume, retries and gated modes. Safe rollout/backfill.
- [ ] Slice 4: Post-tutorial navigation coach using the real routes and
  features. Reopenable, skippable, mobile-safe.
- [ ] Slice 5: Scenic `/app` lobby atmosphere from existing world art.
  Readable, responsive, reduced-motion and low-end safe.

## Current slice

Slice 1 complete. Slice 2 is next.

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

## Verification

- Slice 1: `npx vitest run src/components/app/DecksView.test.ts` 5/5,
  `npm run typecheck`, scoped ESLint, `npm run build`.
- Browser: production-equivalent dev render at six viewports, no page errors.
  The fixture is not authenticated production data; live account acceptance
  remains owner-gated.

## Blockers

- Tutorial eligibility needs a new server-owned progress store and rollout
  policy. Implement behind a safe release plan and do not apply production
  migrations or activate restrictions without owner approval.
- Easy Practice rewards remain the existing no-reward policy. Any bounded
  starter reward is a separate product decision.

## Next action

Slice 2: add `easy` to `PracticeDifficulty` and `PRACTICE_DIFFICULTIES`, add a
server-validated Easy policy in `src/server/battle/practice.ts`, expose it in
the Practice UI with honest copy, preserve it through rematch, and test that it
is measurably more forgiving than Medium without changing rewards or rules.

## References

- `ChogRoyale-Assets/next-pass-20261104/references/README_REFERENCE_MAP.md`
- Owner bug image: `owner-input/01-current-card-panel-mobile.png`
- Recordings and contact sheets for interaction principles only.
- Do not modify `AGENTS.md`.
