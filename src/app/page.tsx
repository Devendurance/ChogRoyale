import type { Metadata } from "next";
import { preconnect } from "react-dom";
import HeroWorld from "@/components/site/HeroWorld";
import MarketingHeader, { type SiteNavLink } from "@/components/site/MarketingHeader";
import SiteDocumentFlags from "@/components/site/SiteDocumentFlags";
import { SATOSHI_CSS, georama, lilitaOne } from "@/components/site/fonts";
import "@/components/site/site.css";

// Copy source: docs/Chog Royale messaging.md (section numbers noted per line).
const COPY = {
  description: "Chog Royale is a 1v1 card battler where a real Chog changes the match.", // 1.6
  headline: "Every Chog changes the arena.", // 5.1 hero headline
  lead: "Chog Royale is a fast 1v1 card battler where a verified Chog NFT sets the match’s Chaos Pulse. Build your deck, read the arena and break the Core.", // 5.1 supporting text
  fairnessHeading: "Identity changes the conditions. Skill decides the outcome.", // 1.5
  fairnessBody: "Play through the free route. Your Chog gives you a story. Your decisions win the match.", // 5.1 fairness note (first sentence) + 2.3 pillar 3
};

// /dev/battle is the only working play surface: Privy login, then matchmaking.
const PLAY: SiteNavLink = { href: "/dev/battle", label: "Play the first match" }; // 5.1 primary CTA
const EXPLORE: SiteNavLink = { href: "#how-the-chog-matters", label: "See how the Chog matters" }; // 5.1 secondary CTA
const NAV: SiteNavLink[] = [{ href: EXPLORE.href, label: "How the Chog matters" }];

export const metadata: Metadata = {
  title: "Chog Royale",
  description: COPY.description,
};

export default function Home() {
  preconnect("https://api.fontshare.com");
  preconnect("https://cdn.fontshare.com", { crossOrigin: "anonymous" });

  return (
    <div id="site-root" className={`site-root ${georama.variable} ${lilitaOne.variable} flex-1`}>
      <link rel="stylesheet" href={SATOSHI_CSS} precedence="default" />
      <SiteDocumentFlags target="site-root" />
      <a href="#main" className="site-skip site-focus">
        Skip to content
      </a>
      <MarketingHeader links={NAV} play={{ href: PLAY.href, label: "Play" }} />

      <main id="main" tabIndex={-1} className="outline-none">
        <HeroWorld headline={COPY.headline} lead={COPY.lead} primary={PLAY} secondary={EXPLORE} />

        <section id="how-the-chog-matters" aria-labelledby="how-title" className="site-section">
          <div className="mx-auto max-w-[1280px] text-center">
            <p className="font-data text-[11px] leading-[14px] font-bold tracking-[0.12em] text-chog-royal uppercase">How the Chog matters</p>
            <h2 id="how-title" className="mx-auto mt-4 max-w-[18ch] text-[32px] leading-[1.1] font-bold tracking-[-0.025em] text-balance text-chog-ink md:text-[48px]">
              {COPY.fairnessHeading}
            </h2>
            <p className="mx-auto mt-5 max-w-[34rem] text-lg leading-[30px] text-balance text-chog-ink-70">{COPY.fairnessBody}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
