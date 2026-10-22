import Link from "next/link";
import { CTA } from "./copy";
import "./closing.css";

/**
 * L7. The closing CTA. The ground starts white so it continues the white
 * tail of the L6 bento without a seam, washes up through lilac and returns
 * to white for the footer's white band. Type does the work here, so there
 * is no mascot in this section.
 */
export default function ClosingScene({ id }: { id: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="site-closing">
      <div aria-hidden className="site-closing__glow" />
      <div className="site-closing__inner">
        <div className="site-closing__copy">
          <p className="site-tag">{CTA.eyebrow}</p>
          <h2 id={`${id}-title`} className="site-closing__heading">
            {CTA.heading}
          </h2>
          <p className="site-closing__lead">{CTA.lead}</p>
          <div className="site-closing__actions">
            <Link href={CTA.primary.href} className="site-btn site-btn--primary site-focus">
              {CTA.primary.label}
            </Link>
            <a href={CTA.secondary.href} className="site-btn site-btn--white site-focus">
              {CTA.secondary.label}
            </a>
          </div>
          {/* The play route is gated off in production builds, so the note sits
              next to the buttons instead of hiding under a footer link. */}
          <p className="site-closing__note">
            <span className="site-closing__note-label">{CTA.note.label}</span>
            {CTA.note.text}
          </p>
        </div>
      </div>
    </section>
  );
}
