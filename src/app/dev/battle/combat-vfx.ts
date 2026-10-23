import type { FrameEvent } from "@/lib/battle-protocol";

const EVENT_ID_FIELDS = [
  "eventId",
  "impactId",
  "entityId",
  "structureId",
  "buildingId",
  "troopId",
  "commanderId",
  "abilityId",
  "cardId",
  "x",
  "y",
  "entityIds",
] as const;

/** Stable identity for one authoritative event across repeated snapshots. */
export const combatEventKey = (event: FrameEvent): string => {
  const identity = EVENT_ID_FIELDS
    .filter((field) => event[field] !== undefined)
    .map((field) => `${field}=${JSON.stringify(event[field])}`)
    .join("|");
  return `${event.type}:${event.tick}:${identity}`;
};

export const chaosFamilyColor = (family: string): number =>
  ({
    ember_rift: 0xf97316,
    frost_crossing: 0x67e8f9,
    energy_surge: 0xfacc15,
    rift_shift: 0xa855f7,
    chaos_rally: 0x22c55e,
  })[family] ?? 0xffffff;
