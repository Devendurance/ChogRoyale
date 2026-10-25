import type { BattleFrame, Seat, StructureView } from "@/lib/battle-protocol";

export interface CrownCue {
  key: string;
  scorer: Seat;
  ordinal: number;
  structure: Pick<StructureView, "id" | "kind" | "x" | "y">;
}

/** Projects confirmed score deltas only. A destroyed Core locates a multi-crown
 * reveal, but never supplies its count. Initial and resumed snapshots are primed. */
export function crownCues(frame: BattleFrame, previous: BattleFrame | null, suppress = false): CrownCue[] {
  if (!previous || suppress || frame.tick <= previous.tick) return [];
  const before = new Map(previous.structures.map((s) => [s.id, s]));
  const destroyed = frame.structures.filter((s) => !s.alive && before.get(s.id)?.alive);
  const cues: CrownCue[] = [];
  for (const scorer of [0, 1] as const) {
    const prior = previous.crowns[scorer];
    const current = frame.crowns[scorer];
    if (!Number.isInteger(prior) || !Number.isInteger(current) || prior < 0 || current > 3 || current <= prior) continue;
    const sources = destroyed.filter((s) => s.owner !== scorer);
    const core = sources.find((s) => s.kind === "core");
    for (let index = 0; index < current - prior; index++) {
      const source = core ?? sources[index];
      if (!source) continue;
      const ordinal = prior + index + 1;
      cues.push({ key: `crown:${scorer}:${ordinal}:${source.id}`, scorer, ordinal, structure: { id: source.id, kind: source.kind, x: source.x, y: source.y } });
    }
  }
  return cues;
}

export function unseenCrownCues(cues: CrownCue[], seen: Set<string>): CrownCue[] {
  return cues.filter((cue) => {
    if (seen.has(cue.key)) return false;
    seen.add(cue.key);
    if (seen.size > 64) seen.delete(seen.values().next().value!);
    return true;
  });
}

export function crownScreenPoint(point: { x: number; y: number }, rect: { left: number; top: number; width: number; height: number }, seat: number) {
  return { x: rect.left + point.x / 100 * rect.width, y: rect.top + (seat === 0 ? 160 - point.y : point.y) / 160 * rect.height };
}
