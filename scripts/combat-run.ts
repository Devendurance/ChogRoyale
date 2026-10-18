// Headless 1v1 match runner (development harness only).
// Two bot players read the real hand/energy/board each decision (botMove),
// authored v1 decks, optional commanders and a real B1.4b chaos schedule
// derived from actual Genesis metadata (read-only). Prints the battle
// summary and state hash. Never writes to any database.
// Usage: npm run combat:run [-- --seed <s> --every <ticks> --commanders <class|free-class,class|free-class> --chaosPatron <tokenId>]
import "dotenv/config";
import { runMatch, COMBAT_RULESET_VERSION, TROOP_CARDS_V1, SPELL_CARDS_V1, type CombatConfig } from "@/lib/combat";
import { botMatch } from "@/lib/arena-scenarios";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import { derivePatronConfig } from "@/lib/patrons";
import { deriveChaosSchedule } from "@/lib/chaos";
import { getNftByTokenId } from "@/db/nfts";

const DECKS: [string[], string[]] = [
  ["choglings", "chaos_archer", "chaos_bolt", "rally_horn", "boulderback", "frostshell", "rift_runner", "sparkcaster"],
  ["boulderback", "frostshell", "choglings", "chaos_archer", "chog_guardian", "hexwing", "rift_runner", "sparkcaster"],
];

function cardCost(id: string): number {
  return TROOP_CARDS_V1[id]?.cost ?? SPELL_CARDS_V1[id]?.cost ?? 99;
}

async function main() {
  const args = process.argv.slice(2);
  const seedIdx = args.indexOf("--seed");
  const seed = seedIdx >= 0 ? (args[seedIdx + 1] ?? "dev-1") : "dev-1";
  const cmdIdx = args.indexOf("--commanders");
  const cmdArg = cmdIdx >= 0 ? (args[cmdIdx + 1] ?? "") : "";
  const chaosIdx = args.indexOf("--chaosPatron");
  const chaosToken = chaosIdx >= 0 ? (args[chaosIdx + 1] ?? "") : "";
  const config: CombatConfig = { rulesetVersion: COMBAT_RULESET_VERSION, seed, decks: DECKS };
  if (cmdArg) {
    const [c0, c1] = cmdArg.split(",");
    const templates = freeCommanderTemplates();
    const toSlot = (c: string | undefined, tag: string) => {
      if (!c) return null;
      const cls = c.replace(/^free-/, "") as CommanderClass;
      const t = templates.find((x) => x.class === cls);
      if (!t) throw new Error(`Unknown commander class: ${c}`);
      return {
        commanderId: `dev-${tag}-${t.id}`,
        definition: {
          rulesetVersion: "v1" as const,
          class: t.class,
          affinity: t.class,
          scores: {} as Record<CommanderClass, number>,
          signals: [],
          unmatchedTraits: [],
          stats: t.stats,
          abilities: t.abilities,
          variant: "dev",
          prestige: "Common",
          powerScore: t.powerScore,
          derivationHash: `dev-${tag}`,
        },
      };
    };
    config.commanders = [toSlot(c0, "p0"), toSlot(c1, "p1")];
  }
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
        energySpent: [0, 1].map((p) => bot.commands.filter((c) => c.player === p).reduce((n, c) => n + cardCost(c.cardId), 0)),
        cardsPlayed: count(bot.commands.map((c) => `p${c.player}:${c.cardId}`)),
        lanes: count(troopCmds.map((c) => `p${c.player}:${lane(c.x)}`)),
        commanders: {
          deployed: ev.filter((e) => e.type === "commander_deployed").length,
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
