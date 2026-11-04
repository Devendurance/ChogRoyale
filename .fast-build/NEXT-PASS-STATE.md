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
- Tutorials / training camp: `player_tutorial_progress`, `tutorial_release`,
  the policy in `src/server/tutorial.ts`, the `battle_tutorial` room and the
  Training Camp hub. Status: working, release-gated. Battles 1, 2 and 3 are
  playable, persist server-side and graduate to 3/3. The Play Hub lock states
  exist. Enforcement and the production migration remain default-OFF and
  owner-gated.
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
  - [x] 3A: persistent progress contract + playable Battle 1.
  - [x] 3B: Battle 2 (towers, territory, real expanded pocket) and Play Hub
    lock states.
  - [x] 3C: Battle 3 (push, commander, active ability, real Chaos), graduation
    and release-ready eligibility. Production activation stays owner-gated.
- [ ] Slice 4: Post-tutorial navigation coach using the real routes and
  features. Reopenable, skippable, mobile-safe.
- [ ] Slice 5: Scenic `/app` lobby atmosphere from existing world art.
  Readable, responsive, reduced-motion and low-end safe.

## Current slice

Slice 3C complete. Slice 3 is code-complete with release gates held. Slice 4 is
next.

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

- 2026-11-04, Slice 3A:
  - Additive migration 0029 adds `player_tutorial_progress` and the
    `tutorial_release` singleton. Applied to TEST only. Check constraints keep
    the stage and timestamps consistent; no production migration was run.
  - `src/db/tutorial.ts` provides stage-ordered, idempotent completion and
    explicit grandfathering. `src/server/tutorial.ts` owns the gate-off,
    no-release, graduated, grandfathered and training-required policy.
  - New `battle_tutorial` room reuses PracticeRoom, the real BattleSession,
    readiness, reconnect and WebGL cleanup. Only stage 1 is accepted; a fixed
    teaching deck is server-owned, and completion is triggered only by a
    server-generated `ok` ack for a troop deploy (queued or immediate).
  - New authenticated read `/api/players/me/tutorial`, `/app/play/training`
    hub with 0/3 to 1/3, briefing and coach, and `/app/play/training/battle`.
    Battle 2/3 are honestly marked coming next. Normal Practice, Unranked and
    Private joins call the admission gate; reconnects skip it. The gate is
    default-OFF via `TUTORIAL_ENFORCEMENT_ENABLED=0`.
  - Evidence: DB suite 4/4, tutorial policy 6/6, real-room suite 5/5,
    TrainingEntry 3/3, 75 focused tests, typecheck, scoped lint and build.
    Browser captures at `ChogRoyale-Assets/next-pass-20261104/visual/training-camp`
    show 0/3, briefing, coach, server-confirmed completion and 1/3.
  - Limits: the browser capture uses an API fixture and injected completion
    service; DB persistence is proven separately. Stages 2/3, the Play Hub
    lock states and graduation are not built. Enforcement must stay OFF.

- 2026-11-04, Slice 3B:
  - Battle 2 is playable at `/app/play/training/battle?stage=2` after verified
    Battle 1. The server rejects stage 2 at 0/3 and rejects stage 3.
  - The room tracks `structure_destroyed` events for an enemy tower. It only
    completes after a later accepted troop deploy in the engine's
    `pocket-left`/`pocket-right` zone associated with a fallen lane. Own-side,
    other-lane, spell, building and client-claim paths do not complete it.
  - The stage 2 bot uses a bounded passive policy; the player still fights a
    real battle and destroys a real tower. The coach switches on the actual
    tower fall and highlights the real `deployZones()` pocket. The result
    screen explains the remaining objective if the battle ends early.
  - The Training Camp hub shows Battle 1 complete, Battle 2 ready, Battle 3
    coming next, and 1/3 to 2/3. Stage 2 cannot be opened from the hub before
    Battle 1. The Play Hub locks only when the server reports
    `training-required`; gate-off, no-release, schema-unavailable, graduated
    and grandfathered states keep their authorized modes.
  - Evidence: `src/server/battle/tutorial-room.test.ts` 6/6 (real tower,
    outside-pocket negative, pocket completion, stage-2 reconnect), pocket
    geometry 2/2, DB suite 4/4, policy 6/6, UI suites, typecheck, scoped lint
    and build. Browser: `ChogRoyale-Assets/next-pass-20261104/visual/training-camp-2`.
  - Limits: the browser capture uses an API fixture and injected completion
    service. DB persistence is proven separately. Battle 3 and graduation
    remain. Enforcement must stay OFF.

- 2026-11-04, Slice 3C:
  - Battle 3 is playable at `/app/play/training/battle?stage=3` only at 2/3 or
    better. The server completes it only when three authoritative facts exist:
    two accepted ordinary troop deploys, a human `commander_deployed` event and
    a human `ability_fired` event with `trigger: "active"`. Rejected,
    unaffordable or client-claimed attempts never count.
  - The coach walks push, commander and ability, highlights the real commander
    card and the real Aegis Wall control, and explains energy and cooldown. If
    the commander falls, it tells the player to redraw and redeploy it. Chaos
    copy appears only from authoritative `frame.chaos` state and graduation
    never depends on a pulse.
  - Stage 3 writes 3/3 once and sets `graduated_at` exactly once. The DB suite
    now proves concurrent graduation and preserved earlier timestamps. A
    graduation panel offers Enter Battle Hall, the camp shows 3/3 with all
    three replay links, and Play Hub locks release for graduated accounts.
  - Activation sequence for migration 0029, the release boundary and
    `TUTORIAL_ENFORCEMENT_ENABLED` is documented in `docs/training-camp.md`,
    including the separate Vercel and VPS runtimes and grandfathering. Nothing
    was applied or flipped.
  - Evidence: tutorial sockets 10/10 (stage 3 gate, one-deploy negative,
    real commander, real ability, stage-3 reconnect, abandoned attempt),
    DB 5/5, Training UI 9/9, Play Hub 3/3, battle-result 45/45, pocket 2/2,
    typecheck, scoped lint, production build. Browser:
    `ChogRoyale-Assets/next-pass-20261104/visual/training-camp-3` with 2/3
    camp, briefing, push coach, commander highlight, live Chaos plus ready
    ability, graduation, Battle Hall and the 3/3 camp.
  - Limits: browser evidence uses the injected-auth QA server and an API
    fixture for progress. Live Privy acceptance and production activation
    remain owner-gated.

## Verification

- Slice 1: `npx vitest run src/components/app/DecksView.test.ts` 5/5,
  `npm run typecheck`, scoped ESLint, `npm run build`.
- Slice 2: 78 focused tests across practice difficulty, room lifecycle,
  BattleEntry and battle-result suites, `npm run typecheck`, scoped ESLint,
  `npm run build`. Browser: 2 Easy practice cycles with Battle Again, no page
  errors, second start difficulty `easy`.
- Slice 3A: 75 focused tests plus the DB tutorial suite 4/4; policy 6/6; real
  tutorial room 5/5; TrainingEntry 3/3; typecheck; scoped ESLint; build.
  Browser evidence is captured but uses a fixture API and injected completion,
  so it is UI evidence, not live account acceptance.
- Slice 3B: real tutorial room 6/6 including a real tower and stage-2
  reconnect, pocket geometry 2/2 for both seats, DB 4/4, policy 6/6, Training
  UI 5/5, Play Hub 3/3, battle-result 45/45, typecheck, scoped ESLint, build.
  Browser evidence at `.../visual/training-camp-2` with 1/3 to 2/3, tower
  coach, real pocket highlight, completion and locked Play Hub.
- Slice 3C: real tutorial room 10/10 including the stage-3 gate, a single
  deploy that does not complete, a real commander deployment, a real active
  ability, stage-3 reconnect, duplicate suppression and an abandoned attempt
  that never graduates. DB 5/5 with concurrent graduation. Training UI 9/9,
  Play Hub 3/3, battle-result 45/45, pocket 2/2, practice difficulty 6/6,
  typecheck, scoped ESLint, production build.
  Browser evidence at `.../visual/training-camp-3` with 2/3 camp, Battle 3
  briefing, push coach, commander highlight, live Chaos with a ready ability,
  graduation, Battle Hall and the 3/3 camp.
- Browser visual evidence is dev/production-equivalent fixture or injected-auth
  QA, not a live owner account. Live account acceptance remains owner-gated.

## Blockers

- Production activation is owner-gated: apply migration 0029, insert the
  release boundary, then enable `TUTORIAL_ENFORCEMENT_ENABLED` on the VPS
  battle runtime and the Vercel environment in one window, per
  `docs/training-camp.md`. Nothing here was applied or flipped.
- Easy Practice rewards remain the existing no-reward policy. Any bounded
  starter reward is a separate product decision.

## Next action

Slice 4: the post-tutorial navigation coach on the real routes. Show it once
after graduation, keep it reopenable and skippable, make it mobile-safe and
respect reduced motion. Do not add rewards or change tutorial enforcement.

## References

- `ChogRoyale-Assets/next-pass-20261104/references/README_REFERENCE_MAP.md`
- Owner bug image: `owner-input/01-current-card-panel-mobile.png`
- Recordings and contact sheets for interaction principles only.
- Do not modify `AGENTS.md`.
