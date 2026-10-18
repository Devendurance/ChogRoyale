// B2.7c1 headless roster scenarios (Gale Netter anti-air, Riftbreaker
// demolition). Real engine runs from legal commands only: no state surgery,
// no scripted outcomes. Shared by the Vitest suite and scripts. Pure.

import { initMatch, stepMatch, runMatch, stateHash, type CombatConfig, type CombatState, type DeployCommand, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, deckWith, botMatch, riftSchedule } from "@/lib/arena-scenarios";

export const d = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const P0_LEFT = "s-p0-tower-30";
export const towerHp = (s: CombatState, id = P0_LEFT) => s.structures.find((x) => x.id === id)?.hp ?? 0;
const ids = (s: CombatState, cardId: string, owner: PlayerIndex) =>
  s.events.flatMap((e) => (e.type === "deploy" && e.cardId === cardId && e.player === owner ? e.entityIds : []));
/** Death ticks of every unit of `cardId` owned by `owner` (sorted). */
export const deathTicks = (s: CombatState, cardId: string, owner: PlayerIndex) => {
  const mine = new Set(ids(s, cardId, owner));
  return s.events.flatMap((e) => (e.type === "death" && mine.has(e.entityId) ? [e.tick] : [])).sort((a, b) => a - b);
};
export const hpLeft = (s: CombatState, cardId: string, owner: PlayerIndex) =>
  s.troops.filter((t) => t.cardId === cardId && t.owner === owner && t.hp > 0).reduce((n, t) => n + t.hp, 0);
export const buildingEnd = (s: CombatState, cardId: string) => {
  const e = s.events.find((x) => x.type === "building_removed" && x.cardId === cardId);
  return e && e.type === "building_removed" ? { tick: e.tick, reason: e.reason } : null;
};
export const buildingHp = (s: CombatState, cardId: string) => s.buildings.find((b) => b.cardId === cardId && b.alive)?.hp ?? 0;
export const rejected = (s: CombatState) => s.events.filter((e) => e.type === "command_rejected").length;
export const run = (cfg: CombatConfig, cmds: DeployCommand[], upto: number) => runMatch(cfg, cmds, upto).state;
/** First tick P0's left tower loses HP (real stepper). */
function firstTowerHit(cfg: CombatConfig, cmds: DeployCommand[], upto = 400): number | null {
  const s = initMatch(cfg);
  while (s.phase !== "final" && s.tick < upto) {
    stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
    if (towerHp(s) < 600) return s.tick;
  }
  return null;
}

/** A. Netter (3e) vs Hexwing (4e) attacking P0's left tower, against no defender and against Chaos Archer (3e). */
export function netterVsHexwing() {
  const cfg = () => scenarioConfig(deckWith("gale_netter", "chaos_archer"), deckWith("hexwing"));
  const atk = d(1, 1, 5, "hexwing", 30, 100);
  const netterCmds = [atk, d(2, 0, 5, "gale_netter", 30, 50)];
  const archerCmds = [atk, d(2, 0, 5, "chaos_archer", 30, 50)];
  const hexwingDeath = deathTicks(run(cfg(), netterCmds, 400), "hexwing", 1)[0] ?? null;
  const hexwingDeathVsArcher = deathTicks(run(cfg(), archerCmds, 400), "hexwing", 1)[0] ?? null;
  // Measured at the moment the Hexwing dies (afterwards the defender walks on).
  const withNetter = run(cfg(), netterCmds, hexwingDeath ?? 400);
  const withArcher = run(cfg(), archerCmds, hexwingDeathVsArcher ?? 400);
  const control = run(cfg(), [atk], 400);
  return {
    hexwingDeath,
    hexwingDeathVsArcher,
    hexwingDeathControl: deathTicks(control, "hexwing", 1)[0] ?? null,
    netterHp: hpLeft(withNetter, "gale_netter", 0),
    archerHp: hpLeft(withArcher, "chaos_archer", 0),
    archersAlive: withArcher.troops.filter((t) => t.cardId === "chaos_archer" && t.hp > 0).length,
    towerHp: towerHp(withNetter),
    towerHpVsArcher: towerHp(withArcher),
    towerHpControl: towerHp(control),
    energy: { defender: 3, attacker: 4 },
    rejected: rejected(withNetter) + rejected(withArcher),
  };
}

/** B. Netter vs Rift Sprites: every Sprite dies to one 40-damage shot. */
export function netterVsSprites() {
  const cfg = () => scenarioConfig(deckWith("gale_netter"), deckWith("rift_sprites"));
  const atk = d(1, 1, 5, "rift_sprites", 30, 100);
  // 20 ticks: both Sprites are dead and the Netter is still on its own half.
  const s = run(cfg(), [atk, d(2, 0, 5, "gale_netter", 30, 50)], 20);
  const control = run(cfg(), [atk], 40);
  return {
    spriteDeaths: deathTicks(s, "rift_sprites", 1),
    spriteDeathsControl: deathTicks(control, "rift_sprites", 1),
    netterHp: hpLeft(s, "gale_netter", 0),
    towerHp: towerHp(s),
    towerHpControl: towerHp(control),
  };
}

/** C. Unsupported Netter (3e) on the bridge exit vs Choglings (2e): 12 per hit vs ground loses. */
export function netterPunished() {
  const cfg = () => scenarioConfig(deckWith("gale_netter", "chaos_archer"), deckWith("choglings"));
  const atk = d(1, 1, 5, "choglings", 30, 92);
  const cmds = [atk, d(2, 0, 5, "gale_netter", 30, 66)];
  const netterDeath = deathTicks(run(cfg(), cmds, 200), "gale_netter", 0)[0] ?? null;
  const s = run(cfg(), cmds, netterDeath ?? 200);
  const archer = run(cfg(), [atk, d(2, 0, 5, "chaos_archer", 30, 66)], netterDeath ?? 200);
  const alive = (st: CombatState, card: string, owner: PlayerIndex) => st.troops.filter((t) => t.cardId === card && t.owner === owner && t.hp > 0).length;
  return {
    netterDeath,
    choglingsAlive: alive(s, "choglings", 1),
    choglingsHp: hpLeft(s, "choglings", 1),
    // Same tick, Chaos Archer (3e, full damage vs ground) in the Netter's spot.
    choglingsAliveVsArcher: alive(archer, "choglings", 1),
    archersAlive: alive(archer, "chaos_archer", 0),
    energy: { netter: 3, choglings: 2 },
  };
}

/** P1 attacker vs a P0 building at the left lane; same commands for every attacker. */
function vsBuilding(building: "rift_sentry" | "decoy_totem", attacker: string, upto = 400) {
  const cfg = scenarioConfig(deckWith(building), deckWith(attacker));
  const s = run(cfg, [d(1, 0, 2, building, 30, 56), d(2, 1, 5, attacker, 30, 100)], upto);
  return { end: buildingEnd(s, building), buildingHp: buildingHp(s, building), attackerHp: hpLeft(s, attacker, 1), attackerDeath: deathTicks(s, attacker, 1)[0] ?? null, towerHp: towerHp(s) };
}

/** D/E. Riftbreaker vs Sentry and Totem, against Rift Runner (3e) and Chog Guardian (4e) on the same commands. */
export function breakerVsBuildings() {
  return {
    sentry: { riftbreaker: vsBuilding("rift_sentry", "riftbreaker"), rift_runner: vsBuilding("rift_sentry", "rift_runner"), chog_guardian: vsBuilding("rift_sentry", "chog_guardian") },
    totem: { riftbreaker: vsBuilding("decoy_totem", "riftbreaker"), rift_runner: vsBuilding("decoy_totem", "rift_runner"), chog_guardian: vsBuilding("decoy_totem", "chog_guardian") },
  };
}

/** F. Isolated Riftbreaker (4e) vs Choglings (2e) deployed in front of the tower: it ignores them and dies. */
export function breakerSwarmed() {
  const cfg = () => scenarioConfig(deckWith("choglings"), deckWith("riftbreaker"));
  const atk = d(1, 1, 5, "riftbreaker", 30, 100);
  const s = run(cfg(), [atk, d(2, 0, 25, "choglings", 30, 52)], 150);
  const control = run(cfg(), [atk], 150);
  return {
    breakerDeath: deathTicks(s, "riftbreaker", 1)[0] ?? null,
    breakerDeathControl: deathTicks(control, "riftbreaker", 1)[0] ?? null,
    choglingsLost: deathTicks(s, "choglings", 0).length,
    towerHp: towerHp(s),
    towerHpControl: towerHp(control),
    energy: { defender: 2, attacker: 4 },
  };
}

/**
 * G. Same lane, same commands: while each attacker is already hitting the
 * tower, P0 drops a Totem in its sight. Rift Runner keeps its in-range tower
 * lock; Riftbreaker drops the tower for the building. Also arrival speed.
 */
export function runnerVsBreaker() {
  const one = (attacker: string) => {
    const cfg = () => scenarioConfig(deckWith("decoy_totem"), deckWith(attacker));
    const atk = d(1, 1, 5, attacker, 30, 100);
    // Totem beside the tower ring, placed at tick 45 (both attackers are on the tower by then).
    const s = run(cfg(), [atk, d(2, 0, 45, "decoy_totem", 40, 50)], 400);
    const control = run(cfg(), [atk], 400);
    return {
      firstTowerHit: firstTowerHit(cfg(), [atk]),
      rejected: rejected(s),
      towerHpWithTotem: towerHp(s),
      towerHpControl: towerHp(control),
      totem: buildingEnd(s, "decoy_totem") ?? { hp: buildingHp(s, "decoy_totem") },
      attackerHp: hpLeft(s, attacker, 1),
    };
  };
  return { rift_runner: one("rift_runner"), riftbreaker: one("riftbreaker") };
}

/**
 * H. Building-supported defense played well: the Sentry tucked inside tower
 * cover (y 50) or backed by 2e Choglings, against the exposed y 56 Sentry of D.
 */
export function sentrySupportedDefense() {
  const one = (sentryY: number, extra: DeployCommand[]) => {
    const cfg = scenarioConfig(deckWith("rift_sentry", "choglings"), deckWith("riftbreaker"));
    const s = run(cfg, [d(1, 0, 2, "rift_sentry", 30, sentryY), d(2, 1, 5, "riftbreaker", 30, 100), ...extra], 150);
    return { breakerDeath: deathTicks(s, "riftbreaker", 1)[0] ?? null, sentry: buildingEnd(s, "rift_sentry") ?? { hp: buildingHp(s, "rift_sentry") }, towerHp: towerHp(s), rejected: rejected(s) };
  };
  return { exposed: one(56, []), covered: one(50, []), exposedPlusChoglings: one(56, [d(3, 0, 40, "choglings", 30, 50)]) };
}

/** I. Combined push: Riftbreaker + Chaos Archer behind it vs Sentry + tower, against the Breaker alone. */
export function combinedPush() {
  const cfg = () => scenarioConfig(deckWith("rift_sentry"), deckWith("riftbreaker", "chaos_archer"));
  const base = [d(1, 0, 2, "rift_sentry", 30, 56), d(2, 1, 5, "riftbreaker", 30, 100)];
  const s = run(cfg(), [...base, d(3, 1, 65, "chaos_archer", 30, 96)], 700);
  const alone = run(cfg(), base, 700);
  return {
    sentry: buildingEnd(s, "rift_sentry"),
    sentryAlone: buildingEnd(alone, "rift_sentry"),
    towerHp: towerHp(s),
    towerHpAlone: towerHp(alone),
    towerDestroyed: s.events.some((e) => e.type === "structure_destroyed" && e.entityId === P0_LEFT),
  };
}

/** J/K/L. Bot match with both new cards, commanders and Chaos; replay + stepped equality. */
export const ROSTER_DECKS: [string[], string[]] = [
  deckWith("riftbreaker", "gale_netter", "choglings", "rift_snare", "chaos_archer", "chog_guardian", "rift_sprites", "cmdr:free-warden"),
  deckWith("rift_sentry", "decoy_totem", "hexwing", "chaos_comet", "boulderback", "rift_runner", "rift_sprites", "cmdr:free-deadeye"),
];
export function rosterBotMatch(seed = "b27c1", decks: [string[], string[]] = ROSTER_DECKS) {
  const cfg = () => scenarioConfig(decks[0], decks[1], riftSchedule(seed), seed);
  const bot = botMatch(cfg(), 3000);
  const replay = runMatch(cfg(), bot.commands, 3000).state;
  const ev = bot.state.events;
  const deploys = (card: string) => ev.filter((e) => e.type === "deploy" && e.cardId === card).length;
  return {
    winner: bot.state.winner,
    endReason: bot.state.endReason,
    crowns: bot.state.crowns,
    ticks: bot.state.tick,
    commands: bot.commands.length,
    rejected: rejected(bot.state),
    netterDeploys: deploys("gale_netter"),
    breakerDeploys: deploys("riftbreaker"),
    maulerDeploys: deploys("ember_mauler"),
    shockwaves: ev.filter((e) => e.type === "shockwave").length,
    shockwaveExtraHits: ev.reduce((n, e) => n + (e.type === "shockwave" ? e.extraHits : 0), 0),
    buildingsDestroyed: ev.filter((e) => e.type === "building_removed" && e.reason === "destroyed").length,
    commanderDeploys: ev.filter((e) => e.type === "commander_deployed").length,
    abilities: ev.filter((e) => e.type === "ability_fired" && e.trigger === "active").length,
    pulses: ev.filter((e) => e.type === "pulse_active").length,
    hash: stateHash(bot.state),
    replayIdentical: stateHash(replay) === stateHash(bot.state),
  };
}
