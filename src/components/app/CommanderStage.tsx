"use client";

// The commander stage, shared by the lobby and the profile.
//
// It was extracted from the lobby view unchanged: the same arena scene layers,
// aura, disc, shadow, shared class art and meta rows. The only new inputs are
// the heading id (two screens can be mounted in one app shell), the priority
// flag for the one image that is a screen's LCP candidate, and an extra class
// so a screen can adjust the frame without touching this markup.
//
// The stage always renders the missing state when the commander could not be
// resolved, so no screen has to invent one.

import Image from "next/image";
import Icon from "./icons";
import type { LobbyArt, LobbyCommander } from "./lobby-types";

const ARENA_LAYER = "/assets/arena/chaos-crossing/v002/layers";

/** Approved art rendered at its own intrinsic size. */
function Plate({
  art,
  alt,
  className,
  sizes,
  unoptimized,
  priority,
}: {
  art: LobbyArt;
  alt: string;
  className: string;
  sizes?: string;
  unoptimized?: boolean;
  /** Preload, for the one image that is the page's LCP candidate. */
  priority?: boolean;
}) {
  return (
    <Image
      src={art.src}
      alt={alt}
      width={art.width}
      height={art.height}
      className={className}
      sizes={sizes}
      unoptimized={unoptimized}
      priority={priority}
    />
  );
}

export default function CommanderStage({
  commander,
  titleId = "app-commander-title",
  headingLevel: Heading = "h1",
  priority = true,
  className,
}: {
  commander: LobbyCommander | null;
  /** Heading id, so the section label stays unique per screen. */
  titleId?: string;
  /** The lobby owns the page h1; a screen with its own h1 passes "h2". */
  headingLevel?: "h1" | "h2";
  priority?: boolean;
  /** Extra class for the stage frame on the screen that mounts it. */
  className?: string;
}) {
  return (
    <section
      className={`app-panel app-commander app-rise${className ? ` ${className}` : ""}`}
      aria-labelledby={titleId}
    >
      <div className="app-commander__scene" aria-hidden="true">
        <Image
          src={`${ARENA_LAYER}/background.png`}
          alt=""
          width={600}
          height={920}
          className="app-commander__env app-commander__env--back"
          unoptimized
        />
        <Image
          src={`${ARENA_LAYER}/ambient.png`}
          alt=""
          width={600}
          height={920}
          className="app-commander__env app-commander__env--ambient"
          unoptimized
        />
        <span className="app-commander__aura" />
      </div>

      <div className="app-commander__figure">
        <span className="app-commander__disc" aria-hidden="true" />
        <span className="app-commander__shadow" aria-hidden="true" />
        {commander?.resolved ? (
          <Plate
            art={commander.art}
            alt={`${commander.className} commander class art`}
            className="app-commander__art"
            sizes="(max-width: 1023px) 62vw, 340px"
            priority={priority}
          />
        ) : (
          <div className="app-commander__missing">
            <Icon name="commanders" size={30} />
            <span>No class art</span>
          </div>
        )}
      </div>

      <div className="app-commander__meta">
        <p className="app-commander__eyebrow">{commander?.originLabel ?? "Commander"}</p>
        <Heading className="app-commander__title" id={titleId}>
          {commander?.resolved ? commander.className : "Unresolved"}
        </Heading>
        {commander?.resolved && commander.displayName !== commander.className && (
          <p className="app-commander__name">{commander.displayName}</p>
        )}
        {commander?.resolved && commander.roleShort && (
          <p className="app-commander__role">{commander.roleShort}</p>
        )}
        <div className="app-commander__badges">
          {commander?.resolved && commander.cost > 0 && (
            <span className="app-gem">
              <span className="app-gem__num" aria-hidden="true">
                {commander.cost}
              </span>
              <span className="app-sr">Deploy cost {commander.cost}</span>
            </span>
          )}
          {commander?.resolved && commander.ability && (
            <span className="app-badge">{commander.ability}</span>
          )}
          {commander?.resolved && commander.prestige && commander.prestige !== "Free" && (
            <span className="app-badge app-badge--muted">{commander.prestige}</span>
          )}
        </div>
        {commander?.originNote && <p className="app-caption">{commander.originNote}</p>}
      </div>
    </section>
  );
}
