// "Meet Your Kingdom" tour contract. Pure and client-safe: no DOM, no DB and
// no auth. The provider owns measurement and navigation; this file owns the
// steps, the eligibility rule and the persisted shape.

export type KingdomTourStepId =
  | "lobby"
  | "battle"
  | "decks"
  | "card-detail"
  | "card-upgrades"
  | "commanders"
  | "progress"
  | "profile";

export interface KingdomTourStep {
  id: KingdomTourStepId;
  route: string;
  /** CSS selector for the real element this step explains. */
  target: string;
  title: string;
  body: string;
}

export const KINGDOM_TOUR_STEPS: readonly KingdomTourStep[] = [
  {
    id: "lobby",
    route: "/app",
    target: '[data-tour="nav-lobby"]',
    title: "Your home base",
    body: "This is your kingdom. Resources, your current deck and the way into every battle start from here.",
  },
  {
    id: "battle",
    route: "/app/play",
    target: '[data-tour="play-practice"]',
    title: "Choose your arena",
    body: "This is the Battle Hall. Practice is a real AI match on the same rules with no rewards. Unranked puts you against a real player, Private rooms invite a friend, and Ranked stays closed until its own release gate opens. Every match ends on a result screen with a way back here.",
  },
  {
    id: "decks",
    route: "/app/decks",
    target: '[data-tour="nav-decks"]',
    title: "Build your strategy",
    body: "Your battle deck lives here. Seven cards and your commander are what you take into a match, and every card has an energy cost and a job in the fight.",
  },
  {
    id: "card-detail",
    route: "/app/decks",
    target: '[data-tour="collection-card"]',
    title: "Meet your troops",
    body: "The Collection lists every card in the ruleset. Tap one to read its tale, energy cost, role and real stats, and add or remove it from your deck right there.",
  },
  {
    id: "card-upgrades",
    route: "/app/decks",
    target: '[data-tour="card-progress"]',
    title: "Power up your troops",
    body: "Earned Card XP builds toward the next level, while Gold buys a purchased level only when the server confirms you are eligible. Tower upgrades are not available yet, so card progression is the only upgrade path here.",
  },
  {
    id: "commanders",
    route: "/app/commanders",
    target: '[data-tour="nav-commanders"]',
    title: "Choose your champion",
    body: "Your commander anchors the deck and brings its own ability. Free classes are available now, and an NFT or borrowed commander appears only when your account is entitled to it.",
  },
  {
    id: "progress",
    route: "/app/progress",
    target: '[data-tour="nav-progress"]',
    title: "Track your victories",
    body: "Verified match history and account progression live here. Ranked matchmaking remains closed until its own release gate opens.",
  },
  {
    id: "profile",
    route: "/app/profile",
    target: '[data-tour="nav-profile"]',
    title: "Your Chog identity",
    body: "Your name, avatar, account details and commander profile are here. Open this page any time to replay the tour.",
  },
];

export const KINGDOM_TOUR_TOTAL = KINGDOM_TOUR_STEPS.length;

export function isKingdomTourStepId(value: unknown): value is KingdomTourStepId {
  return typeof value === "string" && KINGDOM_TOUR_STEPS.some((step) => step.id === value);
}

export function kingdomTourStepIndex(id: KingdomTourStepId | null): number {
  if (!id) return 0;
  const index = KINGDOM_TOUR_STEPS.findIndex((step) => step.id === id);
  return index < 0 ? 0 : index;
}

/** Exact route matching. A subroute such as the Training Camp is its own page. */
export function kingdomTourRouteMatches(pathname: string, route: string): boolean {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return clean === route;
}

export interface KingdomTourStore {
  /** The tour reached its final step. */
  completed: boolean;
  /** The player explicitly skipped it. */
  dismissed: boolean;
  /** The invitation was already shown, so it never returns on its own. */
  prompted: boolean;
  /** A tour was in progress when the tab closed or navigated away. */
  active: boolean;
  stepId: KingdomTourStepId | null;
}

export const EMPTY_KINGDOM_TOUR: KingdomTourStore = {
  completed: false,
  dismissed: false,
  prompted: false,
  active: false,
  stepId: null,
};

/** Account-scoped local persistence. Never contains a token or a session id. */
export function kingdomTourKey(playerId: string): string {
  return `chog-royale.kingdom-tour.v1.${playerId}`;
}

/** Never throws on malformed or older JSON. */
export function parseKingdomTour(raw: string | null): KingdomTourStore {
  if (!raw) return { ...EMPTY_KINGDOM_TOUR };
  try {
    const value = JSON.parse(raw) as Partial<KingdomTourStore> | null;
    if (!value || typeof value !== "object") return { ...EMPTY_KINGDOM_TOUR };
    return {
      completed: value.completed === true,
      dismissed: value.dismissed === true,
      prompted: value.prompted === true,
      active: value.active === true,
      stepId: isKingdomTourStepId(value.stepId) ? value.stepId : null,
    };
  } catch {
    return { ...EMPTY_KINGDOM_TOUR };
  }
}

export interface KingdomTourProgress {
  completedStages: number;
  grandfathered: boolean;
}

/**
 * The invitation is only for accounts the server says finished all three
 * battles. Grandfathered accounts keep access but are never auto-invited.
 */
export function kingdomTourInvite(progress: KingdomTourProgress | null, store: KingdomTourStore): boolean {
  if (!progress) return false;
  if (progress.completedStages < 3) return false;
  if (progress.grandfathered) return false;
  if (store.prompted || store.completed || store.dismissed || store.active) return false;
  return true;
}

/** Manual launch is for a graduated or grandfathered account. */
export function kingdomTourCanStart(progress: KingdomTourProgress | null): boolean {
  return progress !== null && (progress.completedStages >= 3 || progress.grandfathered);
}

export interface ProgressionFacts {
  state: string;
  level: string;
  xp: string;
  xpTarget: string;
  gold: string;
  status: string;
}

/**
 * Turns values the card sheet really rendered into one accurate sentence.
 * Missing values are reported as unavailable, never as zero.
 */
export function kingdomTourProgressionLine(facts: ProgressionFacts | null): string {
  if (!facts || !facts.level || !facts.xp || facts.state === "unavailable") {
    return "Card progression cannot be checked right now. No level or Gold is shown until the server responds.";
  }
  if (!facts.gold || facts.state === "maxed") {
    return `Purchased level ${facts.level}, ${facts.xp} earned XP. This card is already at its maximum level.`;
  }
  const tail = facts.status && facts.state !== "ready" && facts.state !== "gold-locked" ? ` ${facts.status}` : "";
  if (!facts.xpTarget) {
    return `Purchased level ${facts.level}, ${facts.xp} earned XP. The next upgrade costs ${facts.gold} Gold when the server says you are eligible.${tail}`;
  }
  return `Purchased level ${facts.level}, ${facts.xp} earned XP toward a ${facts.xpTarget} XP target. The next upgrade costs ${facts.gold} Gold, and only the Upgrade button spends it.${tail}`;
}

/** Placement hint for the coachmark relative to the highlighted element. */
export type CoachPlacement = "above" | "below" | "center";

export function coachPlacement(
  rect: { top: number; bottom: number } | null,
  viewportHeight: number,
  cardHeight: number,
  reservedBottom: number,
): CoachPlacement {
  if (!rect) return "center";
  const gap = 14;
  const spaceBelow = viewportHeight - rect.bottom - reservedBottom - gap;
  const spaceAbove = rect.top - gap;
  if (spaceBelow >= cardHeight) return "below";
  if (spaceAbove >= cardHeight) return "above";
  return "center";
}

export interface CoachPositionInput {
  rect: { left: number; top: number; width: number; height: number } | null;
  viewportWidth: number;
  viewportHeight: number;
  cardHeight: number;
  coachWidth: number;
  navHeight: number;
  safeTop: number;
  safeLeft: number;
  safeRight: number;
  placement: CoachPlacement;
}

export interface CoachPosition {
  left: number;
  top: number;
}

/**
 * Fixed-position math shared by the provider and the presentation fixture.
 * It keeps the coach inside the safe area, above the fixed navigation and
 * clear of a real target whenever the viewport has room.
 */
export function coachPosition(input: CoachPositionInput): CoachPosition {
  const margin = 12;
  const width = input.viewportWidth > 0 ? input.viewportWidth : 360;
  const height = input.viewportHeight > 0 ? input.viewportHeight : 640;
  const minLeft = margin + input.safeLeft;
  const maxLeft = width - input.coachWidth - margin - input.safeRight;
  const left = input.rect
    ? clampNumber(input.rect.left + input.rect.width / 2 - input.coachWidth / 2, minLeft, Math.max(minLeft, maxLeft))
    : Math.max(minLeft, (width - input.coachWidth) / 2);
  const minTop = margin + input.safeTop;
  const maxTop = height - input.cardHeight - Math.max(margin, input.navHeight + margin);
  let top = (height - input.cardHeight) / 2;
  if (input.rect && input.placement === "below") top = input.rect.top + input.rect.height + 14;
  if (input.rect && input.placement === "above") top = input.rect.top - 14 - input.cardHeight;
  return { left, top: clampNumber(top, minTop, Math.max(minTop, maxTop)) };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
