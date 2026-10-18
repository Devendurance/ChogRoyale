// B2.6a commander balance encounters. Real engine runs driven only by legal
// deploy commands (no state surgery). Shared by commander-economy tests and
// scripts/commander-balance.ts. Pure: no DB, no network.

import { runMatch, initMatch, stepMatch, stateHash, type CombatState, type DeployCommand, type PlayerIndex } from "@/lib/combat";
import type { CommanderClass } from "@/lib/commanders";
import { deckWith, scenarioConfig, botMatch, riftSchedule, runWithAbilities } from "@/lib/arena-scenarios";

export const CLASSES: CommanderClass[] = ["bulwark", "reaver", "deadeye", "scout", "warden"];
const card = (cls: CommanderClass) => `cmdr:free-${cls}`;
const cmd = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });

function structureSummary(state: CombatState) {
  const hp = (id: string) => state.structures.find((s) => s.id === id)!.hp;
  return {
    towerL: hp("s-p1-tower-30"),
    towerR: hp("s-p1-tower-70"),
    core: hp("s-p1-core"),
    destroyed: state.events.filter((e) => e.type === "structure_destroyed").map((e) => (e.type === "structure_destroyed" ? e.entityId : "")),
  };
}

function commanderLife(state: CombatState, player: PlayerIndex) {
  const deployed = state.events.find((e) => e.type === "commander_deployed" && e.player === player)?.tick ?? null;
  const died = state.events.find((e) => e.type === "death" && e.entityId.startsWith(`c${player}-`))?.tick ?? null;
  return { deployed, died, lifetime: deployed !== null && died !== null ? died - deployed : null };
}

/** Player-commanded ability activations per ability id. */
export function abilityUses(state: CombatState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of state.events) if (e.type === "ability_fired" && e.trigger === "active") out[e.abilityId] = (out[e.abilityId] ?? 0) + 1;
  return out;
}

/** A. Unanswered commander walks the left lane against an intact arena. */
export function soloSiege(cls: CommanderClass, ticks = 1500) {
  const cfg = scenarioConfig(deckWith(card(cls)), deckWith());
  // B2.6b: the commander side presses abilities via the deterministic bot policy.
  const { state } = runWithAbilities(cfg, [cmd(1, 0, 2, card(cls), 30, 60)], ticks);
  return { cls, ...structureSummary(state), ...commanderLife(state, 0), abilities: abilityUses(state) };
}

/** C/E. Commander pushes the left lane; the defender answers with ordinary cards. */
export function defended(cls: CommanderClass, defense: string[], ticks = 900) {
  const cfg = scenarioConfig(deckWith(card(cls)), deckWith(...defense));
  const cmds: DeployCommand[] = [cmd(1, 0, 2, card(cls), 30, 60)];
  const spots: Array<[number, number]> = [[30, 104], [36, 98], [26, 98]];
  defense.forEach((c, i) => cmds.push(cmd(10 + i, 1, 30 + i * 30, c, spots[i % 3]![0], spots[i % 3]![1])));
  const { state } = runWithAbilities(cfg, cmds, ticks);
  const life = commanderLife(state, 0);
  const defenders = defense.length - state.events.filter((e) => e.type === "command_rejected").length;
  return {
    cls,
    defense: defense.join("+"),
    defenseCost: defense.reduce((n, c) => n + ({ choglings: 2, chaos_archer: 3, chog_guardian: 4, hexwing: 4, boulderback: 5, frostshell: 4, sparkcaster: 4, rift_runner: 3 } as Record<string, number>)[c]!, 0),
    deployedDefenders: defenders,
    commanderKilled: life.died !== null,
    killTick: life.died,
    // Trade quality: defender units that died before (or without) the commander dying.
    defenderLosses: state.events.filter((e) => e.type === "death" && e.owner === 1 && (life.died === null || e.tick <= life.died)).length,
    defenderUnits: state.events.filter((e) => e.type === "deploy" && e.player === 1).reduce((n, e) => n + (e.type === "deploy" ? e.entityIds.length : 0), 0),
    towerL: structureSummary(state).towerL,
    rejected: state.events.filter((e) => e.type === "command_rejected").length,
  };
}

/** D. Tank-supported commander push versus the same commander alone. */
export function supportedPush(cls: CommanderClass) {
  const deck = deckWith("boulderback", card(cls));
  const alone = runWithAbilities(scenarioConfig(deck, deckWith()), [cmd(2, 0, 142, card(cls), 30, 50)], 900);
  const push = runWithAbilities(scenarioConfig(deck, deckWith()), [cmd(1, 0, 2, "boulderback", 30, 64), cmd(2, 0, 142, card(cls), 30, 50)], 900);
  return {
    cls,
    alone: { ...structureSummary(alone.state), ...commanderLife(alone.state, 0) },
    supported: { ...structureSummary(push.state), ...commanderLife(push.state, 0) },
  };
}

/** G/H. Both players cycle full decks with bots; commanders redeploy after death. */
export function cyclingMatch(c0: CommanderClass, c1: CommanderClass, seed = "cycle") {
  const cfg = () => scenarioConfig(deckWith("chaos_archer", card(c0)), deckWith("hexwing", card(c1)), riftSchedule(seed), seed);
  const bot = botMatch(cfg(), 3100, 20);
  const a = runMatch(cfg(), bot.commands);
  const b = runMatch(cfg(), [...bot.commands].reverse());
  const ev = a.state.events;
  return {
    commands: bot.commands.length,
    rejected: ev.filter((e) => e.type === "command_rejected").length,
    commanderDeploys: ev.filter((e) => e.type === "commander_deployed").map((e) => (e.type === "commander_deployed" ? `p${e.player}@${e.tick}` : "")),
    commanderDeaths: ev.filter((e) => e.type === "death" && /^c[01]-/.test(e.entityId)).map((e) => (e.type === "death" ? `${e.entityId}@${e.tick}` : "")),
    pulses: ev.filter((e) => e.type === "pulse_active").length,
    activations: abilityUses(a.state),
    abilityRejected: ev.filter((e) => e.type === "command_rejected" && e.abilityId !== undefined).length,
    result: a.result,
    replayIdentical: a.result.stateHash === b.result.stateHash && JSON.stringify(a.state.events) === JSON.stringify(b.state.events),
    steppedHash: stateHash(bot.state),
  };
}

/** E. Round robin: identical bot decks except the commander, both seats. */
export function roundRobin(seeds = ["rr-1", "rr-2"]) {
  const wins: Record<CommanderClass, number> = { bulwark: 0, reaver: 0, deadeye: 0, scout: 0, warden: 0 };
  const games: Record<CommanderClass, number> = { bulwark: 0, reaver: 0, deadeye: 0, scout: 0, warden: 0 };
  const table: string[] = [];
  const activations: Record<string, number> = {};
  let ticks = 0;
  for (const a of CLASSES) {
    for (const b of CLASSES) {
      if (a === b) continue;
      for (const seed of seeds) {
        const cfg = scenarioConfig(deckWith("chaos_archer", card(a)), deckWith("chaos_archer", card(b)), null, `${seed}-${a}-${b}`);
        const { state } = botMatch(cfg, 3100, 20);
        for (const [id, n] of Object.entries(abilityUses(state))) activations[id] = (activations[id] ?? 0) + n;
        ticks += state.tick;
        games[a] += 1;
        games[b] += 1;
        if (state.winner === 0) wins[a] += 1;
        if (state.winner === 1) wins[b] += 1;
        table.push(`${a} v ${b} ${seed}: ${state.winner} ${state.endReason} ${state.crowns.join("-")} @${state.tick}`);
      }
    }
  }
  return { wins, games, table, activations, avgTicks: Math.round(ticks / table.length) };
}

/** Energy/hand gate: the commander card must be in hand and affordable. */
export function deployGate(cls: CommanderClass) {
  const inQueue = scenarioConfig(deckWith(), deckWith());
  const s = initMatch(inQueue);
  stepMatch(s, [cmd(1, 0, 1, card("bulwark"), 30, 60)]);
  const notInHand = s.events.find((e) => e.type === "command_rejected")?.type === "command_rejected";
  const inHand = initMatch(scenarioConfig(deckWith(card(cls)), deckWith()));
  stepMatch(inHand, [cmd(1, 0, 1, "chog_guardian", 30, 60), cmd(2, 0, 1, card(cls), 30, 64)]);
  const rej = inHand.events.filter((e) => e.type === "command_rejected").map((e) => (e.type === "command_rejected" ? e.reason : ""));
  return { notInHand, afterSpendRejected: rej };
}
