# Training Camp: authoritative progress, three battles and graduation

Date: 2026-11-04. Branch `feat/next-player-experience`. Draft PR #26.
No merge, deployment, production migration or live flag change.

## What is playable

Three guided battles run on the real battle stack:

- `/app/play/training` shows server-owned progress from 0/3 to 3/3, the
  graduation panel and replay links for every finished lesson.
- `/app/play/training/battle?stage=1` teaches the first troop deployment.
- `/app/play/training/battle?stage=2` teaches tower destruction and the real
  forward deployment pocket.
- `/app/play/training/battle?stage=3` teaches a two-troop push, the commander
  deployment, one real active ability and how to read live Chaos.
- All three use the real `PracticeRoom`, `BattleSession`, readiness handshake,
  reconnect path and WebGL cleanup. There is no second simulation.
- The server owns the teaching deck and free Bulwark commander. The client's
  ready payload is ignored for cards, so a forged deck cannot change a lesson.
- Replaying a completed stage is allowed, idempotent and never grants Gold,
  Card XP, Account XP, trophies or a competitive result.
- Each battle opens only after the previous one is verified. A direct room join
  before that is refused.

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

## Battle 3 and graduation

The Training Captain teaches the final lesson in four beats:

1. Build a push. The coach explains unit roles, recommends a durable frontline
   such as Chog Guardian with damage behind it, and asks the player to keep
   some energy in reserve. The server counts accepted ordinary troop deploys.
2. Deploy the commander. The hand card is highlighted once the Bulwark
   commander is drawn. The step completes only on a real `commander_deployed`
   event owned by the human seat.
3. Use the ability. The coach points at the real Aegis Wall control once the
   commander is on the field. The step completes only on an `ability_fired`
   event with `trigger: "active"` for the same seat. A rejected or unaffordable
   ability attempt never counts.
4. Read Chaos. The briefing explains that the Arena Patron controls the pulse
   schedule. During play the coach shows a warning or active line only when the
   authoritative frame actually carries one, including its real name and state.
   Graduation never depends on a Chaos event, so a passive or short match cannot
   strand the lesson.

Stage 3 completes when all three authoritative facts are present: two accepted
ordinary troop deploys, the human `commander_deployed` event, and a human
`active` `ability_fired` event. Objectives may land in any order the real battle
allows; the coach presents them as a sequence but the server accepts whichever
order actually happened. This keeps a commander-first opening from forcing a
cooldown wait.

If the commander falls before the ability is used, the coach says so and points
the player back to the hand. The commander card becomes drawable again after
death, so the lesson remains completable without weakening combat rules.

The stage 3 opponent uses the same bounded passive tutorial policy: it waits
for a high energy buffer, plays ordinary troops only, places them at its own
back and never fires abilities.

Completion writes stage 3 once, sets `graduated_at`, preserves the earlier
stage timestamps and returns the graduated tutorial message. The battle result
stays the real result, and a graduation panel then offers `Enter Battle Hall`
plus a return to camp. The camp shows 3/3, a graduation panel and replay links
for all three lessons.

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

When the authenticated read reports `training-required`, the Play Hub shows the
current progress gate and "Continue Training" action. Practice, Unranked and
Private become non-navigable "Training required" actions and their cards say
Locked. Gate-off, no-release, schema-unavailable, graduated and grandfathered
states never lock a mode the server permits. Ranked stays independently closed.

## Release gates

Enforcement is default-OFF through `TUTORIAL_ENFORCEMENT_ENABLED=0`. All three
battles and the graduation flow now exist in code, but this flag, migration
0029 and the release row are still unapplied outside TEST. Implementation
readiness is not activation.

Owner-only activation, after explicit approval and a coordinated window:

1. Confirm the deployed web build contains this Training Camp code. The web
   app and battle server are separate runtimes: Vercel serves `/app`, while the
   Colyseus battle server runs on the VPS. A flag on one side does not change
   the other.
2. Apply migration 0029 to production. It is additive and safe to run before
   the boundary exists.
3. Insert the singleton `tutorial_release` boundary at the intended activation
   instant with `grandfather_before` set to that instant, using the owner
   helper. Every account created before the boundary becomes exempt.
4. Set `TUTORIAL_ENFORCEMENT_ENABLED=1` on the VPS battle runtime and restart
   it, because admission for `BattleRoom`, `QueueRoom` and `PracticeRoom` runs
   there. Vercel reads the same flag only to render Play Hub locks, so deploy
   that environment change in the same window.
5. Verify in order: a pre-boundary account reads `grandfathered` and can enter
   a normal mode; a brand-new account reads `training-required` and is denied
   normal room admission; that new account can finish 1, 2 and 3 and then enter
   a normal mode; a reconnect to an already-authorized match still succeeds.
6. Keep Ranked closed on its own release flag regardless of training state.

Do not backfill completions, do not write a boundary before the migration
exists, and do not leave the flag on with the boundary missing. The policy
fails open for a missing schema or missing release on purpose, so a partial
rollout cannot lock every player.

Rollback: unset `TUTORIAL_ENFORCEMENT_ENABLED` on both runtimes and restart the
battle server. Existing progress rows are untouched, and the release boundary
can stay in place for a later retry.

## Verification

- `src/server/tutorial.test.ts`: gate-off, missing schema, missing release,
  graduated, explicit grandfather, boundary grandfather and denial.
- `src/db/tutorial.test.ts`: stage order, idempotent duplicates, preserved
  timestamps, concurrent graduation without a double write, account isolation,
  graduation, release idempotency and grandfathering against the TEST branch.
- `src/server/battle/tutorial-room.test.ts`: real sockets for Battle 1,
  Battle 2 and Battle 3, including a real tower destruction, an outside-pocket
  negative, an accepted pocket deploy, a rejected single-deploy skip, a real
  commander deployment, a real active ability, stage-3 reconnect, an abandoned
  attempt that never graduates, duplicate suppression and admission denial.
- `src/server/battle/tutorial-pockets.test.ts`: both seat perspectives and
  the exact pocket geometry.
- `src/components/app/TrainingEntry.test.ts`: stage-specific briefing, the
  stage-3 push/commander/ability sequence, the fallen-commander retry copy, the
  graduation panel, real Chaos copy and no invented rewards.
- `src/components/app/PlayHub.test.ts`: lock only for a real
  `training-required` decision.
- `src/app/dev/battle/battle-result.test.ts`: no replay action and a remaining
  objective note for an incomplete training battle.
- Browser evidence: `ChogRoyale-Assets/next-pass-20261104/visual/training-camp`
  for Battle 1, `.../visual/training-camp-2` for Battle 2 and
  `.../visual/training-camp-3` for Battle 3, graduation and the 3/3 camp.
- TypeScript, scoped ESLint and production build pass.

## Remaining

- Real-device and real-Privy acceptance.
- Production activation of migration 0029, the release boundary and
  `TUTORIAL_ENFORCEMENT_ENABLED`, which stays owner-gated.
- Any reward for Training Camp completion is a separate product decision and is
  deliberately absent.
