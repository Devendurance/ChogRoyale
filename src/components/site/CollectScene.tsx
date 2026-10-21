import CommanderSpotlight from "./CommanderSpotlight";
import { COLLECT } from "./copy";
import { commanderClasses } from "./site-commanders";
import "./cards.css";
import "./collect.css";

/** L4: who leads your deck, and which Chog shapes the arena. */
export default function CollectScene({ id }: { id: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="site-collect">
      <div aria-hidden className="site-collect__wash" />
      <div className="site-collect__inner">
        <div className="site-collect__copy">
          <p className="site-tag">{COLLECT.eyebrow}</p>
          <h2 id={`${id}-title`} className="site-collect__heading">
            {COLLECT.heading}
          </h2>
          <p className="site-collect__lead">{COLLECT.lead}</p>
          <ul className="site-collect__beats">
            {COLLECT.beats.map((b) => (
              <li key={b.title} className="site-collect__beat">
                <h3 className="site-collect__beat-title">{b.title}</h3>
                <p className="site-collect__beat-text">{b.text}</p>
                {"note" in b && b.note && (
                  <p className="site-collect__note">
                    <span className="site-collect__note-label">{b.note.label}</span> {b.note.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="site-collect__fairness">
            <span aria-hidden className="site-collect__seal" />
            {COLLECT.fairness}
          </p>
        </div>
        <CommanderSpotlight commanders={commanderClasses()} initial="reaver" pickerLabel={COLLECT.pickerLabel} caption={COLLECT.caption} />
      </div>
    </section>
  );
}
