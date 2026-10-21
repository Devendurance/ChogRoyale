import Image from "next/image";
import type { Pillar } from "./copy";

interface Props {
  id: string;
  eyebrow: string;
  heading: string;
  lead: string;
  loopLabel: string;
  mascotCaption: string;
  pillars: Pillar[];
}

/**
 * L2 About scene. It rises out of the hero's white fade, so the steps lead
 * straight into the explanation. The four pillars follow the match loop.
 */
export default function AboutScene({ id, eyebrow, heading, lead, loopLabel, mascotCaption, pillars }: Props) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="site-about">
      <div aria-hidden className="site-about__glow" />
      <div className="site-about__inner">
        <div className="site-about__intro">
          <p className="site-tag">{eyebrow}</p>
          <h2 id={`${id}-title`} className="site-about__heading">
            {heading}
          </h2>
          <p className="site-about__lead">{lead}</p>
        </div>

        <figure className="site-about__mascot">
          <div className="site-about__mascot-bob">
            <Image
              src="/assets/site/mascots/reaver-commander-class.png"
              alt="The Reaver, a red skull-faced Chog in a violet bucket hat, holding a jagged blade."
              width={547}
              height={634}
              sizes="(min-width: 1100px) 320px, (min-width: 768px) 240px, 168px"
              loading="eager"
              fetchPriority="low"
              className="site-about__mascot-img"
            />
          </div>
          <figcaption className="site-about__caption">{mascotCaption}</figcaption>
        </figure>

        <ol className="site-loop" aria-label={loopLabel}>
          {pillars.map((p, i) => (
            <li key={p.title} className="site-loop__item">
              <p className="site-loop__step">
                <span aria-hidden className="site-loop__dot" />
                <span className="site-loop__num">{String(i + 1).padStart(2, "0")}</span>
                {p.step}
                {p.status && <span className="site-status">{p.status}</span>}
              </p>
              <h3 className="site-loop__title">{p.title}</h3>
              <p className="site-loop__message">{p.message}</p>
              <p className="site-loop__line">{p.line}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
