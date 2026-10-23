"use client";

// The play guide (A4.4). Pure presentation: every ruleset value arrives in
// `guide`, which is built on the server from the live combat, commander and
// Chaos definitions. The card roster comes from the app-shell catalog.
//
// The guide explains mechanics only. It carries no levels, upgrades,
// currencies, rarities, rewards or ranked claims.

import Image from "next/image";
import AppHud, { AppHudBackLink } from "./AppHud";
import AppNav from "./AppNav";
import AppNotice from "./AppNotice";
import Icon from "./icons";
import { dedupeNotices } from "./feedback-model";
import {
  formatClock,
  formatCooldown,
  formatSecondsPerPoint,
  groupGuideCards,
} from "./play-guide-model";
import type { PlayGuideViewProps } from "./play-guide-types";

function ArenaMap({ guide }: { guide: PlayGuideViewProps["guide"] }) {
  const side = (label: string) => (
    <div className="app-guide-map__side">
      <span className="app-guide-map__side-label">{label}</span>
      <div className="app-guide-map__line">
        <span className="app-guide-node">
          <Icon name="lobby" size={15} />
          <span>Side tower</span>
        </span>
        <span className="app-guide-node app-guide-node--core">
          <Icon name="energy" size={16} />
          <span>Core</span>
        </span>
        <span className="app-guide-node">
          <Icon name="lobby" size={15} />
          <span>Side tower</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className="app-guide-map" aria-label="Arena layout from your side of the board">
      {side("Opponent side")}
      <div className="app-guide-map__river">
        <span className="app-guide-map__crossing">Bridge</span>
        <span className="app-guide-map__crossing app-guide-map__crossing--ford">Rift Ford</span>
        <span className="app-guide-map__crossing">Bridge</span>
      </div>
      {side("Your side")}
      <p className="app-guide-map__caption">
        {guide.arena.towersPerSide} side towers and {guide.arena.coresPerSide} Core per side. The river has{" "}
        {guide.arena.bridges} bridges. The central Rift Ford opens during a Rift Shift pulse.
      </p>
    </div>
  );
}

export default function PlayGuideView({
  phase,
  player,
  guide,
  catalog,
  notices,
  calm,
  status,
  onSignIn,
  onSignOut,
  onRefresh,
}: PlayGuideViewProps) {
  const noticeList = dedupeNotices(notices).map((notice, index) => (
    <AppNotice
      key={`${notice.tone}-${index}`}
      tone={notice.tone}
      text={notice.text}
      action={notice.action}
      onSignIn={onSignIn}
      onRetry={onRefresh}
    />
  ));

  if (phase === "booting") {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate">
            <span className="app-gate__pulse" aria-hidden="true" />
            <h1 className="app-gate__title">Opening the play guide</h1>
            <p className="app-gate__lead">Reading the live arena, deck and Chaos rules.</p>
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
              <Icon name="guide" size={36} />
            </span>
            <h1 className="app-gate__title">Chog Royale</h1>
            <p className="app-gate__lead">
              The play guide covers the real arena, deck, energy, commander and Chaos rules of the closed alpha. Sign
              in to open it.
            </p>
            <button type="button" className="app-btn app-btn--battle" onClick={onSignIn}>
              <Icon name="user" size={22} />
              Log in
            </button>
            <p className="app-gate__note">Sign-in runs through Privy. The guide reads no wallet or token ownership.</p>
            {noticeList.length > 0 && <div className="app-gate__notices">{noticeList}</div>}
          </div>
        </div>
      </main>
    );
  }

  const cards = Object.values(catalog.cards);
  const cardGroups = groupGuideCards(cards);
  const facts = [
    `${guide.deck.ordinaryCards} + ${guide.deck.commanderCards} deck`,
    `${guide.energy.max} energy cap`,
    `${formatClock(guide.timeline.regulationSeconds)} regulation`,
    `${guide.chaos.pulseTimesSeconds.length} Chaos Pulses`,
    `${guide.deck.commanderClasses} free classes`,
  ];

  return (
    <>
      <AppHud player={player} onSignOut={onSignOut} extra={<AppHudBackLink />} />

      <main className={`app-stage app-stage--wide${calm ? " app-calm" : ""}`}>
        <div className="app-column app-column--wide">
          {noticeList.length > 0 && <div className="app-column__notices">{noticeList}</div>}

          <header className="app-guide-head app-rise">
            <p className="app-guide-head__eyebrow">Field manual</p>
            <h1 className="app-guide-head__title">Play Guide</h1>
            <p className="app-guide-head__lead">
              Chog Royale is a real-time duel. Build a deck, deploy units and spells for energy, and break the enemy
              Core before they break yours. This guide uses the live ruleset, not a simplified mock-up.
            </p>
            <ul className="app-guide-facts" aria-label="Key rules">
              {facts.map((fact) => (
                <li key={fact} className="app-guide-fact">
                  {fact}
                </li>
              ))}
            </ul>
          </header>

          <div className="app-guide-grid">
            <section className="app-panel app-guide-panel app-rise" aria-labelledby="app-guide-objective-title">
              <h2 className="app-profile-panel__title" id="app-guide-objective-title">
                Match objective
              </h2>
              <p className="app-guide-lead">Take the enemy Core, or finish regulation with the crown lead.</p>
              <ul className="app-guide-rules">
                <li>
                  <span className="app-guide-num">{guide.crowns.perTower}</span>
                  <span>crown for each enemy side tower destroyed.</span>
                </li>
                <li>
                  <span className="app-guide-num">{guide.crowns.coreWin}</span>
                  <span>crowns and an instant win for destroying the enemy Core.</span>
                </li>
                <li>
                  <span className="app-guide-num">{formatClock(guide.timeline.regulationSeconds)}</span>
                  <span>regulation ends. The side with more crowns wins.</span>
                </li>
                <li>
                  <span className="app-guide-num">OT</span>
                  <span>
                    If crowns are tied, sudden-death overtime runs for up to {formatClock(guide.timeline.overtimeSeconds)}.
                    The first side tower destroyed wins. If time expires, more surviving towers, then tower HP, then Core
                    HP decides it.
                  </span>
                </li>
              </ul>
            </section>

            <section className="app-panel app-guide-panel app-rise" aria-labelledby="app-guide-arena-title">
              <h2 className="app-profile-panel__title" id="app-guide-arena-title">
                The arena
              </h2>
              <ArenaMap guide={guide} />
              <dl className="app-guide-stats">
                <div>
                  <dt>Side tower</dt>
                  <dd>
                    {guide.arena.towerHp} HP, {guide.arena.towerDamage} damage every{" "}
                    {formatSecondsPerPoint(guide.arena.attackIntervalSeconds)}, range {guide.arena.towerRange}
                  </dd>
                </div>
                <div>
                  <dt>Core</dt>
                  <dd>
                    {guide.arena.coreHp} HP, {guide.arena.coreDamage} damage every{" "}
                    {formatSecondsPerPoint(guide.arena.attackIntervalSeconds)}, range {guide.arena.coreRange}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="app-panel app-guide-panel app-rise" aria-labelledby="app-guide-clock-title">
              <h2 className="app-profile-panel__title" id="app-guide-clock-title">
                Match clock
              </h2>
              <ol className="app-guide-timeline">
                <li>
                  <span className="app-guide-time">{formatClock(0)}</span>
                  <span>
                    Match starts. Each side begins with {guide.energy.start} energy and {guide.deck.handSize} cards in
                    hand.
                  </span>
                </li>
                <li>
                  <span className="app-guide-time">{formatClock(guide.timeline.doubleEnergyAtSeconds)}</span>
                  <span>Energy regeneration doubles.</span>
                </li>
                <li>
                  <span className="app-guide-time">{formatClock(guide.timeline.regulationSeconds)}</span>
                  <span>Regulation ends. A crown lead wins. A tie starts sudden-death overtime.</span>
                </li>
                <li>
                  <span className="app-guide-time">{formatClock(guide.timeline.tripleEnergyAtSeconds)}</span>
                  <span>Energy regeneration triples.</span>
                </li>
                <li>
                  <span className="app-guide-time">{formatClock(guide.timeline.maxSeconds)}</span>
                  <span>Overtime ends. The tower and Core tiebreak decides the winner, or the match is a draw.</span>
                </li>
              </ol>
            </section>

            <section className="app-panel app-guide-panel app-rise" aria-labelledby="app-guide-energy-title">
              <h2 className="app-profile-panel__title" id="app-guide-energy-title">
                Energy and deployment
              </h2>
              <p className="app-guide-lead">
                Energy is the only battle resource. Every card spends it when deployed.
              </p>
              <ul className="app-guide-rules">
                <li>
                  <span className="app-guide-num">{guide.energy.max}</span>
                  <span>energy cap. Start with {guide.energy.start} and gain 1 every{" "}
                    {formatSecondsPerPoint(guide.energy.secondsPerPoint)} at 1x speed.</span>
                </li>
                <li>
                  <span className="app-guide-num">2x</span>
                  <span>regeneration from {formatClock(guide.timeline.doubleEnergyAtSeconds)}.</span>
                </li>
                <li>
                  <span className="app-guide-num">3x</span>
                  <span>regeneration from {formatClock(guide.timeline.tripleEnergyAtSeconds)}.</span>
                </li>
              </ul>
              <p className="app-profile-note">
                Troops, buildings and commanders deploy in your own territory. Spells can be cast across the arena. You
                cannot deploy on the river, a bridge, or a live structure. Destroying an enemy side tower opens a{" "}
                {guide.arena.pocketDepth}-row forward pocket in that lane.
              </p>
            </section>

            <section className="app-panel app-guide-panel app-rise" aria-labelledby="app-guide-deck-title">
              <h2 className="app-profile-panel__title" id="app-guide-deck-title">
                Commander and deck
              </h2>
              <p className="app-guide-lead">
                Your deck is {guide.deck.ordinaryCards} ordinary cards plus {guide.deck.commanderCards} commander. You
                hold {guide.deck.handSize} cards at a time.
              </p>
              <ul className="app-guide-rules">
                <li>
                  <span className="app-guide-num">1</span>
                  <span>commander may be in play at a time. Its card is held while it lives.</span>
                </li>
                <li>
                  <span className="app-guide-num">Free</span>
                  <span>
                    starters and Genesis commanders of the same class use identical class combat numbers.
                  </span>
                </li>
                <li>
                  <span className="app-guide-num">Auto</span>
                  <span>deploy and on-death abilities fire themselves. Active abilities are pressed by the player.</span>
                </li>
              </ul>
              <div className="app-guide-abilities">
                {guide.abilities.map((ability) => {
                  const commander = catalog.commanders.find((c) => c.classId === ability.classId) ?? null;
                  return (
                    <article key={ability.classId} className="app-guide-ability">
                      <span className="app-guide-ability__art">
                        {commander ? (
                          <Image
                            src={commander.commanderCardArt.src}
                            alt={`${ability.className} commander class art`}
                            width={48}
                            height={48}
                            className="app-guide-ability__img"
                            unoptimized
                          />
                        ) : (
                          <Icon name="commanders" size={24} />
                        )}
                      </span>
                      <div className="app-guide-ability__body">
                        <p className="app-guide-ability__class">{ability.className}</p>
                        <p className="app-guide-ability__name">{ability.ability}</p>
                        <p className="app-guide-ability__meta">
                          {ability.cost === null ? "Cost not listed" : `${ability.cost} energy`} ·{" "}
                          {formatCooldown(ability.cooldownSeconds)}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="app-panel app-guide-panel app-rise" aria-labelledby="app-guide-chaos-title">
              <h2 className="app-profile-panel__title" id="app-guide-chaos-title">
                Chaos Pulses and the Arena Patron
              </h2>
              <p className="app-guide-lead">
                {guide.chaos.pulseTimesSeconds.length} pulses are scheduled at{" "}
                {guide.chaos.pulseTimesSeconds.map((seconds) => formatClock(seconds)).join(", ")}. Each is telegraphed{" "}
                {guide.chaos.warnMinSeconds === guide.chaos.warnMaxSeconds
                  ? `${guide.chaos.warnMinSeconds}s`
                  : `${guide.chaos.warnMinSeconds}-${guide.chaos.warnMaxSeconds}s`}{" "}
                before it activates.
              </p>
              <ul className="app-guide-chaos">
                {guide.chaos.families.map((family) => (
                  <li key={family.id} className="app-guide-chaos__item">
                    <span className="app-guide-chaos__name">{family.name}</span>
                    <span className="app-guide-chaos__effect">{family.effect}</span>
                  </li>
                ))}
              </ul>
              <p className="app-profile-note">
                The Arena Patron is a Chog Genesis token selected by the server for the match. Its background theme sets
                the first pulse family. It is not a deck commander, grants no combat stats, and its Tier only names the
                pulse. Its effects apply to both players equally.
              </p>
            </section>

            <section className="app-panel app-guide-panel app-rise" aria-labelledby="app-guide-modes-title">
              <h2 className="app-profile-panel__title" id="app-guide-modes-title">
                Supported modes
              </h2>
              <div className="app-guide-modes">
                {guide.modes.map((mode) => (
                  <article key={mode.id} className="app-guide-mode">
                    <span className="app-badge">{mode.tag}</span>
                    <h3 className="app-guide-mode__name">{mode.name}</h3>
                    <p className="app-guide-mode__summary">{mode.summary}</p>
                    <p className="app-profile-caption">{mode.detail}</p>
                  </article>
                ))}
              </div>
              <p className="app-guide-alpha">
                Closed alpha. This build has no levels, card upgrades, currencies, ranked ladder or rewards. The free
                classes and Genesis commanders share the same class combat rules.
              </p>
            </section>
          </div>

          <section className="app-guide-roster app-rise" aria-labelledby="app-guide-roster-title">
            <div className="app-gallery-section__head">
              <h2 className="app-gallery-section__title" id="app-guide-roster-title">
                Card roster
              </h2>
              <p className="app-gallery-section__lead">
                {guide.deck.cardCount} ordinary cards from the live ruleset. Card text and costs are the same values the
                deck builder and the battle server use.
              </p>
            </div>

            {cardGroups.map((group) => (
              <div key={group.kind} className="app-guide-card-group">
                <h3 className="app-guide-card-group__title">
                  {group.label}
                  <span className="app-guide-card-group__count">{group.cards.length}</span>
                </h3>
                <ul className="app-guide-cards">
                  {group.cards.map((card) => (
                    <li key={card.id} className="app-guide-card">
                      <span className="app-guide-card__cost" aria-hidden="true">
                        {card.cost}
                      </span>
                      <span className="app-sr">Energy cost {card.cost}</span>
                      <div className="app-guide-card__body">
                        <p className="app-guide-card__name">{card.name}</p>
                        <p className="app-guide-card__type">{card.typeLabel}</p>
                        <p className="app-guide-card__text">{card.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <p className="app-guide-source">
            Rules values are read directly from the live combat and Chaos definitions. The card roster is the same
            catalog used by the deck builder.
          </p>

          <p className="app-sr" role="status" aria-live="polite">
            {status}
          </p>
        </div>

        <AppNav activeId="guide" />
      </main>
    </>
  );
}
