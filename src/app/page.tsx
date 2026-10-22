import type { Metadata } from "next";
import AboutScene from "@/components/site/AboutScene";
import BentoScene from "@/components/site/BentoScene";
import CardsScene from "@/components/site/CardsScene";
import ClosingScene from "@/components/site/ClosingScene";
import CollectScene from "@/components/site/CollectScene";
import HeroWorld from "@/components/site/HeroWorld";
import MarketingHeader from "@/components/site/MarketingHeader";
import SeasonOpening from "@/components/site/SeasonOpening";
import SiteDocumentFlags from "@/components/site/SiteDocumentFlags";
import SiteFooter from "@/components/site/SiteFooter";
import SpotlightScene from "@/components/site/SpotlightScene";
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
      <SeasonOpening />
      <MarketingHeader links={NAV} play={{ href: PLAY.href, label: "Play" }} />

      <main id="main" tabIndex={-1} className="outline-none">
        <HeroWorld headline={HERO.headline} lead={HERO.lead} primary={PLAY} secondary={EXPLORE} />
        <AboutScene id={EXPLORE.href.slice(1)} {...ABOUT} />
        <CardsScene id="cards" />
        <CollectScene id="commanders" />
        <SpotlightScene id="arena" />
        <BentoScene id="world" />
        <ClosingScene id="enter" />
      </main>
      <SiteFooter />
    </div>
  );
}
