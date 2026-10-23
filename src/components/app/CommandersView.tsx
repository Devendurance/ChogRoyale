"use client";

// The commanders gallery (A4.2). Pure presentation: every value arrives as a
// plain prop, so the same view renders from the authenticated container or a
// clearly labelled fixture.
//
// The five free classes are ruleset data. Genesis entries are cached
// eligibility observations, never ownership proof, and a token image is only
// shown when the API resolved an authorized URL. Browsing never writes a deck.

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import AppHud, { AppHudBackLink } from "./AppHud";
import AppNav from "./AppNav";
import AppNotice from "./AppNotice";
import CommanderStage from "./CommanderStage";
import Icon from "./icons";
import type { GalleryClass, GalleryGenesis, CommandersViewProps } from "./commanders-types";

function GenesisArt({ entry }: { entry: GalleryGenesis }) {
  const [failed, setFailed] = useState(false);
  const tokenArt = entry.imageUrl && !failed ? entry.imageUrl : null;
  const fallback = entry.cardArt;

  if (!tokenArt && !fallback) {
    return (
      <span className="app-gallery-card__placeholder" aria-hidden="true">
        <Icon name="commanders" size={28} />
      </span>
    );
  }

  return (
    <Image
      src={tokenArt ?? fallback!.src}
      alt={tokenArt ? `${entry.name} token art` : `${entry.className} class art`}
      width={256}
      height={256}
      className={`app-gallery-card__img${tokenArt ? " app-gallery-card__img--token" : " app-gallery-card__img--class"}`}
      sizes="(max-width: 640px) 42vw, 170px"
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}

function FreeCard({
  item,
  active,
  onSelect,
}: {
  item: GalleryClass;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`app-gallery-card app-gallery-card--free${active ? " app-gallery-card--active" : ""}`}
        aria-pressed={active}
        onClick={onSelect}
      >
        <span className="app-gallery-card__art">
          <Image
            src={item.cardArt.src}
            alt={`${item.className} class art`}
            width={item.cardArt.width}
            height={item.cardArt.height}
            className="app-gallery-card__img app-gallery-card__img--class"
            sizes="(max-width: 640px) 42vw, 170px"
            unoptimized
          />
          {active && (
            <span className="app-gallery-card__active" aria-hidden="true">
              <Icon name="check" size={14} />
            </span>
          )}
        </span>
        <span className="app-gallery-card__badge">Free class</span>
        <span className="app-gallery-card__name">{item.freeName}</span>
        <span className="app-gallery-card__class">
          {item.className} · {item.cost} energy
        </span>
        <span className="app-gallery-card__role">{item.roleShort}</span>
      </button>
    </li>
  );
}

function GenesisCard({
  entry,
  active,
  onSelect,
}: {
  entry: GalleryGenesis;
  active: boolean;
  onSelect: () => void;
}) {
  const stateLabel = entry.eligible
    ? "Eligible, cached check"
    : entry.status === "pending"
      ? "Commander not derived"
      : "Eligibility unproven";

  return (
    <li>
      <button
        type="button"
        className={`app-gallery-card app-gallery-card--genesis${active ? " app-gallery-card--active" : ""}${
          entry.eligible ? "" : " app-gallery-card--unproven"
        }`}
        aria-pressed={active}
        onClick={onSelect}
      >
        <span className="app-gallery-card__art">
          <GenesisArt entry={entry} />
          {active && (
            <span className="app-gallery-card__active" aria-hidden="true">
              <Icon name="check" size={14} />
            </span>
          )}
        </span>
        <span className="app-gallery-card__badge app-gallery-card__badge--nft">Genesis</span>
        <span className="app-gallery-card__name">{entry.name}</span>
        <span className="app-gallery-card__class">
          {entry.className}
          {entry.cost !== null ? ` · ${entry.cost} energy` : ""}
        </span>
        <span className={`app-gallery-card__state${entry.eligible ? "" : " app-gallery-card__state--warn"}`}>
          {stateLabel}
        </span>
      </button>
    </li>
  );
}

function DetailPanel({ selected, classes }: { selected: CommandersViewProps["selected"]; classes: GalleryClass[] }) {
  if (!selected) return null;
  const classItem =
    selected.classItem ?? classes.find((c) => c.classId === selected.genesis?.classId) ?? null;
  const genesis = selected.genesis;

  if (!classItem && !genesis) return null;

  return (
    <section className="app-panel app-gallery-detail app-rise" aria-labelledby="app-gallery-detail-title">
      <h2 className="app-profile-panel__title" id="app-gallery-detail-title">
        {genesis ? "Genesis commander" : "Class details"}
      </h2>

      {genesis && (
        <div className="app-gallery-token">
          <p className="app-gallery-token__name">{genesis.name}</p>
          <p className="app-gallery-token__id">Chog Genesis #{genesis.tokenId}</p>
          <p className={`app-gallery-token__state${genesis.eligible ? "" : " app-gallery-token__state--warn"}`}>
            {genesis.eligible
              ? "Eligible from a cached ownership observation."
              : genesis.status === "pending"
                ? "This token's commander definition has not been derived yet."
                : "Ownership is not proven for this token right now."}
          </p>
          {genesis.reason && <p className="app-profile-note">{genesis.reason}</p>}
          <p className="app-gallery-token__note">{genesis.artNote}</p>
        </div>
      )}

      {classItem ? (
        <>
          <p className="app-profile-class__role">{classItem.role}</p>

          <div className="app-gallery-facts">
            <div className="app-gallery-fact">
              <p className="app-profile-class__counters-label">Active ability</p>
              <p className="app-gallery-fact__value">{classItem.ability ?? "No active ability is authored for this class."}</p>
            </div>
            <div className="app-gallery-fact">
              <p className="app-profile-class__counters-label">Counters</p>
              <div className="app-profile-class__chips">
                {classItem.counters.length > 0 ? (
                  classItem.counters.map((counter) => (
                    <span key={counter} className="app-badge">
                      {counter}
                    </span>
                  ))
                ) : (
                  <span className="app-gallery-fact__value">No counters are authored for this class.</span>
                )}
              </div>
            </div>
          </div>

          {classItem.stats.length > 0 && (
            <dl className="app-profile-stats">
              {classItem.stats
                .filter((stat) => stat.label !== "Deploy cost")
                .map((stat) => (
                  <div key={stat.label} className="app-profile-stat">
                    <dt>{stat.label}</dt>
                    <dd>{stat.value}</dd>
                  </div>
                ))}
            </dl>
          )}

          {!genesis && <p className="app-profile-caption">{classItem.artNote}</p>}
          {genesis && (
            <p className="app-profile-caption">
              A Genesis {classItem.className} commander uses the same class numbers as the free {classItem.className}{" "}
              starter. The battle server checks this token&apos;s ownership again at ready and at match start.
            </p>
          )}
        </>
      ) : (
        <p className="app-profile-note">
          This token has no derived commander class yet, so no class description, ability or combat rows are shown.
        </p>
      )}

      <div className="app-profile-actions">
        <Link href="/app/decks" className="app-btn app-btn--ghost">
          Open decks
        </Link>
      </div>
      <p className="app-profile-caption">Browsing this gallery does not change the commander saved in your deck.</p>
    </section>
  );
}

export default function CommandersView({
  phase,
  player,
  classes,
  genesis,
  selected,
  featured,
  notices,
  busy,
  calm,
  status,
  onSignIn,
  onSignOut,
  onRefresh,
  onSelect,
}: CommandersViewProps) {
  const noticeList = notices.map((n, i) => (
    <AppNotice key={`${n.tone}-${i}`} tone={n.tone} text={n.text} action={n.action} />
  ));

  if (phase === "booting") {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate">
            <span className="app-gate__pulse" aria-hidden="true" />
            <h1 className="app-gate__title">Opening the commanders gallery</h1>
            <p className="app-gate__lead">Reading the free classes and your Genesis eligibility.</p>
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
              <Icon name="commanders" size={36} />
            </span>
            <h1 className="app-gate__title">Chog Royale</h1>
            <p className="app-gate__lead">
              The five free commander classes are always available. Sign in to check whether a Chog Genesis commander
              is linked to your verified wallets.
            </p>
            <button type="button" className="app-btn app-btn--battle" onClick={onSignIn}>
              <Icon name="user" size={22} />
              Log in
            </button>
            <p className="app-gate__note">Sign-in runs through Privy. No wallet or token ownership is assumed before it.</p>
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
            <h1 className="app-gate__title">The commanders gallery could not be opened</h1>
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
      <AppHud player={player} onSignOut={onSignOut} extra={<AppHudBackLink />} />

      <main className={`app-stage app-stage--wide${calm ? " app-calm" : ""}`}>
        <div className="app-column app-column--wide">
          {noticeList.length > 0 && <div className="app-column__notices">{noticeList}</div>}

          <header className="app-gallery-head app-rise">
            <div className="app-gallery-head__text">
              <p className="app-gallery-head__eyebrow">Roster</p>
              <h1 className="app-gallery-head__title">Commanders</h1>
              <p className="app-gallery-head__lead">
                Five free classes, always ready to field. Genesis commanders appear only when your verified wallets
                report a token.
              </p>
            </div>
            <button type="button" className="app-btn app-btn--ghost" onClick={onRefresh} disabled={busy}>
              <Icon name="refresh" size={16} />
              {busy ? "Refreshing" : "Refresh"}
            </button>
          </header>

          <div className="app-gallery">
            <div className="app-gallery__hero">
              <CommanderStage
                commander={featured}
                titleId="app-gallery-featured-title"
                headingLevel="h2"
                className="app-gallery__stage"
              />
            </div>

            <div className="app-gallery__detail">
              <DetailPanel selected={selected} classes={classes} />
            </div>

            <section className="app-gallery-roster app-rise" aria-labelledby="app-gallery-free-title">
              <div className="app-gallery-section__head">
                <h2 className="app-gallery-section__title" id="app-gallery-free-title">
                  Free classes
                </h2>
                <p className="app-gallery-section__lead">
                  Every class is a free starter. Choose one of these in the deck builder.
                </p>
              </div>
              <ul className="app-gallery-grid">
                {classes.map((item) => (
                  <FreeCard
                    key={item.key}
                    item={item}
                    active={selected?.kind === "free" && selected.key === item.key}
                    onSelect={() => onSelect(item.key)}
                  />
                ))}
              </ul>
            </section>

            <section className="app-gallery-roster app-rise" aria-labelledby="app-gallery-genesis-title">
              <div className="app-gallery-section__head">
                <h2 className="app-gallery-section__title" id="app-gallery-genesis-title">
                  Genesis commanders
                </h2>
                <p className="app-gallery-section__lead">{genesis.note}</p>
              </div>

              {genesis.entries.length > 0 && (
                <ul className="app-gallery-grid">
                  {genesis.entries.map((entry) => (
                    <GenesisCard
                      key={entry.key}
                      entry={entry}
                      active={selected?.kind === "nft" && selected.key === entry.key}
                      onSelect={() => onSelect(entry.key)}
                    />
                  ))}
                </ul>
              )}

              {genesis.state === "ready" && (
                <p className="app-gallery-genesis__note">
                  Cached eligibility is a browsing observation. The battle server re-checks the token when you ready up
                  and again at match start. Selecting an NFT commander in the deck builder records a claim, not proof.
                </p>
              )}
            </section>
          </div>

          <p className="app-sr" role="status" aria-live="polite">
            {status}
          </p>
        </div>

        <AppNav activeId="commanders" />
      </main>
    </>
  );
}
