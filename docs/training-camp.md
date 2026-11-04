# Training Camp: authoritative progress, Battle 1 and Battle 2

Date: 2026-11-04. Branch `feat/next-player-experience`. Draft PR #26.
No merge, deployment, production migration or live flag change.

## What is playable

Two guided battles run on the real battle stack:

- `/app/play/training` shows server-owned progress from 0/3 to 2/3.
- `/app/play/training/battle?stage=1` teaches the first troop deployment.
- `/app/play/training/battle?stage=2` teaches tower destruction and the real
  forward deployment pocket.
- Both use the real `PracticeRoom`, `BattleSession`, readiness handshake,
  reconnect path and WebGL cleanup. There is no second simulation.
- The server owns the teaching deck and free commander. The client's ready
  payload is ignored for cards, so a forged deck cannot change a lesson.
- Replaying a completed stage is allowed, idempotent and never grants Gold,
  Card XP, Account XP, trophies or a competitive result.
- Stage 3 is honestly marked "Coming next" and is rejected by the room.

## Battle 1

The Training Captain explains card selection, tapping or dragging, valid
ground and the first deployment. The first server-accepted troop deployment
completes stage 1. Both immediate and queued commands wait for the server's
step-loop `ok` ack; a client claim cannot complete the stage.

## Battle 2

The Training Captain explains the river, bridges, both tower lines and why
defence matters while pushing. The player uses the real cards and board.

The server completes stage 2 only when both facts are true in the current
room:

1. A `structure_destroyed` frame event shows an enemy tower (`owner !== human
   seat`) actually fell.
2. A later troop deploy is accepted by `troopDeployCheck` in the
   `pocket-left` or `pocket-right` zone associated with a fallen lane.

The completion check computes the zone with the engine's own placement rule
before submitting the command, then waits for the authoritative ack. A deploy
on the player's own side, a different lane, a spell, a building or a client
claim never completes the stage. Both seats use the same pocket rule; the
client presentation flips it through `deployZones()` and the board geometry.

The stage 2 opponent uses a bounded, passive tutorial policy: it waits for a
high energy buffer, only plays ordinary troops and places them at the back.
The player still fights a real battle and must actually destroy a tower.

On a tower fall, the server reports the fallen lane in a `tutorial` message.
The HUD highlights the exact `deployZones()` pocket with a translucent "New
ground" overlay. The coach switches to "Your troops destroyed that tower! New
ground opened in the glowing lane. Deploy a troop there." The overlay never
blocks pointer input.

If the match ends before the objective, the result screen says what remains
and returns to Training Camp without a Battle Again action.

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

## Play Hub locks

When the authenticated read reports `training-required`, the Play Hub shows a
2/3 (or current) progress gate and "Continue Training" action. Practice,
Unranked and Private become non-navigable "Training required" actions and
their cards say Locked. Gate-off, no-release, schema-unavailable, graduated
and grandfathered states never lock a mode the server permits. Ranked stays
independently closed.

## Release gates

Enforcement is default-OFF through `TUTORIAL_ENFORCEMENT_ENABLED=0`. Do not
turn it on until Battle 3 and the final graduation flow exist.

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
- `src/server/battle/tutorial-room.test.ts`: real sockets for Battle 1,
  Battle 2, a real tower destruction, an outside-pocket negative, an accepted
  pocket deploy, duplicate suppression, stage-2 reconnect and normal-practice
  admission denial.
- `src/server/battle/tutorial-pockets.test.ts`: both seat perspectives and
  the exact pocket geometry.
- `src/components/app/TrainingEntry.test.ts`: stage-specific briefing, coach
  and completion copy.
- `src/components/app/PlayHub.test.ts`: lock only for a real
  `training-required` decision.
- `src/app/dev/battle/battle-result.test.ts`: no replay action and a remaining
  objective note for an incomplete training battle.
- Browser evidence: `ChogRoyale-Assets/next-pass-20261104/visual/training-camp`
  for Battle 1 and `.../visual/training-camp-2` for Battle 2, the pocket
  highlight, completion, 2/3 and the locked Play Hub.
- TypeScript, scoped ESLint and production build pass.

## Remaining

- 3C: Battle 3 (roles, commander abilities, Chaos) and graduation.
- Full 3/3 graduation flow and enforcement activation.
- Real-device and real-Privy acceptance.
