import type { Metadata } from "next";
import AboutScene from "@/components/site/AboutScene";
import CardsScene from "@/components/site/CardsScene";
import HeroWorld from "@/components/site/HeroWorld";
import MarketingHeader from "@/components/site/MarketingHeader";
import SiteDocumentFlags from "@/components/site/SiteDocumentFlags";
import { ABOUT, EXPLORE, HERO, META_DESCRIPTION, NAV, PLAY } from "@/components/site/copy";
import { georama, lilitaOne, satoshi } from "@/components/site/fonts";
import "@/components/site/site.css";

export const metadata: Metadata = {
  title: "Chog Royale",
  description: META_DESCRIPTION,
};

export default function Home() {
  return (
    <div id="site-root" className={`site-root ${satoshi.variable} ${georama.variable} ${lilitaOne.variable} font-site flex-1`}>
      <SiteDocumentFlags target="site-root" />
      <a href="#main" className="site-skip site-focus">
        Skip to content
      </a>
      <MarketingHeader links={NAV} play={{ href: PLAY.href, label: "Play" }} />

      <main id="main" tabIndex={-1} className="outline-none">
        <HeroWorld headline={HERO.headline} lead={HERO.lead} primary={PLAY} secondary={EXPLORE} />
        <AboutScene id={EXPLORE.href.slice(1)} {...ABOUT} />
        <CardsScene id="cards" />
      </main>
    </div>
  );
}
