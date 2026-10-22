"use client";

// The lobby view (A1). Pure presentation: every value arrives as a plain
// prop, so this component renders the same way from the authenticated
// container and from a static preview with sample data.

import Link from "next/link";
import Image from "next/image";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import Icon from "./icons";
import type { LobbyArt, LobbyViewProps } from "./lobby-types";

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

function Notice({ tone, text, action }: { tone: string; text: string; action?: { label: string; href: string } }) {
  return (
    <div className={`app-notice app-notice--${tone}`}>
      <p className="app-notice__text">{text}</p>
      {action && (
        <Link href={action.href} className="app-notice__action">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export default function LobbyView({
  phase,
  player,
  commander,
  deck,
  deckEmpty,
  notices,
  battleEnabled,
  busy,
  calm,
  status,
  onSignIn,
  onSignOut,
  onRefresh,
}: LobbyViewProps) {
  const noticeList = notices.map((n, i) => (
    <Notice key={`${n.tone}-${i}`} tone={n.tone} text={n.text} action={n.action} />
  ));

  if (phase === "booting") {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate">
            <span className="app-gate__pulse" aria-hidden="true" />
            <h1 className="app-gate__title">Opening the lobby</h1>
            <p className="app-gate__lead">Connecting to the Chog Royale services.</p>
          </div>
        </div>
      </main>
    );
  }

  if (phase === "login") {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate app-rise">
            <span className="app-gate__mark" aria-hidden="true">
              <Icon name="lobby" size={36} />
            </span>
            <h1 className="app-gate__title">Chog Royale</h1>
            <p className="app-gate__lead">
              The lobby is your home base. Sign in to load your commander, your deck and your profile.
            </p>
            <button type="button" className="app-btn app-btn--battle" onClick={onSignIn}>
              <Icon name="user" size={22} />
              Log in
            </button>
            <p className="app-gate__note">Sign-in runs through Privy. New players finish profile setup straight after.</p>
            {noticeList.length > 0 && <div className="app-gate__notices">{noticeList}</div>}
          </div>
        </div>
      </main>
    );
  }

  if (phase === "profile") {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate app-rise">
            <span className="app-gate__mark app-gate__mark--warn" aria-hidden="true">
              <Icon name="lock" size={32} />
            </span>
            <h1 className="app-gate__title">The lobby could not open your profile</h1>
            {noticeList.length > 0 ? (
              <div className="app-gate__notices">{noticeList}</div>
            ) : (
              <p className="app-gate__lead">Your account could not be read.</p>
            )}
            <div className="app-gate__actions">
              <button type="button" className="app-btn app-btn--battle" onClick={onRefresh} disabled={busy}>
                {busy ? "Checking" : "Try again"}
              </button>
              <button type="button" className="app-btn app-btn--ghost" onClick={onSignOut}>
                <Icon name="logout" size={16} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <AppHud player={player} onSignOut={onSignOut} />

      <main className={`app-stage${calm ? " app-calm" : ""}`}>
        <div className="app-column">
          {noticeList.length > 0 && <div className="app-column__notices">{noticeList}</div>}

          <section className="app-panel app-commander app-rise" aria-labelledby="app-commander-title">
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
                  priority
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
              <h1 className="app-commander__title" id="app-commander-title">
                {commander?.resolved ? commander.className : "Unresolved"}
              </h1>
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

          <section
            className="app-panel app-deck app-rise"
            aria-labelledby="app-deck-title"
            style={{ animationDelay: "90ms" }}
          >
            <div className="app-deck__head">
              <h2 className="app-deck__label" id="app-deck-title">
                Battle deck
              </h2>
              <Link href="/app/decks" className="app-deck__edit">
                Edit deck
              </Link>
            </div>

            <p className="app-deck__meta">
              {deck && deck.cards.length > 0 ? (
                <>
                  {deck.cards.length} cards
                  {deck.averageCost !== null ? ` · avg cost ${deck.averageCost}` : ""}
                </>
              ) : (
                "Not saved"
              )}
            </p>

            {deck && deck.cards.length > 0 ? (
              <ul className="app-deck__rail">
                {deck.cards.map((card) => (
                  <li key={card.id} className={`app-card app-card--${card.kind}`}>
                    <span className="app-card__gem">
                      <span className="app-card__gem-num" aria-hidden="true">
                        {card.cost}
                      </span>
                      <span className="app-sr">Deploy cost {card.cost}</span>
                    </span>
                    <span className="app-card__art">
                      {card.art ? (
                        <Plate
                          art={card.art}
                          alt=""
                          className="app-card__img"
                          sizes="(max-width: 639px) 72px, 82px"
                        />
                      ) : (
                        <span className="app-card__initial" aria-hidden="true">
                          {card.name.charAt(0)}
                        </span>
                      )}
                    </span>
                    <span className="app-card__name">{card.name}</span>
                    <span className="app-card__type">{card.typeLabel}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="app-empty">
                <Icon name="decks" size={26} />
                <p className="app-empty__title">
                  {deckEmpty?.title ?? "No deck saved yet"}
                </p>
                <p className="app-empty__body">
                  {deckEmpty?.body ??
                    "Your saved deck appears here once you build one on the deck screen. Nothing is guessed in its place."}
                </p>
              </div>
            )}
          </section>

          <section
            className="app-panel app-battle app-rise"
            aria-labelledby="app-battle-title"
            style={{ animationDelay: "180ms" }}
          >
            <h2 className="app-sr" id="app-battle-title">
              Battle
            </h2>
            <div className="app-battle__row">
              {battleEnabled ? (
                <Link href="/dev/battle" className="app-btn app-btn--battle">
                  <Icon name="swords" size={26} />
                  Battle
                </Link>
              ) : (
                <div className="app-battle__closed">
                  <Icon name="lock" size={20} />
                  <p className="app-battle__closed-title">Closed alpha</p>
                  <p className="app-battle__closed-body">The battle is not open in this build.</p>
                </div>
              )}
              <button type="button" className="app-btn app-btn--ghost" onClick={onRefresh} disabled={busy}>
                <Icon name="refresh" size={16} />
                {busy ? "Refreshing" : "Refresh"}
              </button>
            </div>
            <p className="app-battle__status" role="status" aria-live="polite">
              {status}
            </p>
          </section>
        </div>

        <AppNav />
      </main>
    </>
  );
}
