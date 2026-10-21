import Image from "next/image";
import type { SiteCard } from "./site-cards";

interface Props {
  card: SiteCard;
  /** Spoken name for the art. */
  alt: string;
  /** Honest label for the art, e.g. "Troop" or "Commander class art". */
  kind: string;
  sizes: string;
}

/**
 * Compact Chog card tile for the L5 feature grid. Same frame, art window and
 * cost gem as the full card, reduced to what stays legible at 104px. The card
 * name and the art's honest label sit under the tile instead of inside it.
 */
export default function ChogCardMini({ card, alt, kind, sizes }: Props) {
  return (
    <figure className="site-mini">
      <div className="site-mini__frame">
        <div className="site-mini__art">
          <Image src={card.art.src} alt={alt} width={card.art.width} height={card.art.height} sizes={sizes} className="site-mini__img" draggable={false} />
        </div>
        <p className="site-mini__cost">
          <span className="sr-only">Cost </span>
          <span className="site-mini__cost-num">{card.cost}</span>
          <span className="sr-only"> energy</span>
        </p>
      </div>
      <figcaption className="site-mini__caption">
        <span className="site-mini__name">{card.name}</span>
        <span className="site-mini__kind">{kind}</span>
      </figcaption>
    </figure>
  );
}
