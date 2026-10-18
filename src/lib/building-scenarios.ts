// B2.7a headless building scenarios. Real engine runs driven only by legal
// commands (no state surgery, no scripted outcomes). Shared by the Vitest
// suite and scripts/arena-scenarios.ts. Pure: no DB, no network.

import { runMatch, initMatch, stepMatch, stateHash, type CombatState, type DeployCommand, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, deckWith, traceMatch, botMatch, crossingsUsed, riftSchedule, type TraceSample } from "@/lib/arena-scenarios";

const d = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const P0_DECK = () => deckWith("rift_sentry", "decoy_totem", "chog_guardian");
const P1_DECK = () => deckWith("rift_runner", "choglings", "hexwing", "boulderback");
const towerHp = (s: CombatState, id: string) => s.structures.find((x) => x.id === id)!.hp;
const buildingEvents = (s: CombatState) =>
  s.events.flatMap((e) => (e.type === "building_spawned" ? [{ kind: "spawned", id: e.buildingId, tick: e.tick }] : e.type === "building_removed" ? [{ kind: e.reason, id: e.buildingId, tick: e.tick }] : []));
const targetsOf = (samples: TraceSample[], owner: PlayerIndex) => [...new Set(samples.filter((x) => x.owner === owner).map((x) => x.targetId ?? "none"))];

function run(cmds: DeployCommand[], ticks: number, p0 = P0_DECK(), p1 = P1_DECK()) {
  return traceMatch(scenarioConfig(p0, p1), cmds, ticks);
}

/** A. Rift Sentry shoots enemy choglings walking the left lane (vs control). */
export function sentryDefense() {
  const atk = d(2, 1, 5, "choglings", 30, 100);
  const sentry = run([d(1, 0, 2, "rift_sentry", 30, 56), atk], 400);
  const control = run([atk], 400);
  const shots = (s: CombatState) => s.events.filter((e) => e.type === "death" && e.owner === 1).length;
  return {
    sentryKills: shots(sentry.state),
    controlKills: shots(control.state),
    towerWith: towerHp(sentry.state, "s-p0-tower-30"),
    towerWithout: towerHp(control.state, "s-p0-tower-30"),
    events: buildingEvents(sentry.state),
  };
}

/**
 * B/C/D. A Decoy Totem just outside tower range pulls a structure-priority
 * Rift Runner off the tower; once the Runner destroys it, the Runner
 * re-targets the lane tower.
 */
export const TOTEM_SPOT = { x: 40, y: 70 } as const;
export function totemDistraction() {
  const atk = d(2, 1, 5, "rift_runner", 30, 100);
  const totem = d(1, 0, 2, "decoy_totem", TOTEM_SPOT.x, TOTEM_SPOT.y);
  const withTotem = run([totem, atk], 600);
  const control = run([atk], 600);
  const totemId = withTotem.state.events.find((e) => e.type === "building_spawned")!;
  const id = totemId.type === "building_spawned" ? totemId.buildingId : "";
  const runner = withTotem.samples.filter((x) => x.owner === 1);
  const removed = withTotem.state.events.find((e) => e.type === "building_removed");
  const removedTick = removed?.tick ?? null;
  const firstTotemTarget = runner.find((x) => x.targetId === id)?.tick ?? null;
  const afterRemoval = removedTick === null ? [] : runner.filter((x) => x.tick > removedTick);
  return {
    totemId: id,
    firstTotemTarget,
    removed: removed?.type === "building_removed" ? { tick: removed.tick, reason: removed.reason } : null,
    retargetedTo: afterRemoval[0]?.targetId ?? null,
    targetedTotemAfterRemoval: afterRemoval.some((x) => x.targetId === id),
    controlTargets: targetsOf(control.samples, 1),
    towerAt300: { withTotem: hpAt([totem, atk], 300), control: hpAt([atk], 300) },
  };
}

function hpAt(cmds: DeployCommand[], tick: number) {
  return towerHp(run(cmds, tick).state, "s-p0-tower-30");
}

/** E. Hexwing (air) attacks the ground-only Sentry, which never targets it. */
export function airVsSentry() {
  const s = initMatch(scenarioConfig(P0_DECK(), P1_DECK()));
  const cmds = [d(1, 0, 2, "rift_sentry", 30, 56), d(2, 1, 5, "hexwing", 30, 100)];
  let sentryTargetedHex = false;
  let hexTargetedSentry = false;
  let sentryMinHp = Infinity;
  for (let i = 0; i < 500 && s.phase !== "final"; i++) {
    stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
    const sentry = s.buildings.find((b) => b.cardId === "rift_sentry");
    const hex = s.troops.find((t) => t.cardId === "hexwing");
    if (sentry && hex && sentry.targetId === hex.id) sentryTargetedHex = true;
    if (sentry && hex && hex.targetId === sentry.id) hexTargetedSentry = true;
    if (sentry) sentryMinHp = Math.min(sentryMinHp, sentry.hp);
  }
  return { sentryTargetedHex, hexTargetedSentry, sentryMinHp, events: buildingEvents(s), hexAlive: s.troops.some((t) => t.cardId === "hexwing") };
}

/** F. Each player defends the opposite lane with a Sentry against a Runner. */
export function mirroredLanes() {
  const cfg = scenarioConfig(deckWith("rift_sentry", "rift_runner"), deckWith("rift_sentry", "rift_runner"));
  const cmds = [d(1, 0, 2, "rift_sentry", 30, 56), d(2, 1, 2, "rift_sentry", 70, 104), d(3, 0, 90, "rift_runner", 70, 60), d(4, 1, 90, "rift_runner", 30, 100)];
  const { state } = runMatch(cfg, cmds, 400);
  const sentryHp = (p: PlayerIndex) => state.events.some((e) => e.type === "building_removed" && e.owner === p && e.reason === "destroyed");
  return {
    rejected: state.events.filter((e) => e.type === "command_rejected").length,
    sentryDestroyed: [sentryHp(0), sentryHp(1)],
    p0Tower: towerHp(state, "s-p0-tower-30"),
    p1Tower: towerHp(state, "s-p1-tower-70"),
    deaths: state.events.flatMap((e) => (e.type === "death" ? [`${e.entityId}@${e.tick}`] : [])),
    events: buildingEvents(state),
  };
}

/** G. A Sentry guarding the attacked lane beats one placed in the far corner. */
export function placementValue() {
  const atk = [d(2, 1, 5, "choglings", 30, 100), d(3, 1, 60, "chog_guardian", 30, 100)];
  const p1 = deckWith("choglings", "chog_guardian");
  const good = run([d(1, 0, 2, "rift_sentry", 30, 56), ...atk], 600, P0_DECK(), p1);
  const poor = run([d(1, 0, 2, "rift_sentry", 85, 20), ...atk], 600, P0_DECK(), p1);
  return { goodTower: towerHp(good.state, "s-p0-tower-30"), poorTower: towerHp(poor.state, "s-p0-tower-30") };
}

/** H. An untouched Totem expires on schedule and frees its footprint. */
export function expiry() {
  const r = run([d(1, 0, 2, "decoy_totem", 30, 58), d(2, 0, 150, "choglings", 30, 58), d(3, 0, 210, "choglings", 30, 58)], 260, deckWith("decoy_totem", "choglings"));
  return {
    events: buildingEvents(r.state),
    rejected: r.state.events.flatMap((e) => (e.type === "command_rejected" ? [`${e.seq}:${e.reason}`] : [])),
    buildingsLeft: r.state.buildings.length,
  };
}

/** Bridge preservation: closest legal buildings flank the left bridge mouth, own troops still cross it. */
export function bridgeClearance() {
  const cfg = scenarioConfig(deckWith("rift_sentry", "decoy_totem", "chog_guardian"), deckWith());
  const r = traceMatch(cfg, [d(1, 0, 2, "rift_sentry", 30, 64), d(2, 0, 60, "decoy_totem", 22, 64), d(3, 0, 200, "chog_guardian", 30, 50)], 500);
  const guardian = r.samples.filter((x) => x.cardId === "chog_guardian");
  return {
    rejected: r.state.events.flatMap((e) => (e.type === "command_rejected" ? [`${e.seq}:${e.reason}`] : [])),
    crossings: crossingsUsed(guardian),
    maxY: Math.max(...guardian.map((x) => x.y)),
  };
}

/** I/J/K. Full bot matches with building decks; replayed for hash identity. */
export function buildingMatch(seed = "b27a") {
  const cfg = () =>
    scenarioConfig(deckWith("rift_sentry", "decoy_totem", "cmdr:free-warden"), deckWith("decoy_totem", "rift_sentry", "rift_runner", "cmdr:free-reaver"), riftSchedule(seed), seed);
  const bot = botMatch(cfg(), 3100, 20);
  const a = runMatch(cfg(), bot.commands);
  const b = runMatch(cfg(), [...bot.commands].reverse());
  const ev = a.state.events;
  return {
    commands: bot.commands.length,
    rejected: ev.filter((e) => e.type === "command_rejected").length,
    buildings: buildingEvents(a.state).reduce<Record<string, number>>((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {}),
    commanderDeploys: ev.filter((e) => e.type === "commander_deployed").length,
    abilityActivations: ev.filter((e) => e.type === "ability_fired" && e.trigger === "active").length,
    pulses: ev.filter((e) => e.type === "pulse_active").length,
    result: a.result,
    replayIdentical: a.result.stateHash === b.result.stateHash && JSON.stringify(a.state.events) === JSON.stringify(b.state.events),
    steppedEqualsReplay: stateHash(bot.state) === a.result.stateHash,
  };
}
