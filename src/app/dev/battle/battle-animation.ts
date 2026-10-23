import type { BattleFrame, FrameEvent } from "@/lib/battle-protocol";
import { combatEventKey } from "./combat-vfx";

export type BattleAnimationKind = "spawn" | "attack" | "hit" | "death";

export interface BattleAnimationCue {
  key: string;
  kind: BattleAnimationKind;
  entityId: string;
  targetId?: string;
}

type EntityPoint = { id: string; x: number; y: number; hp?: number };

const entitiesIn = (frame: BattleFrame | null): EntityPoint[] =>
  frame
    ? ([...frame.troops, ...frame.commanders, ...frame.buildings, ...frame.structures] as EntityPoint[])
    : [];

const entityById = (frame: BattleFrame | null): Map<string, EntityPoint> =>
  new Map(entitiesIn(frame).map((entity) => [entity.id, entity]));

const eventEntityIds = (event: FrameEvent): string[] => {
  const ids = event.entityIds;
  return Array.isArray(ids) ? ids.map(String) : [];
};
const eventCue = (event: FrameEvent): BattleAnimationCue[] => {
  const key = combatEventKey(event);
  switch (event.type) {
    case "deploy":
      return eventEntityIds(event).map((entityId, index) => ({
        key: `${key}:spawn:${entityId}:${index}`,
        kind: "spawn",
        entityId,
      }));
    case "commander_deployed":
      return [{ key: `${key}:spawn:${String(event.commanderId)}`, kind: "spawn", entityId: String(event.commanderId) }];
    case "building_spawned":
      return [{ key: `${key}:spawn:${String(event.buildingId)}`, kind: "spawn", entityId: String(event.buildingId) }];
    case "unit_spawned":
      return [{ key: `${key}:spawn:${String(event.troopId)}`, kind: "spawn", entityId: String(event.troopId) }];
    case "tower_fired":
    case "siege_fired":
    case "shockwave":
      return [{
        key: `${key}:attack:${String(event.structureId ?? event.buildingId ?? event.entityId)}`,
        kind: "attack",
        entityId: String(event.structureId ?? event.buildingId ?? event.entityId),
        targetId: typeof event.targetId === "string" ? event.targetId : typeof event.primaryId === "string" ? event.primaryId : undefined,
      }];
    case "ability_fired":
      return event.trigger === "active"
        ? [{ key: `${key}:attack:${String(event.commanderId)}`, kind: "attack", entityId: String(event.commanderId) }]
        : [];
    case "death":
      return [{ key: `${key}:death:${String(event.entityId)}`, kind: "death", entityId: String(event.entityId) }];
    case "structure_destroyed":
      return [{ key: `${key}:death:${String(event.entityId)}`, kind: "death", entityId: String(event.entityId) }];
    default:
      return [];
  }
};

/**
 * Builds presentation cues from one authoritative snapshot boundary. This
 * helper never predicts damage or movement. HP drops are the only hit signal
 * available for unit melee attacks in the public frame contract.
 */
export const battleAnimationCues = (frame: BattleFrame, previous: BattleFrame | null): BattleAnimationCue[] => {
  const cues: BattleAnimationCue[] = [];
  for (const event of frame.events) cues.push(...eventCue(event));

  const before = entityById(previous);
  for (const entity of entitiesIn(frame)) {
    const old = before.get(entity.id);
    if (old && typeof entity.hp === "number" && typeof old.hp === "number" && entity.hp < old.hp) {
      cues.push({ key: `hit:${frame.tick}:${entity.id}:${entity.hp}`, kind: "hit", entityId: entity.id });
    }
  }
  const spawnIds = new Set<string>();
  return cues.filter((cue) => {
    if (cue.kind !== "spawn") return true;
    if (spawnIds.has(cue.entityId)) return false;
    spawnIds.add(cue.entityId);
    return true;
  });
};

/** Returns only cues not already consumed by the renderer. */
export const takeUnseenBattleAnimationCues = (
  cues: BattleAnimationCue[],
  seen: Set<string>
): BattleAnimationCue[] => {
  const next: BattleAnimationCue[] = [];
  for (const cue of cues) {
    if (seen.has(cue.key)) continue;
    seen.add(cue.key);
    next.push(cue);
  }
  return next;
};

/** Interpolates ordinary movement and snaps large corrections to authority. */
export const interpolateBattlePosition = (
  previous: { x: number; y: number } | null,
  current: { x: number; y: number },
  progress: number,
  snapDistance = 12
): { x: number; y: number } => {
  if (!previous) return current;
  if (Math.hypot(current.x - previous.x, current.y - previous.y) > snapDistance) return current;
  const t = Math.max(0, Math.min(1, progress));
  return {
    x: previous.x + (current.x - previous.x) * t,
    y: previous.y + (current.y - previous.y) * t,
  };
};\n