// Headless 1v1 match runner (development harness only).
// Two bot players read the real hand/energy/board each decision (botMove),
// authored v1 decks, optional commanders and a real B1.4b chaos schedule
// derived from actual Genesis metadata (read-only). Prints the battle
// summary and state hash. Never writes to any database.
// Usage: npm run combat:run [-- --seed <s> --every <ticks> --commanders <class|nft:<tokenId>,class|nft:<tokenId>> --chaosPatron <tokenId>]
// Commanders default to free-warden,free-reaver. `nft:<tokenId>` derives the
// commander from real Genesis metadata via B1 deriveCommander (read-only).
import "dotenv/config";
import { runMatch, COMBAT_RULESET_VERSION, TROOP_CARDS_V1, SPELL_CARDS_V1, COMMANDER_COMBAT_PROFILE_V1, freeStarterSlot, commanderCardId, isCommanderCard, type CombatConfig, type CommanderSlotInput } from "@/lib/combat";
import { botMatch } from "@/lib/arena-scenarios";
import { deriveCommander, COMMANDER_CLASSES, type CommanderClass } from "@/lib/commanders";
import { derivePatronConfig } from "@/lib/patrons";
import { deriveChaosSchedule } from "@/lib/chaos";
import { getNftByTokenId } from "@/db/nfts";

const ORDINARY: [string[], string[]] = [
  ["choglings", "chaos_archer", "chaos_bolt", "rally_horn", "boulderback", "frostshell", "rift_runner"],
  ["boulderback", "frostshell", "choglings", "chaos_archer", "chog_guardian", "hexwing", "sparkcaster"],
];

async function slotFor(arg: string): Promise<CommanderSlotInput> {
  if (arg.startsWith("nft:")) {
    const tokenId = arg.slice(4);
    const nft = await getNftByTokenId(tokenId);
    if (!nft?.metadata || nft.metadata.status !== "resolved") throw new Error(`No resolved metadata for ${tokenId}`);
    const definition = deriveCommander({ attributes: (nft.metadata.attributesOriginal ?? []) as Array<{ trait_type: string; value: string | number }> });
    return { commanderId: `nft-${tokenId}`, definition };
  }
  const cls = arg.replace(/^free-/, "") as CommanderClass;
  if (!(COMMANDER_CLASSES as readonly string[]).includes(cls)) throw new Error(`Unknown commander class: ${arg}`);
  return freeStarterSlot(cls);
}

async function main() {
  const args = process.argv.slice(2);
  const seedIdx = args.indexOf("--seed");
  const seed = seedIdx >= 0 ? (args[seedIdx + 1] ?? "dev-1") : "dev-1";
  const cmdIdx = args.indexOf("--commanders");
  const cmdArg = cmdIdx >= 0 ? (args[cmdIdx + 1] ?? "") : "warden,reaver";
  const chaosIdx = args.indexOf("--chaosPatron");
  const chaosToken = chaosIdx >= 0 ? (args[chaosIdx + 1] ?? "") : "";
  const [a0, a1] = cmdArg.split(",");
  const slots: [CommanderSlotInput, CommanderSlotInput] = [await slotFor(a0 ?? "warden"), await slotFor(a1 ?? "reaver")];
  // Commander card sits 5th in each deck (starts in the queue, drawn by cycling).
  const deckOf = (p: 0 | 1) => [...ORDINARY[p].slice(0, 4), commanderCardId(slots[p].commanderId), ...ORDINARY[p].slice(4)];
  const config: CombatConfig = { rulesetVersion: COMBAT_RULESET_VERSION, seed, decks: [deckOf(0), deckOf(1)], commanders: slots };
  const cardCost = (id: string, p: 0 | 1) =>
    isCommanderCard(id) ? COMMANDER_COMBAT_PROFILE_V1[slots[p].definition.class].cost : (TROOP_CARDS_V1[id]?.cost ?? SPELL_CARDS_V1[id]?.cost ?? 99);
  if (chaosToken) {
    const nft = await getNftByTokenId(chaosToken);
    if (!nft?.metadata || nft.metadata.status !== "resolved") throw new Error(`No resolved metadata for ${chaosToken}`);
    const patron = derivePatronConfig({
      tokenId: chaosToken,
      attributes: (nft.metadata.attributesOriginal ?? null) as Array<{ trait_type: string; value: string | number }> | null,
      metadataContentHash: nft.metadata.contentHash,
      name: nft.metadata.name,
    });
    config.chaos = deriveChaosSchedule({ patron, serverSeed: `dev-${seed}`, matchKey: `dev-${seed}` });
  }
  // Deterministic bot play from the REAL engine state: every 2s each side
  // submits the first card in its actual hand that is affordable and has a
  // legal placement (botMove). The recorded commands are then replayed
  // through runMatch (forward and shuffled) for the canonical result.
  const every = Math.max(5, Number(args[args.indexOf("--every") + 1]) || 20);
  const bot = botMatch(config, 3100, every);
  const { state, result } = runMatch(config, bot.commands);
  const shuffled = runMatch(config, [...bot.commands].reverse());
  const ev = state.events;
  const count = <T extends string>(list: T[]) => list.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const lane = (x: number) => (x < 50 ? "left" : x > 50 ? "right" : "center");
  const troopCmds = bot.commands.filter((c) => TROOP_CARDS_V1[c.cardId]);
  console.log(
    JSON.stringify(
      {
        seed,
        every,
        commands: bot.commands.length,
        deploys: ev.filter((e) => e.type === "deploy").length,
        spells: ev.filter((e) => e.type === "spell_cast").length,
        rejected: ev.filter((e) => e.type === "command_rejected"),
        commanderSnapshots: slots.map((s) => ({ id: s.commanderId, class: s.definition.class, variant: s.definition.variant, prestige: s.definition.prestige })),
        energySpent: ([0, 1] as const).map((p) => bot.commands.filter((c) => c.player === p).reduce((n, c) => n + cardCost(c.cardId, p), 0)),
        cardsPlayed: count(bot.commands.map((c) => `p${c.player}:${c.cardId}`)),
        lanes: count(troopCmds.map((c) => `p${c.player}:${lane(c.x)}`)),
        commanders: {
          deployed: ev.filter((e) => e.type === "commander_deployed").map((e) => (e.type === "commander_deployed" ? `p${e.player}:${e.class}@${e.tick}` : "")),
          abilitiesFired: ev.filter((e) => e.type === "ability_fired").length,
          deaths: ev.filter((e) => e.type === "death" && e.entityId.startsWith("c")).map((e) => (e.type === "death" ? `${e.entityId}@${e.tick}` : "")),
        },
        chaos: count(ev.filter((e) => e.type === "pulse_active" || e.type === "rift_crossing").map((e) => (e.type === "pulse_active" ? e.family : `rift_${e.type === "rift_crossing" && e.open ? "open" : "close"}`))),
        towersDestroyed: ev.filter((e) => e.type === "structure_destroyed").map((e) => (e.type === "structure_destroyed" ? `${e.entityId}@${e.tick}` : "")),
        troopDeaths: ev.filter((e) => e.type === "death").length,
        replayIdentical: shuffled.result.stateHash === result.stateHash,
        ...result,
      },
      null,
      1
    )
  );
}

main().catch((err) => {
  console.error("COMBAT_RUN_FATAL", String(err).slice(0, 200));
  process.exit(1);
});
