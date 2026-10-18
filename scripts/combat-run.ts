// Headless 1v1 match runner (development harness only).
// Two synthetic players, authored v1 decks, deterministic seed-derived
// deployment orders, optional commanders and a real B1.4b chaos schedule
// derived from actual Genesis metadata (read-only). Prints the battle
// summary and state hash. Never writes to any database.
// Usage: npm run combat:run [-- --seed <s> --commanders <class|free-class,class|free-class> --chaosPatron <tokenId>]
import "dotenv/config";
import { createHash } from "crypto";
import { initMatch, runMatch, COMBAT_RULESET_VERSION, TROOP_CARDS_V1, SPELL_CARDS_V1, type CombatConfig, type DeployCommand } from "@/lib/combat";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import { derivePatronConfig } from "@/lib/patrons";
import { deriveChaosSchedule } from "@/lib/chaos";
import { getNftByTokenId } from "@/db/nfts";

function hashInt(tag: string, seed: string, n: number, modulo: number): number {
  const digest = createHash("sha256").update(`${tag}:${seed}:${n}`).digest("hex");
  return Number(BigInt(`0x${digest}`) % BigInt(modulo));
}

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
  // Deterministic synthetic play: each side deploys a rotating affordable
  // card every ~4 seconds at a seeded lane position. The harness (not the
  // engine) may use seeded selection; the engine itself stays seed-free
  // apart from the recorded match seed.
  const probe = initMatch(config);
  void probe;
  const commands: DeployCommand[] = [];
  let seq = 0;
  const hands: [string[], string[]] = [DECKS[0].slice(0, 4), DECKS[1].slice(0, 4)];
  const energy = [5, 5];
  for (let t = 10; t < 1750; t += 40) {
    for (const p of [0, 1] as const) {
      energy[p] = Math.min(10, energy[p] + 1);
      const affordable = hands[p].filter((c) => cardCost(c) <= energy[p]);
      if (affordable.length === 0) continue;
      const card = affordable[hashInt("card", seed, t + p, affordable.length)] as string;
      energy[p] -= cardCost(card);
      hands[p] = [...hands[p].filter((c) => c !== card), card];
      seq += 1;
      const isBolt = card === "chaos_bolt";
      const isHorn = card === "rally_horn";
      commands.push({
        seq,
        player: p,
        tick: t + p * 3,
        cardId: card,
        x: isBolt ? 50 : 20 + hashInt("lane", seed, seq, 61),
        y: isBolt ? 80 : isHorn ? (p === 0 ? 60 : 100) : p === 0 ? 30 + hashInt("depth", seed, seq, 40) : 90 + hashInt("depth", seed, seq, 40),
      });
    }
  }
  const { result } = runMatch(config, commands);
  console.log(JSON.stringify({ seed, commands: commands.length, ...result }, null, 1));
}

main().catch((err) => {
  console.error("COMBAT_RUN_FATAL", String(err).slice(0, 200));
  process.exit(1);
});
