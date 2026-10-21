import FeatureGrid, { type GridCell } from "./FeatureGrid";
import { SPOTLIGHT } from "./copy";
import { cardById } from "./site-cards";
import { commanderCard } from "./site-commanders";
import "./spotlight.css";

/** L5: how the arena works. Six mechanics that are true in the current build. */
export default function SpotlightScene({ id }: { id: string }) {
  const cells: GridCell[] = SPOTLIGHT.cells.map((c) => {
    if (c.art.kind === "commander") {
      const card = commanderCard(c.art.id);
      // Shared class art, never the likeness of a token. Same honest label as L4.
      return { ...c, card, alt: `${card.name} commander class art`, kind: "Commander class art" };
    }
    const card = cardById(c.art.id);
    return { ...c, card, alt: `${card.name} card art`, kind: card.type };
  });

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="site-arena">
      <div aria-hidden className="site-arena__glow" />
      <div className="site-arena__inner">
        <div className="site-arena__intro">
          <p className="site-tag">{SPOTLIGHT.eyebrow}</p>
          <h2 id={`${id}-title`} className="site-arena__heading">
            {SPOTLIGHT.heading}
          </h2>
          <p className="site-arena__lead">{SPOTLIGHT.lead}</p>
        </div>
        <FeatureGrid cells={cells} />
        <p className="site-arena__note">
          <span className="site-arena__note-label">{SPOTLIGHT.note.label}</span>
          {SPOTLIGHT.note.text}
        </p>
      </div>
    </section>
  );
}
