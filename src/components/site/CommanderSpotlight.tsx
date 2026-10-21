"use client";

import Image, { getImageProps } from "next/image";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import ChogCard from "./ChogCard";
import type { SiteCommander } from "./site-commanders";
import { useMedia, useSaveData } from "./use-media";

interface Props {
  commanders: SiteCommander[];
  initial: string;
  pickerLabel: string;
  caption: { kind: string; note: string };
}

const FLIP_MS = 380;
const CARD_SIZES = "(min-width: 1100px) 380px, (min-width: 768px) 300px, 248px";

// Fixed layout so server and client render the same motes. x/y are % of the
// stage, d is the drift period in seconds, s the size in px.
const MOTES = [
  { x: 8, y: 22, d: 3.2, s: 10 },
  { x: 90, y: 16, d: 2.6, s: 8 },
  { x: 16, y: 70, d: 3.8, s: 12 },
  { x: 84, y: 62, d: 2.9, s: 9 },
  { x: 4, y: 46, d: 3.5, s: 7 },
  { x: 96, y: 40, d: 2.4, s: 11 },
  { x: 26, y: 8, d: 3.1, s: 6 },
  { x: 72, y: 88, d: 3.6, s: 8 },
  { x: 12, y: 92, d: 2.7, s: 6 },
  { x: 78, y: 6, d: 3.9, s: 7 },
  { x: 98, y: 80, d: 2.5, s: 6 },
  { x: 2, y: 8, d: 3.3, s: 8 },
  { x: 60, y: 2, d: 2.8, s: 5 },
  { x: 36, y: 96, d: 3.4, s: 7 },
  { x: 92, y: 96, d: 3, s: 5 },
  { x: 0, y: 64, d: 2.6, s: 9 },
];

/**
 * L4 featured commander card. Picking another class flips the card through
 * its back to reveal the new class. Tilt follows a mouse pointer, motes and
 * halo drift only while on screen. Reduced motion swaps the card instantly
 * and drops tilt, motes and pulse; Save-Data drops motes and pulse.
 */
export default function CommanderSpotlight({ commanders, initial, pickerLabel, caption }: Props) {
  const start = Math.max(0, commanders.findIndex((c) => c.id === initial));
  const [target, setTarget] = useState(start);
  const [shown, setShown] = useState(start);
  const [face, setFace] = useState<"up" | "down">("up");
  const [inView, setInView] = useState(false);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const finePointer = useMedia("(hover: hover) and (pointer: fine)");
  const saveData = useSaveData();
  const root = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const flipTimer = useRef<number | undefined>(undefined);
  const preloaded = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setInView(entries[entries.length - 1]!.isIntersecting), { rootMargin: "120px 0px" });
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(flipTimer.current);
    };
  }, []);

  // Warm the other class portraits once the scene is near, so a flip never
  // lands on an empty frame.
  useEffect(() => {
    if (!inView || preloaded.current || saveData) return;
    preloaded.current = true;
    for (const c of commanders) {
      const { props } = getImageProps({ src: c.card.art.src, alt: "", width: c.card.art.width, height: c.card.art.height, sizes: CARD_SIZES });
      const img = new window.Image();
      img.sizes = CARD_SIZES;
      if (props.srcSet) img.srcset = props.srcSet;
      img.src = props.src;
    }
  }, [inView, saveData, commanders]);

  const choose = (i: number) => {
    if (i === target) return;
    setTarget(i);
    window.clearTimeout(flipTimer.current);
    if (reduced) {
      setShown(i);
      setFace("up");
      return;
    }
    setFace("down");
    flipTimer.current = window.setTimeout(() => {
      setShown(i);
      setFace("up");
    }, FLIP_MS);
  };

  const tiltOn = finePointer && !reduced;
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = tilt.current;
    if (!tiltOn || !el || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5;
    const dy = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--tilt-y", `${(dx * 14).toFixed(2)}deg`);
    el.style.setProperty("--tilt-x", `${(dy * -12).toFixed(2)}deg`);
  };
  const resetTilt = () => {
    tilt.current?.style.setProperty("--tilt-y", "0deg");
    tilt.current?.style.setProperty("--tilt-x", "0deg");
  };

  const current = commanders[shown]!;
  const picked = commanders[target]!;

  return (
    <div ref={root} className="site-spotlight" data-inview={inView}>
      <figure className="site-spotlight__figure">
        <div className="site-spotlight__stage" onPointerMove={onPointerMove} onPointerLeave={resetTilt}>
          <div aria-hidden className="site-spotlight__halo" />
          <div aria-hidden className="site-spotlight__plinth" />
          <div aria-hidden className="site-spotlight__motes">
            {MOTES.map((m, i) => (
              <span
                key={i}
                className="site-spotlight__mote"
                style={{ left: `${m.x}%`, top: `${m.y}%`, width: m.s, height: m.s, animationDuration: `${m.d}s`, animationDelay: `${(i * -0.37).toFixed(2)}s` }}
              />
            ))}
          </div>
          <div className="site-spotlight__enter">
            <div ref={tilt} className="site-spotlight__tilt" data-tilt={tiltOn}>
              <ChogCard card={current.card} face={face} sizes={CARD_SIZES} alt={`${current.card.name} commander class art`} />
            </div>
          </div>
        </div>
        <figcaption className="site-spotlight__caption">
          <span className="site-spotlight__caption-kind">{caption.kind}</span>
          <span className="site-spotlight__caption-name">{current.card.name}</span>
          <span className="site-spotlight__caption-note">{caption.note}</span>
        </figcaption>
      </figure>

      <div className="site-spotlight__picker" role="group" aria-label={pickerLabel}>
        {commanders.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className="site-spotlight__pick site-focus"
            aria-pressed={i === target}
            onClick={() => choose(i)}
          >
            <span className="site-spotlight__pick-art">
              <Image src={c.card.art.src} alt="" width={c.card.art.width} height={c.card.art.height} sizes="48px" className="site-spotlight__pick-img" />
            </span>
            <span className="site-spotlight__pick-name">{c.card.name}</span>
          </button>
        ))}
      </div>
      <p className="site-spotlight__blurb" aria-live="polite">
        <span className="sr-only">{`${picked.card.name}: `}</span>
        {picked.blurb}
      </p>
    </div>
  );
}
