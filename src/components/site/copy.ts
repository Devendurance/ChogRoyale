// Public site copy. Source: docs/Chog Royale messaging.md (section numbers
// noted per line). Lines marked ADAPTED differ from the source so they match
// what the current build actually ships; keep them until the owner signs off.

import type { SiteNavLink } from "./MarketingHeader";
import type { CommanderClass } from "@/lib/commanders";

export const META_DESCRIPTION = "Chog Royale is a 1v1 card battler where a real Chog changes the match."; // 1.6

export const HERO = {
  headline: "Every Chog changes the arena.", // 5.1 hero headline
  lead: "Chog Royale is a fast 1v1 card battler where a verified Chog NFT sets the match’s Chaos Pulse. Build your deck, read the arena and break the Core.", // 5.1 supporting text
};

// /dev/battle is the only working play surface (Privy login, then matchmaking).
// It is gated off in production builds, so this is not a public launch path yet.
export const PLAY: SiteNavLink = { href: "/dev/battle", label: "Play the first match" }; // 5.1 primary CTA
export const EXPLORE: SiteNavLink = { href: "#how-the-chog-matters", label: "See how the Chog matters" }; // 5.1 secondary CTA
export const NAV: SiteNavLink[] = [{ href: EXPLORE.href, label: "How the Chog matters" }];

export const CARDS = {
  eyebrow: "The cards",
  heading: "Build your first deck.", // 5.2 onboarding
  // NEW (not in the messaging doc): counts come from the live card tables.
  lead: (c: { troops: number; buildings: number; spells: number }) =>
    `The current build has ${c.troops} troops, ${c.buildings} buildings and ${c.spells} spells. Pick seven, add a commander and spend energy to deploy them.`,
  caption: (shown: number, total: number) => `${shown} of the ${total} cards in the current build. Costs and traits can change with balancing.`, // NEW, honesty note
  carouselLabel: "Chog Royale cards",
};

export interface CollectBeat {
  title: string;
  text: string;
  note?: { label: string; text: string };
}

// L4. Lines marked NEW are not in the messaging doc. Each is backed by code
// (cited) and needs owner sign-off.
export const COLLECT = {
  eyebrow: "Commanders",
  heading: "The NFT is part of the match.", // 1.4 competition line
  lead: "Give your Chog a visible job in the match rather than leaving it as a static collectible.", // 2.2 Chog holder promise
  beats: [
    {
      title: "Your commander",
      // NEW: lib/commanders.ts derives class from traits; /api/players/me/commanders gates NFT commanders on a verified wallet.
      text: "A verified Chog’s traits decide its class. Hold one and it can lead your deck.",
      // NFT-holder end-to-end play has not been run yet (B3.2a).
      note: { label: "In testing", text: "NFT commanders are built and waiting on holder testing." },
    },
    {
      title: "The Arena Patron",
      // NEW, adapted from 1.8: server/battle/patron-source.ts locks one indexed Genesis token per match; lib/patrons.ts says players never choose it.
      text: "Each match, the server picks a separate Chog from the Genesis collection. Its metadata sets the Chaos Pulse, and neither player chooses it.",
    },
    {
      title: "The free route",
      // "Play free first..." is 4.5 onboarding. Second sentence NEW: COMMANDER_COMBAT_PROFILE_V1 is class-keyed, free == NFT.
      text: "Play free first. Connect a Chog when you are ready. Free commanders fight with the same class stats as NFT ones.",
    },
  ] satisfies CollectBeat[],
  // NEW: lib/commanders.ts, Tier is prestige only and never scored.
  fairness: "Tier is prestige only. It never changes combat stats.",
  pickerLabel: "Commander classes",
  // NEW: class templates are shared art, never a token likeness.
  caption: { kind: "Commander class art", note: "Shared by every commander of this class. Not a specific NFT." },
};

export interface Pillar {
  step: string;
  title: string;
  message: string;
  line: string;
  note?: { label: string; text: string };
}

export type SpotlightArt = { kind: "card"; id: string } | { kind: "commander"; id: CommanderClass };

export interface SpotlightCell {
  title: string;
  body: string;
  value: string;
  art: SpotlightArt;
}

// L5. The value lines come from the messaging doc's feature-to-value table
// (section 6). Bodies are adapted from the same table and the pillar copy
// (2.3) and read against the shipped ruleset. Lines marked NEW are not in
// the messaging doc; each is backed by code (cited) and needs owner sign-off.
export const SPOTLIGHT = {
  eyebrow: "How the arena works",
  heading: "Read the Pulse. Break the Core.", // 1.3
  lead: "Here is what actually runs a match, from the first card to the last result. Every rule below is decided on the server, not in your browser.",
  cells: [
    {
      title: "The server owns the arena",
      // NEW, from 6 "Server authority". The server owns seats, seed and Chaos,
      // and the client only ever sends a deploy or an ability command.
      body: "The match runs on the server, not in your browser. You send the moves you want to make, and the server decides what happens and who breaks the Core first.",
      value: "Browser manipulation cannot decide the match.", // 6
      art: { kind: "card", id: "boulderback" },
    },
    {
      title: "Seven cards and a commander",
      // NEW: 7 ordinary + 1 commander (combat.ts validateDeck); ENERGY_V1 start 5,
      // one point per 28 ticks, doubling at 120s and tripling at 240s.
      body: "A deck is seven ordinary cards and one commander. Energy starts at five and refills on a timer, faster as the match goes on, so every card you hold is a timing decision.",
      value: "Energy makes every card a decision.", // NEW
      art: { kind: "card", id: "rift_sentry" },
    },
    {
      title: "A Chog sets the rule",
      // NEW, from 6 "Arena Patron". server/battle/patron-source.ts picks an
      // indexed Genesis token with resolved metadata and the room locks it.
      body: "Before the match the server picks a Chog from the Genesis collection and locks it as the Arena Patron. Neither seat picks it, and both play under the same one.",
      value: "Players know what rule is coming.", // 6
      art: { kind: "card", id: "chaos_comet" },
    },
    {
      title: "The rule is visible before it acts",
      // NEW, from 6 "Chaos Pulse" and 2.3 pillar 2. chaos.ts CHAOS_TIMELINE_V1:
      // 180s match, three pulses at 45/90/135s, 3-5s warn, 8-15s effect, symmetric.
      body: "The Patron's traits pick the first Chaos Pulse, and two more follow as the match runs. Each one warns you first, hits both sides the same way, and expires on its own.",
      value: "Decks and timing decisions matter.", // 6
      art: { kind: "card", id: "frostshell" },
    },
    {
      title: "Free commanders fight the same",
      // NEW, from 6 "Free route". COMMANDER_COMBAT_PROFILE_V1 is keyed by
      // class only, so free and NFT commanders of a class share one profile.
      body: "Play without owning a Chog. A free commander and an NFT commander of the same class fight with the exact same numbers, so ownership never buys extra power.",
      value: "Welcome instead of exclusion.", // 6
      art: { kind: "commander", id: "bulwark" },
    },
    {
      title: "Every match is replayed",
      // NEW, from 6 "Match Recipe". session.ts finish() re-runs the match for
      // every end reason (core, crowns, overtime, timeout) and compares state
      // hashes; room.ts and settlement.ts refuse a mismatched result.
      body: "Every finished match is replayed by the server, whether it ended on the Core, on crowns or in overtime. The replay has to match the live match, or the result is refused.",
      value: "Trust in the result.", // 6
      art: { kind: "card", id: "chaos_archer" },
    },
  ] satisfies SpotlightCell[],
  note: {
    label: "In the current build",
    text: "The battle, the Arena Patron and the free-commander route are all in the current build and playable. Playing needs a dev login, so the match is not open to the public yet, and saved match history is off until settlement is switched on.",
  },
};


export const ABOUT = {
  eyebrow: "How the Chog matters",
  heading: "Identity changes the conditions. Skill decides the outcome.", // 1.5
  lead: "Build an eight-card deck, defend your Core and react to a Chaos Pulse derived from a verified Chog NFT. Play through the free route, read the arena and outsmart your opponent.", // 1.7
  loopLabel: "Reveal, understand, adapt, clash, remember", // 1.10 core loop
  mascot: { name: "Reaver", kind: "Commander class art" },
  pillars: [
    {
      step: "Reveal", // 1.10
      title: "The NFT has a job", // 2.3 pillar 1
      message: "A verified Chog identity changes the conditions of play.", // 2.3 pillar 1 message
      line: "This Chog is part of the match.", // 2.3 pillar 1 language
    },
    {
      step: "Understand and adapt", // 1.10
      title: "Chaos is fair", // 2.3 pillar 2
      message: "Surprise is visible, finite and counterable.", // 2.3 pillar 2 message
      line: "The arena changes. The rule is visible.", // 2.3 pillar 2 language
    },
    {
      step: "Clash", // 1.10
      title: "Skill stays sovereign", // 2.3 pillar 3
      message: "Ownership adds identity and variety, not extra combat power.", // ADAPTED from 2.3 pillar 3: ranked is not live; NFT and free commanders share one combat profile
      line: "Your Chog gives you a story. Your decisions win the match.", // 2.3 pillar 3 language
    },
    {
      step: "Remember", // 1.10
      title: "Every match leaves a trace", // 2.3 pillar 4
      message: "The server replays every match to check the result.", // ADAPTED from 2.3 pillar 4: shipped part only
      line: "See what changed. See why it changed.", // 2.3 pillar 4 language
      note: { label: "In development", text: "A Match Recipe that shows the Patron, the rule and the outcome." }, // honest caveat: no player-facing Match Recipe yet
    },
  ] satisfies Pillar[],
};
