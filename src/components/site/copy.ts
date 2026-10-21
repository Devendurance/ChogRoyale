// Public site copy. Source: docs/Chog Royale messaging.md (section numbers
// noted per line). Lines marked ADAPTED differ from the source so they match
// what the current build actually ships; keep them until the owner signs off.

import type { SiteNavLink } from "./MarketingHeader";

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

export interface Pillar {
  step: string;
  title: string;
  message: string;
  line: string;
  note?: { label: string; text: string };
}

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
