"use client";

import { type PointerEvent } from "react";
import ChogCardMini from "./ChogCardMini";
import type { SiteCard } from "./site-cards";

export interface GridCell {
  title: string;
  body: string;
  value: string;
  card: SiteCard;
  /** Honest label for the art, e.g. "Troop" or "Commander class art". */
  kind: string;
  /** Spoken name for the art. */
  alt: string;
}

interface Props {
  cells: GridCell[];
}

/**
 * L5 feature grid. Each cell carries a violet spotlight that follows the
 * pointer and a mini Chog card that tilts with it. Touch pointers never
 * track, so a tap never leaves a spotlight stuck under a finger.
 */
export default function FeatureGrid({ cells }: Props) {
  const track = (e: PointerEvent<HTMLLIElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5;
    const dy = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--spot-x", `${((dx + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--spot-y", `${((dy + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--tilt-y", `${(dx * 10).toFixed(2)}deg`);
    el.style.setProperty("--tilt-x", `${(dy * -8).toFixed(2)}deg`);
  };

  const reset = (e: PointerEvent<HTMLLIElement>) => {
    const el = e.currentTarget;
    el.style.setProperty("--spot-x", "20%");
    el.style.setProperty("--spot-y", "0%");
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  };

  return (
    <ul className="site-grid">
      {cells.map((c) => (
        <li key={c.title} className="site-grid__cell" onPointerMove={track} onPointerLeave={reset}>
          <span aria-hidden className="site-grid__cross" />
          <div className="site-grid__art">
            <ChogCardMini card={c.card} alt={c.alt} kind={c.kind} sizes="104px" />
          </div>
          <h3 className="site-grid__title">{c.title}</h3>
          <p className="site-grid__body">{c.body}</p>
          <p className="site-grid__value">{c.value}</p>
        </li>
      ))}
    </ul>
  );
}
