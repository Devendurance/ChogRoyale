"use client";

// The player profile view (A3.1). Pure presentation: every value arrives as a
// plain prop, so this component renders the same way from the authenticated
// container and from a static preview with sample data.
//
// The screen reports only what the account endpoints returned. Account XP is a
// separate server-authoritative read, while leaderboard, trophies, currencies
// and rankings remain outside this screen. It never shows a wallet address,
// player id or raw role list.

import Link from "next/link";
import Image from "next/image";
import AccountLevelModule from "./AccountLevelModule";
import AppHud, { AppHudBackLink } from "./AppHud";
import AppNav from "./AppNav";
import AppNotice from "./AppNotice";
import { dedupeNotices } from "./feedback-model";
import CommanderStage from "./CommanderStage";
import Icon from "./icons";
import { accountStatusLabel, onboardingLabel, winRateLabel } from "./profile-model";
import type { ProfileViewProps } from "./profile-types";

export default function ProfileView({
  phase,
  player,
  memberSince,
  verifiedWallets,
  commander,
  commanderStats,
  deck,
  deckState,
  deckNote,
  record,
  recordNote,
  accountLevel,
  notices,
  busy,
  calm,
  status,
  onSignIn,
  onSignOut,
  onRefresh,
}: ProfileViewProps) {
  const noticeList = dedupeNotices(notices).map((n, i) => (
    <AppNotice
      key={`${n.tone}-${i}`}
      tone={n.tone}
      text={n.text}
      action={n.action}
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
            <h1 className="app-gate__title">Opening your profile</h1>
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
              Your profile is your identity in the game. Sign in to load your name, your avatar, your commander class
              and your verified record.
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
            <h1 className="app-gate__title">Your profile could not be opened</h1>
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

  const displayName = player?.displayName || player?.username || "Player";
  const walletText =
    verifiedWallets === 0
      ? "No verified wallet linked"
      : verifiedWallets === 1
        ? "1 verified wallet linked"
        : `${verifiedWallets} verified wallets linked`;

  // The deploy cost is already on the commander stage as a gem, so the class
  // panel shows the combat rows only.
  const classStats = commanderStats.filter((stat) => stat.label !== "Deploy cost");

  return (
    <>
      <AppHud player={player} onSignOut={onSignOut} extra={<AppHudBackLink />} />

      <main className={`app-stage app-stage--wide${calm ? " app-calm" : ""}`}>
        <div className="app-column app-column--wide">
          {noticeList.length > 0 && <div className="app-column__notices">{noticeList}</div>}

          <div className="app-profile">
            <div className="app-profile__account-level">
              <AccountLevelModule accountLevel={accountLevel} />
            </div>

            <div className="app-profile__main">
              <section className="app-panel app-profile-id app-rise" aria-labelledby="app-profile-name">
                <span className="app-profile-id__avatar">
                  {player?.avatarUrl ? (
                    <Image
                      src={player.avatarUrl}
                      alt={player.avatarName ? `${player.avatarName} avatar` : "Player avatar"}
                      width={84}
                      height={84}
                      className="app-profile-id__img"
                      unoptimized
                    />
                  ) : (
                    <span className="app-profile-id__empty" aria-hidden="true">
                      <Icon name="user" size={34} />
                    </span>
                  )}
                </span>

                <div className="app-profile-id__names">
                  <h1 className="app-profile-id__name" id="app-profile-name">
                    {displayName}
                  </h1>
                  <p className="app-profile-id__handle">
                    {player?.username ? `@${player.username}` : "No username yet"}
                  </p>
                  <div className="app-profile-id__chips">
                    <span className="app-badge">{accountStatusLabel(player?.accountStatus)}</span>
                    <span className={`app-badge${verifiedWallets > 0 ? "" : " app-badge--muted"}`}>{walletText}</span>
                  </div>
                </div>
              </section>

              <CommanderStage
                commander={commander}
                titleId="app-profile-commander-title"
                headingLevel="h2"
                className="app-profile-commander"
              />

              <section
                className="app-panel app-profile-class app-rise"
                aria-labelledby="app-profile-class-title"
                style={{ animationDelay: "90ms" }}
              >
                <h2 className="app-profile-panel__title" id="app-profile-class-title">
                  Class detail
                </h2>

                {commander?.resolved ? (
                  <>
                    <p className="app-profile-class__role">{commander.role}</p>

                    {classStats.length > 0 && (
                      <dl className="app-profile-stats">
                        {classStats.map((stat) => (
                          <div
                            key={stat.label}
                            className={`app-profile-stat${stat.label === "Targets" ? " app-profile-stat--wide" : ""}`}
                          >
                            <dt>{stat.label}</dt>
                            <dd>{stat.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {commander.counters.length > 0 && (
                      <div className="app-profile-class__counters">
                        <p className="app-profile-class__counters-label">Counters</p>
                        <div className="app-profile-class__chips">
                          {commander.counters.map((counter) => (
                            <span key={counter} className="app-badge">
                              {counter}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="app-profile-note">Class detail is unavailable for this commander.</p>
                )}
              </section>
            </div>

            <div className="app-profile__side">
              <section
                className="app-panel app-profile-deck app-rise"
                aria-labelledby="app-profile-deck-title"
                style={{ animationDelay: "150ms" }}
              >
                <h2 className="app-profile-panel__title" id="app-profile-deck-title">
                  Battle deck
                </h2>

                {deckState === "ready" && deck && deck.cards.length > 0 ? (
                  <>
                    <p className="app-profile-deck__meta">
                      {deck.cards.length} cards
                      {deck.averageCost !== null ? ` · average cost ${deck.averageCost}` : ""}
                    </p>
                    <ul className="app-profile-deck__list">
                      {deck.cards.map((card) => (
                        <li
                          key={card.id}
                          className={`app-profile-deck__chip${
                            card.kind === "commander" ? " app-profile-deck__chip--commander" : ""
                          }`}
                        >
                          {card.name}
                          {card.kind === "commander" && <span className="app-sr"> (commander)</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="app-profile-note">
                    {deckNote ?? "No deck is saved to your account yet."}
                  </p>
                )}

                <div className="app-profile-actions">
                  <Link href="/app/decks" className="app-btn app-btn--ghost">
                    Open decks
                  </Link>
                </div>
              </section>

              <section
                className="app-panel app-profile-record app-rise"
                aria-labelledby="app-profile-record-title"
                style={{ animationDelay: "210ms" }}
              >
                <h2 className="app-profile-panel__title" id="app-profile-record-title">
                  Record
                </h2>

                {record.state === "ready" ? (
                  <dl className="app-profile-record__rows">
                    <div className="app-profile-record__row">
                      <dt>Matches</dt>
                      <dd>{record.total}</dd>
                    </div>
                    <div className="app-profile-record__row">
                      <dt>Record</dt>
                      <dd>{`${record.wins}W ${record.losses}L ${record.draws}D`}</dd>
                    </div>
                    <div className="app-profile-record__row">
                      <dt>Win rate</dt>
                      <dd>{winRateLabel(record.winRateBp)}</dd>
                    </div>
                    <div className="app-profile-record__row">
                      <dt>Crowns</dt>
                      <dd>{`${record.crownsEarned} earned / ${record.crownsConceded} conceded`}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="app-profile-note">
                    {recordNote ?? (record.state === "empty" ? "No verified matches yet." : "The match record is not available.")}
                  </p>
                )}

                <div className="app-profile-actions">
                  <Link href="/app/progress" className="app-btn app-btn--ghost">
                    Open progress
                  </Link>
                  <Link href="/app/progress/legacy" className="app-btn app-btn--ghost">
                    Genesis legacy
                  </Link>
                </div>
                <p className="app-profile-caption">
                  Your full match history, the Casual Alpha Leaderboard and the Genesis legacy vault live on the
                  progress screen.
                </p>
              </section>

              <section
                className="app-panel app-profile-account app-rise"
                aria-labelledby="app-profile-account-title"
                style={{ animationDelay: "270ms" }}
              >
                <h2 className="app-profile-panel__title" id="app-profile-account-title">
                  Account
                </h2>

                <dl className="app-profile-account__rows">
                  <div className="app-profile-account__row">
                    <dt>Status</dt>
                    <dd>{accountStatusLabel(player?.accountStatus)}</dd>
                  </div>
                  <div className="app-profile-account__row">
                    <dt>Wallets</dt>
                    <dd>{walletText}</dd>
                  </div>
                  <div className="app-profile-account__row">
                    <dt>Member since</dt>
                    <dd>{memberSince ?? "Not available"}</dd>
                  </div>
                  <div className="app-profile-account__row">
                    <dt>Profile setup</dt>
                    <dd>{onboardingLabel(player?.onboardingComplete === true, player?.onboardingNextStep ?? "")}</dd>
                  </div>
                </dl>

                <div className="app-profile-account__actions">
                  <Link href="/app/gifts" className="app-btn app-btn--ghost">Gifting</Link>
                  <Link href="/app/clans" className="app-btn app-btn--ghost">
                    <Icon name="clans" size={16} />
                    Clans
                  </Link>
                  <Link href="/app/loans" className="app-btn app-btn--ghost">
                    <Icon name="commanders" size={16} />
                    Commander lending
                  </Link>
                  <Link href="/app/friends" className="app-btn app-btn--ghost">
                    <Icon name="friends" size={16} />
                    Friends
                  </Link>
                  <Link href="/app/settings" className="app-btn app-btn--ghost">
                    <Icon name="settings" size={16} />
                    Settings
                  </Link>
                  <button type="button" className="app-btn app-btn--ghost" onClick={onRefresh} disabled={busy}>
                    <Icon name="refresh" size={16} />
                    {busy ? "Refreshing" : "Refresh"}
                  </button>
                  <button type="button" className="app-btn app-btn--ghost" onClick={onSignOut}>
                    <Icon name="logout" size={16} />
                    Sign out
                  </button>
                </div>
              </section>
            </div>
          </div>

          <p className="app-sr" role="status" aria-live="polite">
            {status}
          </p>
        </div>

        <AppNav activeId="profile" />
      </main>
    </>
  );
}
