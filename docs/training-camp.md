# Training Camp: authoritative progress and Battle 1

Date: 2026-11-04. Branch `feat/next-player-experience`. Draft PR #26.
No merge, deployment, production migration or live flag change.

## What is playable

Battle 1, First Deployment, is playable end to end on the real battle stack:

- `/app/play/training` shows the player's server-owned progress, 0/3 or 1/3.
- `/app/play/training/battle?stage=1` opens the real PracticeRoom with a fixed
  teaching deck, the Easy bot, normal readiness, reconnect and WebGL lifecycle.
- The Training Captain explains card selection, tapping or dragging, valid
  ground and the first deployment.
- The client sends the fixed teaching ready payload. The server ignores the
  payload's cards and uses its own copy, so a forged deck cannot change the
  lesson.
- The first server-accepted troop deployment completes stage 1. A queued
  command is accepted only from the step-loop ack, never from a client claim.
- Completion is shown as a modal and the player returns to Training Camp.
  Progress is read back from the account, not from local UI state.
- Replaying Battle 1 is allowed and idempotent. It never grants Gold, Card XP,
  Account XP, trophies or a competitive result.

Battles 2 and 3 are honestly marked "Coming next" and are rejected by the
room until their slices land.

## Progress contract

Additive migration `0029_dazzling_mole_man.sql`:

- `player_tutorial_progress`: one row per player, `stage` 0 to 3, one
  completion timestamp per stage, `grandfathered_at`, `graduated_at`.
  Check constraints keep the stage and timestamps consistent.
- `tutorial_release`: singleton activation boundary written only by an
  owner-run step. It stores `enforced_at` and `grandfather_before`.

`src/db/tutorial.ts` owns persistence:

- `completeTutorialStage` advances exactly one stage. Duplicate calls are
  idempotent, skipped stages are refused, and concurrent duplicates read the
  committed row instead of overwriting a timestamp.
- `markTutorialGrandfathered` records an exemption without inventing a stage.
- `ensureTutorialRelease` is the owner activation helper and never moves an
  existing boundary.

`src/server/tutorial.ts` owns the policy:

- Flag off: everyone is allowed (`gate-off`).
- Flag on, no release row: everyone is allowed (`no-release`). This fail-open
  prevents a partial rollout from locking every player.
- Flag on, tables missing: allowed with `schema-unavailable`, logged as an
  explicit state rather than a silent denial.
- Graduated or explicitly grandfathered: allowed.
- Account created before `grandfather_before`: marked grandfathered and
  allowed.
- Any newer account without 3/3: denied `training-required`.

Admission checks run on new joins to `BattleRoom`, `QueueRoom` and
`PracticeRoom`. Reconnects to an already-seated room bypass the gate. The
tutorial room is the only new room that admits an ungraduated player. Ranked
keeps its independent closed gate.

## Release gates

Enforcement is default-OFF through `TUTORIAL_ENFORCEMENT_ENABLED=0`. Do not
turn it on until Battles 2 and 3 exist and the Play Hub lock states ship.

Owner-only activation, after approval and the production migration:

1. Apply migration 0029.
2. Insert the singleton boundary at the intended activation instant, with
   `grandfather_before` set to that instant so every existing account is
   exempt.
3. Set `TUTORIAL_ENFORCEMENT_ENABLED=1` and restart.
4. Verify a pre-boundary account is grandfathered and a new account is asked
   to train. Do not backfill fake completions.

## Verification

- `src/server/tutorial.test.ts`: gate-off, missing schema, missing release,
  graduated, explicit grandfather, boundary grandfather and denial.
- `src/db/tutorial.test.ts`: stage order, idempotent duplicates, preserved
  timestamps, account isolation, graduation, release idempotency and
  grandfathering against the TEST branch.
- `src/server/battle/tutorial-room.test.ts`: real Colyseus tutorial start,
  fixed deck, Easy opponent, accepted troop deployment completion, duplicate
  suppression, resume and normal-practice admission denial.
- `src/components/app/TrainingEntry.test.ts`: briefing, in-progress coach and
  completion copy.
- Browser evidence: `ChogRoyale-Assets/next-pass-20261104/visual/training-camp`
  with 0/3, briefing, coach, server-confirmed completion and 1/3. The API was
  stubbed for the capture and the room used an injected completion service, so
  this is UI evidence; the DB test is the persistence evidence.
- TypeScript, scoped ESLint and production build pass.

## Remaining

- 3B: Battle 2, tower destruction and the real expanded deployment pocket.
- 3C: Battle 3, commander abilities, Chaos and graduation.
- Play Hub lock states and a complete 3/3 graduation flow before enforcement.
- Real-device and real-Privy acceptance.
