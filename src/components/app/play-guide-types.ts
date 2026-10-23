// Plain data contract for the A4.4 play guide.
//
// Built on the server from the live combat, commander and Chaos definitions,
// then rendered by a client view. No ruleset module is imported by the view.

import type { LobbyCatalog, LobbyNotice, LobbyPlayer } from "./lobby-types";

export type PlayGuidePhase = "booting" | "login" | "ready";

export interface GuideArena {
  towersPerSide: number;
  coresPerSide: number;
  towerHp: number;
  coreHp: number;
  towerDamage: number;
  coreDamage: number;
  attackIntervalSeconds: number;
  towerRange: number;
  coreRange: number;
  bridges: number;
  pocketDepth: number;
}

export interface GuideTimeline {
  regulationSeconds: number;
  overtimeSeconds: number;
  maxSeconds: number;
  doubleEnergyAtSeconds: number;
  tripleEnergyAtSeconds: number;
}

export interface GuideEnergy {
  start: number;
  max: number;
  secondsPerPoint: number;
}

export interface GuideDeck {
  ordinaryCards: number;
  commanderCards: number;
  commanderClasses: number;
  handSize: number;
  cardCount: number;
}

export interface GuideCrowns {
  perTower: number;
  coreWin: number;
}

export interface GuideChaosFamily {
  id: string;
  name: string;
  effect: string;
}

export interface GuideChaos {
  pulseTimesSeconds: number[];
  warnMinSeconds: number;
  warnMaxSeconds: number;
  families: GuideChaosFamily[];
}

export interface GuideAbility {
  classId: string;
  className: string;
  role: string;
  ability: string;
  cost: number | null;
  cooldownSeconds: number | null;
}

export interface GuideMode {
  id: "private" | "matchmaking";
  name: string;
  tag: string;
  summary: string;
  detail: string;
}

export interface PlayGuideData {
  arena: GuideArena;
  timeline: GuideTimeline;
  energy: GuideEnergy;
  deck: GuideDeck;
  crowns: GuideCrowns;
  chaos: GuideChaos;
  abilities: GuideAbility[];
  modes: GuideMode[];
}

export interface PlayGuideViewProps {
  phase: PlayGuidePhase;
  player: LobbyPlayer | null;
  guide: PlayGuideData;
  catalog: LobbyCatalog;
  notices: LobbyNotice[];
  calm: boolean;
  status: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
}
