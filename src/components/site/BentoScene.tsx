import BentoGrid, { type BentoCardArt, type BentoTileData } from "./BentoGrid";
import { BENTO } from "./copy";
import { cardById } from "./site-cards";
import { commanderCard } from "./site-commanders";
import "./bento.css";

const toArt = (id: string): BentoCardArt => {
  const card = cardById(id);
  return {
    id: card.id,
    name: card.name,
    cost: card.cost,
    src: card.art.src,
    width: card.art.width,
    height: card.art.height,
  };
};

// The Reaver is the shared Reaver class art, never a token likeness. It is
// labelled as class art on the page, the same way L2 and L4 label it.
const REAVER: BentoCardArt = (() => {
  const c = commanderCard("reaver");
  return { id: c.id, name: c.name, cost: c.cost, src: c.art.src, width: c.art.width, height: c.art.height };
})();

/** L6: what runs today beside what is still being built. */
export default function BentoScene({ id }: { id: string }) {
  const tiles: BentoTileData[] = BENTO.tiles.map((t) => {
    const base = {
      id: t.id,
      status: t.status,
      sticker: t.sticker,
      title: t.title,
      body: t.body,
      link: t.link,
    };
    switch (t.art.kind) {
      case "tableau":
        return { ...base, art: { kind: "tableau", commander: REAVER, cards: [toArt("rift_sentry"), toArt("chaos_comet")] } };
      case "cards":
        return { ...base, art: { kind: "cards", cards: [toArt("chaos_archer"), toArt("hexwing")] } };
      case "card":
        return { ...base, art: { kind: "card", card: toArt("boulderback") } };
      case "orbit":
        return { ...base, art: { kind: "orbit" } };
      case "exchange":
        return { ...base, art: { kind: "exchange" } };
    }
  });

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="site-bento">
      <div aria-hidden className="site-bento__glow" />
      <div className="site-bento__inner">
        <div className="site-bento__intro">
          <p className="site-tag">{BENTO.eyebrow}</p>
          <h2 id={`${id}-title`} className="site-bento__heading">
            {BENTO.heading}
          </h2>
          <p className="site-bento__lead">{BENTO.lead}</p>
        </div>

        <div className="site-bento__shell">
          <BentoGrid tiles={tiles} />
        </div>
      </div>
    </section>
  );
}
