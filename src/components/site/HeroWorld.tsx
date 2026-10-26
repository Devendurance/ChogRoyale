import type { CSSProperties } from "react";
import Link from "next/link";
import { getImageProps } from "next/image";
import type { SiteNavLink } from "./MarketingHeader";

interface Props {
  headline: string;
  lead: string;
  primary: SiteNavLink;
  secondary: SiteNavLink;
}

const ALT = "Illustrated pagoda city: red lacquer temples and violet blossoms above stone steps that climb to a temple gate.";

// Proposed G hero (owner-supplied, rights pending). The wide master is the
// whole 1672x941 source; the portrait crop keeps the steps and temple gate.
function HeroPicture() {
  const common = { alt: ALT, sizes: "100vw", fetchPriority: "high" as const, loading: "eager" as const };
  const {
    props: { srcSet: wide },
  } = getImageProps({ ...common, src: "/assets/site/hero/pagoda-city-wide.jpg", width: 1672, height: 941 });
  const {
    props: { srcSet: portrait, ...img },
  } = getImageProps({ ...common, src: "/assets/site/hero/pagoda-city-portrait.jpg", width: 560, height: 941 });
  return (
    <picture>
      <source media="(min-width: 1025px), (orientation: landscape)" srcSet={wide} />
      <source srcSet={portrait} />
      <img {...img} alt={img.alt} className="site-hero__img" />
    </picture>
  );
}

// Deterministic scatter so server and client markup match.
const PETALS = Array.from({ length: 12 }, (_, i) => ({
  "--x": `${(i * 37 + 5) % 100}%`,
  "--dur": `${14 + ((i * 7) % 9)}s`,
  "--delay": `${-i * 1.7}s`,
  "--size": `${7 + ((i * 5) % 7)}px`,
}));

export default function HeroWorld({ headline, lead, primary, secondary }: Props) {
  return (
    <section aria-labelledby="hero-title" className="site-hero">
      <div className="site-hero__parallax">
        <div className="site-hero__art">
          <HeroPicture />
        </div>
      </div>
      <div aria-hidden className="site-hero__scrim" />
      <div aria-hidden className="site-hero__petals">
        {PETALS.map((vars, i) => (
          <span key={i} className="site-petal" style={vars as CSSProperties} />
        ))}
      </div>
      <div aria-hidden className="site-hero__foot" />

      <div className="site-hero__content">
        <h1 id="hero-title" className="site-hero__title">
          <span className="sr-only">Chog Royale: </span>
          <span className="site-hero__headline">{headline}</span>
        </h1>
        <p className="site-hero__lead">{lead}</p>
        <div className="site-hero__actions">
          <Link href={primary.href} className="site-btn site-btn--primary site-focus">
            {primary.label}
          </Link>
          <a href={secondary.href} className="site-btn site-btn--white site-focus">
            {secondary.label}
          </a>
        </div>
      </div>
    </section>
  );
}
