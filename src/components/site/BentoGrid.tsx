"use client";

import Image from "next/image";
import type { PointerEvent } from "react";

export interface BentoCardArt {
  id: string;
  name: string;
  cost: number;
  src: string;
  width: number;
  height: number;
}

type BentoTileBase = {
  id: string;
  status: string;
  sticker: string;
  title: string;
  body: string;
  link?: { href: string; label: string };
};

export type BentoTileData = BentoTileBase &
  (
    | { art: { kind: "tableau"; commander: BentoCardArt; cards: BentoCardArt[] } }
    | { art: { kind: "cards"; cards: BentoCardArt[] } }
    | { art: { kind: "card"; card: BentoCardArt } }
    | { art: { kind: "orbit" } }
    | { art: { kind: "exchange" } }
  );

interface Props {
  tiles: BentoTileData[];
}

/**
 * L6 cinematic bento. Each tile is a specimen: a status caption, a topic
 * sticker, a title, one sentence and a real link where the feature runs.
 * Pointer position drives a small parallax on the art so the tiles read as
 * depth, and touch pointers never track so a tap cannot leave a tile skewed.
 */
export default function BentoGrid({ tiles }: Props) {
  const track = (e: PointerEvent<HTMLLIElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5;
    const dy = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--px", (dx * 2).toFixed(3));
    el.style.setProperty("--py", (dy * 2).toFixed(3));
  };

  const reset = (e: PointerEvent<HTMLLIElement>) => {
    const el = e.currentTarget;
    el.style.setProperty("--px", "0");
    el.style.setProperty("--py", "0");
  };

  return (
    <ul className="site-bento__grid">
      {tiles.map((t) => (
        <li
          key={t.id}
          className={`site-bento__tile site-bento__tile--${t.id}`}
          data-status={t.status}
          onPointerMove={track}
          onPointerLeave={reset}
        >
          <div className="site-bento__text">
            <p className="site-bento__caption">{t.status}</p>
            <p className="site-bento__sticker">{t.sticker}</p>
            <h3 className="site-bento__title">{t.title}</h3>
            <p className="site-bento__body">{t.body}</p>
            {t.link && (
              <a className="site-bento__link site-focus" href={t.link.href}>
                {t.link.label}
                <span aria-hidden className="site-bento__link-arrow">
                  &rarr;
                </span>
              </a>
            )}
          </div>
          {renderArt(t)}
        </li>
      ))}
    </ul>
  );
}

function renderArt(tile: BentoTileData) {
  switch (tile.art.kind) {
    case "tableau": {
      const [back, front] = tile.art.cards;
      return (
        <div className="site-bento__art site-bento__art--battle">
          <span aria-hidden className="site-bento__aura" />
          <div className="site-bento__parallax">
            <span aria-hidden className="site-bento__shadow" />
            {back && (
              <BentoCard
                card={back}
                className="site-bento__card--tableau-back"
                sizes="(min-width: 1100px) 160px, (min-width: 640px) 140px, 120px"
              />
            )}
            <Image
              className="site-bento__reaver"
              src={tile.art.commander.src}
              alt="The Reaver, a red skull-faced Chog in a violet bucket hat, holding a jagged blade."
              width={tile.art.commander.width}
              height={tile.art.commander.height}
              sizes="(min-width: 1100px) 400px, (min-width: 640px) 300px, 240px"
              draggable={false}
            />
            {front && (
              <BentoCard
                card={front}
                className="site-bento__card--tableau-front"
                sizes="(min-width: 1100px) 190px, (min-width: 640px) 160px, 130px"
              />
            )}
          </div>
          <span className="site-bento__art-caption">
            <span className="site-bento__art-caption-kind">Commander class art</span>
            <span className="site-bento__art-caption-name">{tile.art.commander.name}</span>
          </span>
        </div>
      );
    }
    case "cards":
      return (
        <div className="site-bento__art site-bento__art--deck">
          <div className="site-bento__parallax">
            {tile.art.cards.map((c, i) => (
              <BentoCard
                key={c.id}
                card={c}
                className={`site-bento__card--deck-${i}`}
                sizes="(min-width: 1100px) 190px, (min-width: 640px) 160px, 140px"
              />
            ))}
          </div>
        </div>
      );
    case "card":
      return (
        <div className="site-bento__art site-bento__art--patron">
          <div className="site-bento__parallax">
            <BentoCard
              card={tile.art.card}
              className="site-bento__card--patron"
              sizes="(min-width: 1100px) 150px, (min-width: 640px) 140px, 120px"
            />
          </div>
        </div>
      );
    case "orbit":
      return (
        <div className="site-bento__art site-bento__art--social">
          <div className="site-bento__parallax">
            <svg className="site-bento__motif" viewBox="0 0 200 140" fill="none" aria-hidden focusable="false">
              <circle cx="100" cy="70" r="21" stroke="currentColor" strokeWidth="1.6" opacity=".5" />
              <circle cx="100" cy="70" r="43" stroke="currentColor" strokeWidth="1.6" strokeDasharray="116 24" opacity=".36" />
              <circle cx="100" cy="70" r="64" stroke="currentColor" strokeWidth="1.6" strokeDasharray="86 32" opacity=".24" />
              <circle cx="100" cy="27" r="4.6" fill="currentColor" opacity=".55" />
              <circle cx="139" cy="99" r="3.4" fill="currentColor" opacity=".42" />
              <circle cx="61" cy="103" r="3" fill="currentColor" opacity=".34" />
            </svg>
          </div>
        </div>
      );
    case "exchange":
      return (
        <div className="site-bento__art site-bento__art--lending">
          <div className="site-bento__parallax">
            <svg className="site-bento__motif" viewBox="0 0 200 140" fill="none" aria-hidden focusable="false">
              <rect x="20" y="44" width="52" height="74" rx="11" stroke="currentColor" strokeWidth="1.6" opacity=".44" />
              <rect x="128" y="44" width="52" height="74" rx="11" stroke="currentColor" strokeWidth="1.6" opacity=".44" />
              <path
                d="M76 42 Q100 4 124 42"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeDasharray="3 8"
                strokeLinecap="round"
                opacity=".5"
              />
              <path d="M113 39 L124 42 L127 30" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
            </svg>
          </div>
        </div>
      );
  }
}

/**
 * A Chog card in the site frame. The window keeps the source art's own
 * proportion, so the cards in a tile read as different cards rather than
 * repeated copies of one shape.
 */
function BentoCard({ card, className, sizes }: { card: BentoCardArt; className: string; sizes: string }) {
  return (
    <figure className={`site-bento__card ${className}`}>
      <div className="site-bento__card-frame">
        <div className="site-bento__card-art">
          <Image
            src={card.src}
            alt={`${card.name} card art`}
            width={card.width}
            height={card.height}
            sizes={sizes}
            className="site-bento__card-img"
            draggable={false}
          />
        </div>
        <p className="site-bento__card-cost">
          <span className="sr-only">Cost </span>
          <span className="site-bento__card-cost-num">{card.cost}</span>
          <span className="sr-only"> energy</span>
        </p>
      </div>
    </figure>
  );
}
