// Server-side lobby catalog (A1).
//
// The lobby view is a client component, so the real card and commander
// definitions are resolved once on the server and handed down as plain data.
// Nothing here is hand-written game design: names, costs, roles, abilities
// and traits are read from the live ruleset tables.

import {
  BUILDING_CARDS_V1,
  CARDS_V1,
  COMMANDER_COMBAT_PROFILE_V1,
  SPELL_CARDS_V1,
  TROOP_CARDS_V1,
} from "@/lib/combat";
import {
  CLASS_ROSTER,
  COMMANDER_CLASSES,
  freeCommanderTemplates,
  type CommanderClass,
} from "@/lib/commanders";
import type {
  LobbyArt,
  LobbyCatalog,
  LobbyCatalogCard,
  LobbyCatalogCommander,
} from "@/components/app/lobby-types";

// Shared commander class art. Every commander of a class uses the same
// picture, so it is never presented as a specific NFT.
const CLASS_ART: Record<CommanderClass, LobbyArt> = {
  bulwark: { src: "/assets/site/commanders/bulwark.png", width: 531, height: 690 },
  reaver: { src: "/assets/site/mascots/reaver-commander-class.png", width: 547, height: 634 },
  deadeye: { src: "/assets/site/commanders/deadeye.png", width: 569, height: 628 },
  scout: { src: "/assets/site/commanders/scout.png", width: 472, height: 665 },
  warden: { src: "/assets/site/commanders/warden.png", width: 533, height: 690 },
};

// Cards with dedicated public card art. Every other card falls back to the
// approved presentation kit, which is the same character set at game size.
const SITE_CARD_ART: Record<string, LobbyArt> = {
  boulderback: { src: "/assets/site/cards/boulderback.png", width: 374, height: 526 },
  chaos_archer: { src: "/assets/site/cards/chaos_archer.png", width: 330, height: 369 },
  chaos_comet: { src: "/assets/site/cards/chaos_comet.png", width: 280, height: 253 },
  frostshell: { src: "/assets/site/cards/frostshell.png", width: 349, height: 429 },
  hexwing: { src: "/assets/site/cards/hexwing.png", width: 401, height: 329 },
  rift_sentry: { src: "/assets/site/cards/rift_sentry.png", width: 287, height: 297 },
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cardArt(id: string): LobbyArt {
  const site = SITE_CARD_ART[id];
  if (site) return site;
  if (TROOP_CARDS_V1[id]) {
    return { src: `/assets/chog-kit/v001/troops/${id}/sprite.png`, width: 192, height: 256 };
  }
  if (BUILDING_CARDS_V1[id] || SPELL_CARDS_V1[id]) {
    const folder = BUILDING_CARDS_V1[id] ? "structures" : "spells";
    return { src: `/assets/chog-kit/v001/${folder}/${id}/sprite.png`, width: 256, height: 256 };
  }
  return { src: `/assets/chog-kit/v001/cards/derivatives/${id}/portrait.png`, width: 256, height: 256 };
}

function cardKind(id: string): LobbyCatalogCard["kind"] {
  if (TROOP_CARDS_V1[id]) return "troop";
  if (SPELL_CARDS_V1[id]) return "spell";
  return "building";
}

/** Type label and traits read from the authored card definition. */
function describeCard(id: string): { typeLabel: string; traits: string[] } {
  const troop = TROOP_CARDS_V1[id];
  if (troop) {
    const traits: string[] = [];
    if (troop.count > 1) traits.push(`${troop.count} units`);
    if (troop.hitsAir) traits.push("Hits air");
    if (troop.splashRadius > 0) traits.push("Splash");
    if (troop.structPriority) traits.push("Targets structures");
    if (troop.slowPct > 0) traits.push("Slows");
    return { typeLabel: troop.moveType === "air" ? "Air troop" : "Troop", traits: traits.slice(0, 2) };
  }
  const building = BUILDING_CARDS_V1[id];
  if (building) {
    const traits = [building.damage > 0 ? (building.hitsAir ? "Hits air" : "Ground targets") : "No attack", "Timed"];
    return { typeLabel: "Building", traits };
  }
  const spell = SPELL_CARDS_V1[id];
  if (spell) {
    const traits = ["Area"];
    if (spell.impact?.delayTicks) traits.push("Delayed impact");
    else if (spell.impact?.slowPct) traits.push("Slows");
    return { typeLabel: "Spell", traits };
  }
  return { typeLabel: "Card", traits: [] };
}

/**
 * The real card roster and commander class roster, flattened into the plain
 * shape the lobby view consumes.
 */
export function buildLobbyCatalog(): LobbyCatalog {
  const cards: Record<string, LobbyCatalogCard> = {};
  for (const id of Object.keys(CARDS_V1)) {
    const def = CARDS_V1[id]!;
    const { typeLabel, traits } = describeCard(id);
    cards[id] = {
      id,
      name: def.name,
      cost: def.cost,
      kind: cardKind(id),
      typeLabel,
      traits,
      art: cardArt(id),
    };
  }

  const freeByClass = new Map(freeCommanderTemplates().map((t) => [t.class, t]));

  const commanders: LobbyCatalogCommander[] = COMMANDER_CLASSES.map((classId) => {
    const profile = CLASS_ROSTER[classId];
    const art = CLASS_ART[classId];
    const active = profile.abilities.find((a) => a.trigger === "active");
    return {
      classId,
      className: titleCase(classId),
      roleShort: profile.role.split(" / ")[0]!.split(".")[0]!.trim(),
      role: profile.role,
      cost: COMMANDER_COMBAT_PROFILE_V1[classId].cost,
      ability: active?.name ?? null,
      counters: profile.counters.map((c) => titleCase(c)),
      freeName: freeByClass.get(classId)?.name ?? titleCase(classId),
      art,
      sprite: { src: `/assets/chog-kit/v001/commanders/commander_${classId}/sprite.png`, width: 192, height: 256 },
      commanderCardArt: {
        src: `/assets/chog-kit/v001/cards/derivatives/commander_${classId}/portrait.png`,
        width: 256,
        height: 256,
      },
    };
  });

  return { cards, commanders };
}
