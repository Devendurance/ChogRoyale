// Pure formatting helpers for the A4.4 play guide.
//
// The guide gets every name and number from the server-built ruleset data.
// These helpers only group cards and format clock, energy and cooldown values
// so the view does not hand-format ruleset numbers.

import type { LobbyCatalogCard } from "./lobby-types";

export type GuideCardGroupKind = "troop" | "spell" | "building";

export interface GuideCardGroup {
  kind: GuideCardGroupKind;
  label: string;
  cards: LobbyCatalogCard[];
}

const GROUP_ORDER: GuideCardGroupKind[] = ["troop", "spell", "building"];
const GROUP_LABEL: Record<GuideCardGroupKind, string> = {
  troop: "Troops",
  spell: "Spells",
  building: "Buildings",
};

export function groupGuideCards(cards: LobbyCatalogCard[]): GuideCardGroup[] {
  return GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABEL[kind],
    cards: cards
      .filter((card) => card.kind === kind)
      .sort((a, b) => (a.cost === b.cost ? a.name.localeCompare(b.name) : a.cost - b.cost)),
  })).filter((group) => group.cards.length > 0);
}

/** Whole seconds as m:ss. The guide never shows a fractional clock. */
export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Energy regen is 2.8s at 1x. Keep one decimal and drop a trailing .0. */
export function formatSecondsPerPoint(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unavailable";
  return `${Number(seconds.toFixed(1))}s`;
}

export function formatCooldown(seconds: number | null): string {
  return seconds === null ? "Not listed" : `${seconds}s cooldown`;
}
