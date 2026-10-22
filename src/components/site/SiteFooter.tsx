"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FOOTER } from "./copy";
import { useMedia } from "./use-media";
import "./closing.css";

// Approved commander class art. The class art is shared by every commander of
// the class, so the scene never presents these as a specific NFT. The scene
// itself is aria-hidden and the visible caption carries the honest label.
const MASCOTS = [
  {
    key: "warden",
    src: "/assets/site/commanders/warden.png",
    width: 533,
    height: 690,
    at: 18,
    tilt: -4,
  },
  {
    key: "reaver",
    src: "/assets/site/mascots/reaver-commander-class.png",
    width: 547,
    height: 634,
    at: 66,
    tilt: 3,
  },
  {
    key: "scout",
    src: "/assets/site/commanders/scout.png",
    width: 472,
    height: 665,
    at: 82,
    tilt: -2,
  },
] as const;

/**
 * L7. The signature footer. The top half is the real link map, the bottom
 * half is the fantasy scene: a violet sky, a sun, a slow ring and four
 * fur-edged hills with three Chogs peeking over the ridge.
 */
export default function SiteFooter() {
  const reduceMotion = useMedia("(prefers-reduced-motion: reduce)");
  const sceneRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  // The mascots rise once, when the footer first comes into view.
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, [reduceMotion]);

  return (
    <footer className="site-footer">
      <div className="site-footer__top">
        <div className="site-footer__inner">
          <div className="site-footer__brand">
            <p className="site-footer__wordmark">
              <span className="site-footer__mark" aria-hidden="true">
                CR
              </span>
              <span className="site-footer__name">{FOOTER.wordmark}</span>
            </p>
            <p className="site-footer__tagline">
              {FOOTER.tagline.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
            <Link href={FOOTER.playLink.href} className="site-footer__play site-focus">
              {FOOTER.playLink.label}
            </Link>
          </div>

          {FOOTER.columns.map((column) => (
            <nav key={column.heading} className="site-footer__col" aria-label={column.heading}>
              <h2 className="site-footer__col-heading">{column.heading}</h2>
              <ul className="site-footer__links">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="site-footer__link site-focus"
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                    >
                      {link.label}
                      {link.external ? <span aria-hidden="true"> ↗</span> : null}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="site-footer__bottom">
          <p className="site-footer__copyright">{FOOTER.copyright}</p>
          <p className="site-footer__statement">{FOOTER.statement}</p>
        </div>
      </div>

      <div className="site-footer__stage">
        <div ref={sceneRef} className="site-footer__scene" data-inview={inView ? "true" : "false"} aria-hidden="true">
          <div className="site-footer__bloom" />
          <div className="site-footer__sun" />
          <div className="site-footer__ring" />
          <div className="site-footer__bead site-footer__bead--a" />
          <div className="site-footer__bead site-footer__bead--b" />

          <div className="site-footer__hill site-footer__hill--far" />
          <div className="site-footer__hill site-footer__hill--mid" />
          <div className="site-footer__hill site-footer__hill--near" />

          {MASCOTS.map((m) => (
            <div
              key={m.key}
              className={`site-footer__mascot site-footer__mascot--${m.key}`}
              style={{ "--at": `${m.at}%` } as React.CSSProperties}
            >
              <Image
                src={m.src}
                alt=""
                width={m.width}
                height={m.height}
                sizes="(min-width: 768px) 230px, 150px"
                loading="lazy"
                className="site-footer__mascot-img"
                style={{ "--tilt": `${m.tilt}deg` } as React.CSSProperties}
              />
            </div>
          ))}

          <div className="site-footer__hill site-footer__hill--front" />
        </div>

        {/* Outside the aria-hidden scene so assistive tech still gets the label,
            and above the ridge so it never covers a mascot. */}
        <p className="site-footer__caption">
          <span className="site-footer__caption-kind">{FOOTER.caption.kind}</span>
          <span className="site-footer__caption-note">{FOOTER.caption.note}</span>
        </p>
      </div>

      <button type="button" className="site-footer__handle site-focus" onClick={toTop} aria-label="Back to top">
        <span className="site-footer__handle-arrow" aria-hidden="true" />
        <span className="site-footer__handle-bar" aria-hidden="true" />
      </button>
    </footer>
  );
}
