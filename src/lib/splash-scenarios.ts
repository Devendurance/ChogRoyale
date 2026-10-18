// B2.7c2 Ember Mauler scenarios (ground melee shockwave). Real engine runs
// from legal commands only; every outcome is read from the engine. Each
// encounter is measured at its decisive tick (last swarm death, Mauler
// death), because afterwards survivors walk on into towers. Pure.

import { initMatch, stepMatch, type CombatConfig, type CombatState, type DeployCommand, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, deckWith } from "@/lib/arena-scenarios";
import { d, towerHp, deathTicks, hpLeft, buildingEnd, buildingHp, rejected, run, rosterBotMatch } from "@/lib/roster-scenarios";

const P1_LEFT = "s-p1-tower-30";
const alive = (s: CombatState, card: string, owner: PlayerIndex) => s.troops.filter((t) => t.cardId === card && t.owner === owner && t.hp > 0).length;
const waveStats = (s: CombatState, owner: PlayerIndex) => {
  const w = s.events.flatMap((e) => (e.type === "shockwave" && e.owner === owner ? [e.extraHits] : []));
  return { swings: w.length, extraHits: w.reduce((a, b) => a + b, 0), maxExtra: Math.max(0, ...w), multiHitSwings: w.filter((x) => x > 0).length };
};

/**
 * Real stepper with an optional per-tick command source (reads state at T,
 * plays at T+1). Also counts, at every Mauler swing, the living enemy AIR
 * units within its shockwave radius (they must never be hit).
 */
function stepRun(cfg: CombatConfig, fixed: DeployCommand[], upto: number, dyn?: (s: CombatState) => DeployCommand[]) {
  const s = initMatch(cfg);
  let airInWave = 0;
  let seen = 0;
  while (s.phase !== "final" && s.tick < upto) {
    stepMatch(s, [...fixed.filter((c) => c.tick === s.tick + 1), ...(dyn ? dyn(s) : [])]);
    for (const e of s.events.slice(seen)) {
      if (e.type !== "shockwave") continue;
      const m = s.troops.find((t) => t.id === e.entityId) ?? null;
      if (m) airInWave += s.troops.filter((t) => t.owner !== e.owner && t.hp > 0 && t.moveType === "air" && (t.x - m.x) ** 2 + (t.y - m.y) ** 2 <= 16).length;
    }
    seen = s.events.length;
  }
  return { s, airInWave };
}

/** P0 defender (Mauler or Guardian, both 4e) at the left tower vs P1 ground swarm; measured at the last swarm death. */
function vsSwarm(defender: string, attack: DeployCommand[], swarm: string[], p1Hand: string[]) {
  const cfg = () => scenarioConfig(deckWith(defender), deckWith(...p1Hand));
  const cmds = [d(1, 0, 5, defender, 30, 52), ...attack];
  const full = run(cfg(), cmds, 300);
  const swarmDeaths = swarm.flatMap((c) => deathTicks(full, c, 1)).sort((a, b) => a - b);
  const swarmUnits = swarm.reduce((n, c) => n + full.events.filter((e) => e.type === "deploy" && e.player === 1 && e.cardId === c).reduce((k, e) => k + (e.type === "deploy" ? e.entityIds.length : 0), 0), 0);
  const cleared = swarmDeaths.length === swarmUnits ? swarmDeaths.at(-1)! : null;
  const s = run(cfg(), cmds, cleared ?? 300);
  return {
    swarmUnits,
    killed: swarmDeaths.length,
    clearedAt: cleared,
    defenderHpAtClear: hpLeft(s, defender, 0),
    defenderDeath: deathTicks(s, defender, 0)[0] ?? null,
    towerHp: towerHp(s),
    waves: waveStats(s, 0),
    extraPerSwing: (() => {
      const w = waveStats(s, 0);
      return w.swings ? Math.round((w.extraHits / w.swings) * 100) / 100 : 0;
    })(),
    rejected: rejected(s),
  };
}

/**
 * A. Choglings alone. B. Clustered cheap push: Choglings + Chaos Archers
 * deployed together (5e, 5 ground units). C. Spread: the same two cards
 * with the Archers held back to tick 85. Weakness: a tank-led push
 * (Guardian, Choglings at tick 33). The defender is the only variable.
 */
export function maulerVsSwarm() {
  const chog = (tick: number) => d(2, 1, tick, "choglings", 30, 100);
  const archers = (tick: number) => d(3, 1, tick, "chaos_archer", 31, 100);
  const both = (attack: DeployCommand[], swarm: string[], p1: string[]) => ({ mauler: vsSwarm("ember_mauler", attack, swarm, p1), guardian: vsSwarm("chog_guardian", attack, swarm, p1) });
  const cheap = ["choglings", "chaos_archer"];
  const tank = ["chog_guardian", "choglings"];
  return {
    choglings: both([chog(5)], ["choglings"], cheap),
    clustered: both([chog(5), archers(5)], cheap, cheap),
    spread: both([chog(5), archers(85)], cheap, cheap),
    tankLed: both([d(3, 1, 5, "chog_guardian", 30, 100), chog(33)], tank, tank),
  };
}

/** P1 Mauler pushes P0's left tower; P0 answers at tick 40. Measured at the Mauler's death. */
function vsAnswer(answer: string | null) {
  const cfg = () => scenarioConfig(deckWith(answer ?? "choglings"), deckWith("ember_mauler"));
  const cmds = [d(1, 1, 5, "ember_mauler", 30, 100), ...(answer ? [d(2, 0, 40, answer, 30, 50)] : [])];
  const death = deathTicks(run(cfg(), cmds, 400), "ember_mauler", 1)[0] ?? null;
  const { s, airInWave } = stepRun(cfg(), cmds, death ?? 400);
  return {
    maulerDeath: death,
    towerHp: towerHp(s),
    answerUnitsLost: answer ? deathTicks(s, answer, 0).length : 0,
    answerAlive: answer ? alive(s, answer, 0) : 0,
    answerHp: answer ? hpLeft(s, answer, 0) : 0,
    maulerWaves: waveStats(s, 1),
    airInWave,
  };
}

/** D. Flyers punish an unsupported Mauler. E. Ranged answers, against 2e Choglings it shreds. */
export function maulerCounters() {
  return { none: vsAnswer(null), hexwing: vsAnswer("hexwing"), rift_sprites: vsAnswer("rift_sprites"), chaos_archer: vsAnswer("chaos_archer"), sparkcaster: vsAnswer("sparkcaster"), choglings: vsAnswer("choglings") };
}

/**
 * F. P0 Mauler pushes P1's left lane; a P1 Guardian meets it on the bridge
 * and tanks. With support, P1 adds Chaos Archers at tick 62 (first tick it
 * can afford them) on its own bank, outside the shockwave. Measured at the
 * Mauler's death.
 */
export function tankAndRanged() {
  const one = (support: boolean) => {
    const cfg = () => scenarioConfig(deckWith("ember_mauler"), deckWith("chog_guardian", "chaos_archer"));
    const cmds = [d(1, 0, 5, "ember_mauler", 30, 60), d(2, 1, 5, "chog_guardian", 30, 104), ...(support ? [d(3, 1, 62, "chaos_archer", 30, 92)] : [])];
    const death = deathTicks(run(cfg(), cmds, 400), "ember_mauler", 0)[0] ?? null;
    const s = run(cfg(), cmds, death ?? 400);
    return { maulerDeath: death, archersLost: deathTicks(s, "chaos_archer", 1).length, guardianHp: hpLeft(s, "chog_guardian", 1), towerHp: towerHp(s, P1_LEFT), maulerWaves: waveStats(s, 0), rejected: rejected(s) };
  };
  return { tankOnly: one(false), tankPlusArchers: one(true) };
}

/** G. Open-ground 1v1 near the left bridge: Mauler (4e) vs Guardian (4e) and vs Boulderback (5e). */
export function maulerDuel() {
  const one = (p1: string) => {
    const cfg = () => scenarioConfig(deckWith("ember_mauler"), deckWith(p1));
    const cmds = [d(1, 0, 5, "ember_mauler", 30, 66), d(2, 1, 5, p1, 30, 94)];
    const full = run(cfg(), cmds, 300);
    const first = full.events.find((e) => e.type === "death");
    const at = first?.tick ?? 300;
    const s = run(cfg(), cmds, at);
    return { loser: first && first.type === "death" ? (first.owner === 0 ? "ember_mauler" : p1) : null, tick: first?.tick ?? null, maulerHp: hpLeft(s, "ember_mauler", 0), opponentHp: hpLeft(s, p1, 1) };
  };
  return { vsGuardian: one("chog_guardian"), vsBoulderback: one("boulderback") };
}

/**
 * H. Structures, buildings and commanders. A Mauler on a Totem with
 * Choglings beside it (only the primary building takes damage), a Mauler on
 * a bare tower, and a Mauler vs an enemy ground commander with Rift Sprites
 * flying over the fight (air never takes shockwave damage).
 */
export function maulerTargets() {
  const totem = stepRun(scenarioConfig(deckWith("decoy_totem", "choglings"), deckWith("ember_mauler")), [d(1, 0, 2, "decoy_totem", 30, 56), d(2, 1, 5, "ember_mauler", 30, 100), d(3, 0, 60, "choglings", 30, 52)], 160).s;
  const tower = run(scenarioConfig(deckWith(), deckWith("ember_mauler")), [d(1, 1, 5, "ember_mauler", 30, 100)], 400);
  const cmd = stepRun(scenarioConfig(deckWith("ember_mauler"), deckWith("cmdr:free-bulwark", "rift_sprites")), [d(1, 0, 5, "ember_mauler", 30, 66), d(2, 1, 5, "cmdr:free-bulwark", 30, 94), d(3, 1, 60, "rift_sprites", 30, 94)], 100);
  const cmdr = cmd.s.commanders.find((c) => c.owner === 1);
  return {
    totem: { end: buildingEnd(totem, "decoy_totem"), hp: buildingHp(totem, "decoy_totem"), waves: waveStats(totem, 1), choglingsKilled: deathTicks(totem, "choglings", 0).length, rejected: rejected(totem) },
    tower: { towerHp: towerHp(tower), damageMultipleOf24: (600 - towerHp(tower)) % 24 === 0, waves: waveStats(tower, 1) },
    commander: { hp: cmdr?.hp ?? 0, maxHp: cmdr?.maxHp ?? 0, waves: waveStats(cmd.s, 0), airInWave: cmd.airInWave, spritesHp: hpLeft(cmd.s, "rift_sprites", 1), rejected: rejected(cmd.s) },
  };
}

/** I/J/K. Bot match: anti-swarm Mauler deck vs a cheap swarm deck that also carries a Mauler, with commanders and Chaos. */
export const MAULER_DECKS: [string[], string[]] = [
  deckWith("ember_mauler", "chaos_archer", "rift_sentry", "rift_snare", "hexwing", "chog_guardian", "chaos_comet", "cmdr:free-warden"),
  deckWith("choglings", "rift_sprites", "rift_snare", "rift_runner", "chaos_archer", "ember_mauler", "sparkcaster", "cmdr:free-scout"),
];
export const maulerBotMatch = (seed = "b27c2") => rosterBotMatch(seed, MAULER_DECKS);
