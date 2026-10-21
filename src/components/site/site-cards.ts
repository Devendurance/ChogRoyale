import { BUILDING_CARDS_V1, CARDS_V1, SPELL_CARDS_V1, TROOP_CARDS_V1 } from "@/lib/combat";

// Card display data for the public carousel. Names, costs and traits are read
// from the live v16 card tables so the site never drifts from the game.
// Art is the approved READY_STATIC presentation-kit v001 source for each card.

export interface SiteCard {
  id: string;
  name: string;
  cost: number;
  type: string;
  traits: string[];
  art: { src: string; width: number; height: number };
}

// Hand-picked spread: four troops (one flying), a building and a spell.
const SHOWCASE: Array<{ id: string; width: number; height: number }> = [
  { id: "chaos_archer", width: 330, height: 369 },
  { id: "boulderback", width: 374, height: 526 },
  { id: "hexwing", width: 401, height: 329 },
  { id: "frostshell", width: 349, height: 429 },
  { id: "rift_sentry", width: 287, height: 297 },
  { id: "chaos_comet", width: 280, height: 253 },
];

function describe(id: string): Pick<SiteCard, "type" | "traits"> {
  const troop = TROOP_CARDS_V1[id];
  if (troop) {
    const traits: string[] = [];
    if (troop.count > 1) traits.push(`${troop.count} units`);
    if (troop.hitsAir) traits.push("Hits air");
    if (troop.splashRadius > 0) traits.push("Splash");
    if (troop.structPriority) traits.push("Targets structures");
    if (troop.slowPct > 0) traits.push("Slows");
    return { type: troop.moveType === "air" ? "Air troop" : "Troop", traits: traits.slice(0, 2) };
  }
  const building = BUILDING_CARDS_V1[id];
  if (building) {
    const traits: string[] = [];
    if (building.damage > 0) traits.push(building.hitsAir ? "Hits air" : "Ground targets");
    traits.push("Timed");
    return { type: "Building", traits: traits.slice(0, 2) };
  }
  const spell = SPELL_CARDS_V1[id];
  if (spell) {
    const traits = ["Area"];
    if (spell.impact?.delayTicks) traits.push("Delayed impact");
    else if (spell.impact?.slowPct) traits.push("Slows");
    return { type: "Spell", traits };
  }
  throw new Error(`Unknown showcase card ${id}`);
}

export function showcaseCards(): SiteCard[] {
  return SHOWCASE.map(({ id, width, height }) => ({
    id,
    name: CARDS_V1[id]!.name,
    cost: CARDS_V1[id]!.cost,
    ...describe(id),
    art: { src: `/assets/site/cards/${id}.png`, width, height },
  }));
}

export function rosterCounts() {
  return {
    total: Object.keys(CARDS_V1).length,
    troops: Object.keys(TROOP_CARDS_V1).length,
    buildings: Object.keys(BUILDING_CARDS_V1).length,
    spells: Object.keys(SPELL_CARDS_V1).length,
  };
}
