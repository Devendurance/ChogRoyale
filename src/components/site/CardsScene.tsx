import ChogCardCarousel from "./ChogCardCarousel";
import { CARDS } from "./copy";
import { rosterCounts, showcaseCards } from "./site-cards";
import "./cards.css";

/** L3: the deck you bring. Continues the About scene's lilac ground. */
export default function CardsScene({ id }: { id: string }) {
  const cards = showcaseCards();
  const counts = rosterCounts();
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="site-cards">
      <div aria-hidden className="site-cards__bloom" />
      <div className="site-cards__intro">
        <p className="site-tag">{CARDS.eyebrow}</p>
        <h2 id={`${id}-title`} className="site-cards__heading">
          {CARDS.heading}
        </h2>
        <p className="site-cards__lead">{CARDS.lead(counts)}</p>
      </div>
      <ChogCardCarousel cards={cards} label={CARDS.carouselLabel} />
      <p className="site-cards__caption">{CARDS.caption(cards.length, counts.total)}</p>
    </section>
  );
}
