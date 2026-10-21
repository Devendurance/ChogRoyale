"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SiteCard } from "./site-cards";

interface Props {
  cards: SiteCard[];
  label: string;
}

const SWIPE_PX = 48;

/** Signed circular distance from the active card, clamped to the hidden lanes. */
function offsetOf(i: number, active: number, n: number) {
  let d = (i - active + n) % n;
  if (d > n / 2) d -= n;
  return Math.max(-2, Math.min(2, d));
}

function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const sync = () => setMatch(m.matches);
    sync();
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, [query]);
  return match;
}

/**
 * Face-down deck with one card revealed at the center, after the reference's
 * rhythm: side cards rest face-down and tilted, the arriving center card flips
 * face-up. Auto-advance is progressive enhancement and stops for reduced
 * motion, Save-Data, hover, focus, hidden tabs and off-screen.
 */
export default function ChogCardCarousel({ cards, label }: Props) {
  const n = cards.length;
  const [active, setActive] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [saveData, setSaveData] = useState(false);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(false);

  const go = useCallback((i: number) => setActive(((i % n) + n) % n), [n]);
  const next = useCallback(() => setActive((a) => (a + 1) % n), [n]);
  const prev = useCallback(() => setActive((a) => (a - 1 + n) % n), [n]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    const vis = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", vis);
    setSaveData(!!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  const autoplayAllowed = !reduced && !saveData;
  const running = autoplayAllowed && !userPaused && !hover && !focusWithin && inView && pageVisible;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    if (e.key === "ArrowRight") next();
    else prev();
  };

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    suppressClick.current = false;
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
    suppressClick.current = true;
    if (dx < 0) next();
    else prev();
  };

  const current = cards[active]!;

  return (
    <div
      ref={root}
      className="chog-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      data-running={running}
      data-reduced={reduced}
      data-autoplay={autoplayAllowed}
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocusWithin(false)}
    >
      <div
        className="chog-carousel__stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      >
        <div aria-hidden className="chog-carousel__floor" />
        {cards.map((card, i) => {
          const offset = offsetOf(i, active, n);
          const isActive = offset === 0;
          return (
            <div
              key={card.id}
              className="chog-carousel__slide"
              data-offset={offset}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${n}: ${card.name}`}
              aria-hidden={!isActive}
              onClick={() => {
                if (suppressClick.current || Math.abs(offset) !== 1) return;
                go(i);
              }}
            >
              <div className="chog-card" data-face={isActive ? "up" : "down"}>
                <div className="chog-card__inner">
                  <div className="chog-card__face chog-card__front">
                    <div className="chog-card__art">
                      <Image src={card.art.src} alt="" width={card.art.width} height={card.art.height} sizes="(min-width: 768px) 260px, 200px" className="chog-card__img" draggable={false} />
                    </div>
                    <p className="chog-card__cost">
                      <span className="sr-only">Cost </span>
                      <span className="chog-card__cost-num">{card.cost}</span>
                      <span className="sr-only"> energy</span>
                    </p>
                    <h3 className="chog-card__name">{card.name}</h3>
                    <p className="chog-card__type">{card.type}</p>
                    {card.traits.length > 0 && (
                      <ul className="chog-card__traits" aria-label="Traits">
                        {card.traits.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div aria-hidden className="chog-card__face chog-card__back">
                    <div className="chog-card__lattice">
                      <span className="chog-card__seal font-game">Chog Royale</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="chog-carousel__controls">
        <button type="button" className="chog-carousel__step site-focus" onClick={prev} aria-label="Previous card">
          <span aria-hidden>←</span>
          <span className="chog-carousel__step-text">Previous</span>
        </button>

        <div className="chog-carousel__progress">
          {cards.map((card, i) => (
            <button
              key={card.id}
              type="button"
              className="chog-carousel__dot site-focus"
              aria-label={`Show ${card.name}, card ${i + 1} of ${n}`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => go(i)}
            >
              <span className="chog-carousel__bar">
                {i === active && autoplayAllowed && (
                  <span key={active} className="chog-carousel__fill" onAnimationEnd={next} />
                )}
              </span>
            </button>
          ))}
          {autoplayAllowed && (
            <button
              type="button"
              className="chog-carousel__pause site-focus"
              aria-label={userPaused ? "Start card rotation" : "Pause card rotation"}
              onClick={() => setUserPaused((p) => !p)}
            >
              <span aria-hidden className="chog-carousel__pause-icon" data-paused={userPaused} />
            </button>
          )}
        </div>

        <button type="button" className="chog-carousel__step site-focus" onClick={next} aria-label="Next card">
          <span className="chog-carousel__step-text">Next</span>
          <span aria-hidden>→</span>
        </button>
      </div>

      <p className="sr-only" aria-live={running ? "off" : "polite"} aria-atomic="true">
        {`Card ${active + 1} of ${n}: ${current.name}, ${current.type}, costs ${current.cost} energy.`}
      </p>
    </div>
  );
}
