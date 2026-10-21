import Image from "next/image";
import type { SiteCard } from "./site-cards";

interface Props {
  card: SiteCard;
  face: "up" | "down";
  sizes: string;
  /** Spoken name for the art. Empty when the ribbon already names it. */
  alt?: string;
}

/** DESIGN.md "Chog Card": violet bevel frame, cost gem, name ribbon, crest back. */
export default function ChogCard({ card, face, sizes, alt = "" }: Props) {
  return (
    <div className="chog-card" data-face={face}>
      <div className="chog-card__inner">
        <div className="chog-card__face chog-card__front">
          <div className="chog-card__art">
            <Image src={card.art.src} alt={alt} width={card.art.width} height={card.art.height} sizes={sizes} className="chog-card__img" draggable={false} />
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
  );
}
