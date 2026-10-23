"use client";

// The progress view (A3.2a). Pure presentation: every value arrives as a plain
// prop, so the same screen renders from the authenticated container and from a
// bounded presentation fixture.
//
// The screen shows only what the stats, match history and casual leaderboard
// endpoints returned. A failed read is never drawn as zero. It carries no
// trophies, XP, levels, currencies, streaks or ranked ladder.

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import AppHud, { AppHudBackLink } from "./AppHud";
import AppNav from "./AppNav";
import AppNotice from "./AppNotice";
import { dedupeNotices } from "./feedback-model";
import Icon from "./icons";
import { winRateLabel } from "./profile-model";
import { formatRecordDate, matchesToQualify, resolveStanding } from "./progress-model";
import type {
  BoardEntryView,
  MatchRow,
  ProgressReadState,
  ProgressViewProps,
  StatsSummary,
} from "./progress-types";

interface HeroMetric {
  value: string;
  label: string;
  record: string;
  caption: string;
}

/** The crown stays local to the record screen, so the shared nav icon set is untouched. */
function CrownGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.6 8.2l4.3 3.4L12 5l4.1 6.6 4.3-3.4-1.7 9.6H5.3L3.6 8.2z" />
      <path d="M5.6 20h12.8" />
    </svg>
  );
}

function heroMetric(stats: StatsSummary): HeroMetric {
  switch (stats.state) {
    case "ready":
      return {
        value: winRateLabel(stats.winRateBp),
        label: "win rate",
        record: `${stats.wins}W ${stats.losses}L ${stats.draws}D`,
        caption: `${stats.total} settled match${stats.total === 1 ? "" : "es"}.`,
      };
    case "empty":
      return {
        value: "0",
        label: "settled matches",
        record: "No results yet",
        caption: "Settled results appear after your first completed battle.",
      };
    case "locked":
      return {
        value: "n/a",
        label: "record locked",
        record: "Profile setup incomplete",
        caption: "Finish profile setup to unlock the verified record.",
      };
    case "auth":
      return {
        value: "n/a",
        label: "session expired",
        record: "Sign in again",
        caption: "Sign out and sign back in to load the record.",
      };
    default:
      return {
        value: "n/a",
        label: "record unavailable",
        record: "Service unavailable",
        caption: "The stats service did not answer. This is not a zero-match result.",
      };
  }
}

function stateCopy(state: ProgressReadState, kind: "stats" | "history" | "board"): { label: string; title: string; body: string } {
  if (kind === "stats") {
    if (state === "empty") {
      return {
        label: "No records yet",
        title: "No verified matches yet",
        body: "Your record starts after your first completed battle.",
      };
    }
    if (state === "locked") {
      return {
        label: "Locked",
        title: "Stats are locked",
        body: "Finish profile setup to load your verified record.",
      };
    }
    if (state === "auth") {
      return {
        label: "Session expired",
        title: "Sign in again to load your stats",
        body: "Your session is no longer valid, so the record could not be read.",
      };
    }
    return {
      label: "Service unavailable",
      title: "Stats aren't available yet",
      body: "The record service did not answer, so your stats are unknown. This is not a zero-match result.",
    };
  }

  if (kind === "history") {
    if (state === "empty") {
      return {
        label: "No saved matches",
        title: "Your first result will appear here",
        body: "Settled matchmaking and private-room results are saved after a completed battle.",
      };
    }
    if (state === "locked") {
      return {
        label: "Locked",
        title: "Match history is locked",
        body: "Finish profile setup to load your saved matches.",
      };
    }
    if (state === "auth") {
      return {
        label: "Session expired",
        title: "Sign in again to load your matches",
        body: "Your session is no longer valid, so saved matches could not be read.",
      };
    }
    return {
      label: "Service unavailable",
      title: "Match history isn't available yet",
      body: "The match service did not answer. This is not an empty history.",
    };
  }

  if (state === "empty") {
    return {
      label: "No qualifiers yet",
      title: "Nobody has qualified yet",
      body: "A player appears after meeting the matchmaking minimum.",
    };
  }
  if (state === "locked") {
    return {
      label: "Locked",
      title: "The casual leaderboard is locked",
      body: "Finish profile setup to load the standings.",
    };
  }
  if (state === "auth") {
    return {
      label: "Session expired",
      title: "Sign in again to load the standings",
      body: "Your session is no longer valid, so the board could not be read.",
    };
  }
  return {
    label: "Service unavailable",
    title: "The casual leaderboard isn't available yet",
    body: "The standings service did not answer. This is not an empty board.",
  };
}

function StatePlate({
  tone,
  label,
  title,
  body,
  action,
}: {
  tone: ProgressReadState;
  label: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className={`app-progress-state app-progress-state--${tone}`}>
      <p className="app-progress-state__label">{label}</p>
      <p className="app-progress-state__title">{title}</p>
      <p className="app-progress-state__body">{body}</p>
      {action && <div className="app-progress-state__action">{action}</div>}
    </div>
  );
}

function PanelHead({
  eyebrow,
  title,
  titleId,
  aside,
}: {
  eyebrow: string;
  title: string;
  titleId?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="app-progress-panel__head">
      <div className="app-progress-panel__heading">
        <p className="app-progress-kicker">{eyebrow}</p>
        <h2 className="app-progress-title" id={titleId}>
          {title}
        </h2>
      </div>
      {aside}
    </div>
  );
}

function SplitRow({ label, split, board }: { label: string; split: { matches: number; wins: number; losses: number; draws: number }; board: boolean }) {
  return (
    <div className="app-progress-split__row">
      <div className="app-progress-split__head">
        <span className="app-progress-split__name">{label}</span>
        <span className={`app-progress-tag${board ? " app-progress-tag--on" : ""}`}>
          {board ? "Board counts" : "No board"}
        </span>
      </div>
      <p className="app-progress-split__line">
        <strong>{split.matches}</strong> match{split.matches === 1 ? "" : "es"}
        <span aria-hidden="true"> · </span>
        {split.wins}W {split.losses}L {split.draws}D
      </p>
    </div>
  );
}

function MatchRowView({ row }: { row: MatchRow }) {
  const score =
    row.crownsMine !== null && row.crownsOpponent !== null ? `${row.crownsMine} - ${row.crownsOpponent}` : "n/a";
  const deckLine =
    row.deckPreview.length > 0 ? ` · ${row.deckPreview.join(", ")}` : "";

  return (
    <li className={`app-progress-match app-progress-match--${row.result}`}>
      <span className="app-progress-match__result" aria-hidden="true">
        {row.result === "win" ? "W" : row.result === "loss" ? "L" : row.result === "draw" ? "D" : "?"}
      </span>

      <div className="app-progress-match__main">
        <p className="app-progress-match__opponent">
          <span className="app-sr">{row.resultLabel}. </span>
          vs {row.opponent}
        </p>
        <p className="app-progress-match__meta">
          <span>{row.matchTypeLabel}</span>
          <span aria-hidden="true"> · </span>
          {row.dateLabel && row.settledAt ? (
            <time dateTime={row.settledAt}>{row.dateLabel}</time>
          ) : (
            <span>Date unavailable</span>
          )}
        </p>
        {(row.commanderName || row.deckSize !== null) && (
          <p className="app-progress-match__deck" title={row.deckPreview.length > 0 ? row.deckPreview.join(", ") : undefined}>
            {row.commanderName ?? "Commander unavailable"}
            {row.commanderClassLabel && row.commanderClassLabel !== row.commanderName
              ? `, ${row.commanderClassLabel}`
              : ""}
            {row.deckSize !== null ? ` · ${row.deckSize}-card deck` : ""}
            {deckLine}
          </p>
        )}
      </div>

      <div className="app-progress-match__score">
        <span className="app-progress-match__score-label" aria-hidden="true">
          Crowns
        </span>
        <span className="app-progress-match__score-value">
          <CrownGlyph size={13} />
          <span className="app-sr">
            Crowns {row.crownsMine ?? "unknown"} to {row.crownsOpponent ?? "unknown"}.{" "}
          </span>
          <span aria-hidden="true">{score}</span>
        </span>
      </div>
    </li>
  );
}

function BoardRow({ entry }: { entry: BoardEntryView }) {
  return (
    <li className={`app-progress-board-row${entry.isYou ? " app-progress-board-row--you" : ""}`}>
      <span
        className={`app-progress-board-row__pos${
          entry.position !== null && entry.position <= 3 ? " app-progress-board-row__pos--top" : ""
        }`}
      >
        {entry.position ?? "n/a"}
      </span>

      <span className="app-progress-board-row__avatar">
        {entry.avatarUrl ? (
          <Image
            src={entry.avatarUrl}
            alt=""
            width={26}
            height={26}
            className="app-progress-board-row__img"
            unoptimized
          />
        ) : (
          <Icon name="user" size={13} />
        )}
      </span>

      <span className="app-progress-board-row__names">
        <span className="app-progress-board-row__name">
          <span className="app-progress-board-row__name-text">{entry.displayName ?? entry.username}</span>
          {entry.isYou && <span className="app-progress-board-row__you">You</span>}
        </span>
        <span className="app-progress-board-row__meta">
          {entry.matches} matches
          <span aria-hidden="true"> · </span>
          {entry.wins}W {entry.losses}L {entry.draws}D
          <span aria-hidden="true"> · </span>
          {entry.crownsEarned ?? "n/a"} crowns
        </span>
      </span>

      <span className="app-progress-board-row__rate">
        <span className="app-progress-board-row__rate-value">{winRateLabel(entry.winRateBp)}</span>
        <span className="app-progress-board-row__rate-label">win rate</span>
      </span>
    </li>
  );
}

function StandingBlock({
  standing,
  gap,
  fallback,
}: {
  standing: ReturnType<typeof resolveStanding>;
  gap: number | null;
  fallback: "locked" | "auth" | "unavailable";
}) {
  if (!standing) {
    if (fallback === "locked") {
      return (
        <div className="app-progress-standing app-progress-standing--muted">
          <span className="app-progress-standing__label">Locked</span>
          <strong>Profile setup</strong>
          <span className="app-progress-standing__text">finish setup to see your casual standing</span>
        </div>
      );
    }
    if (fallback === "auth") {
      return (
        <div className="app-progress-standing app-progress-standing--muted">
          <span className="app-progress-standing__label">Session expired</span>
          <strong>Sign in again</strong>
          <span className="app-progress-standing__text">your casual standing cannot be read right now</span>
        </div>
      );
    }
    return (
      <div className="app-progress-standing app-progress-standing--muted">
        <span className="app-progress-standing__label">Standing</span>
        <strong>Unavailable</strong>
        <span className="app-progress-standing__text">your casual qualification cannot be read right now</span>
      </div>
    );
  }

  if (standing.eligible) {
    if (standing.position !== null) {
      return (
        <div className="app-progress-standing">
          <span className="app-progress-standing__label">Your position</span>
          <strong>#{standing.position}</strong>
          <span className="app-progress-standing__text">on the casual board</span>
        </div>
      );
    }
    return (
      <div className="app-progress-standing">
        <span className="app-progress-standing__label">Standing</span>
        <strong>Qualified</strong>
        <span className="app-progress-standing__text">position pending the next board update</span>
      </div>
    );
  }

  if (gap !== null && gap > 0) {
    return (
      <div className="app-progress-standing">
        <span className="app-progress-standing__label">To qualify</span>
        <strong>{gap}</strong>
        <span className="app-progress-standing__text">
          more matchmaking match{gap === 1 ? "" : "es"}
          {standing.matchmakingMatches !== null ? ` (${standing.matchmakingMatches} played)` : ""}
        </span>
      </div>
    );
  }

  if (gap === 0) {
    return (
      <div className="app-progress-standing">
        <span className="app-progress-standing__label">Standing</span>
        <strong>Pending</strong>
        <span className="app-progress-standing__text">the next board update may place you</span>
      </div>
    );
  }

  return (
    <div className="app-progress-standing app-progress-standing--muted">
      <span className="app-progress-standing__label">Standing</span>
      <strong>Unavailable</strong>
      <span className="app-progress-standing__text">your casual qualification cannot be read right now</span>
    </div>
  );
}

export default function ProgressView({
  phase,
  player,
  stats,
  history,
  board,
  notices,
  busy,
  historyBusy,
  boardBusy,
  historyPageError,
  boardPageError,
  calm,
  status,
  onSignIn,
  onSignOut,
  onRefresh,
  onLoadMoreMatches,
  onBoardPage,
}: ProgressViewProps) {
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
            <h1 className="app-gate__title">Opening your record</h1>
            <p className="app-gate__lead">Connecting to the Chog Royale match service.</p>
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
              <Icon name="progress" size={36} />
            </span>
            <h1 className="app-gate__title">Chog Royale</h1>
            <p className="app-gate__lead">
              Sign in to see your verified record, your saved matches and the Casual Alpha Leaderboard.
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
            <h1 className="app-gate__title">Your record could not be opened</h1>
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
  const hero = heroMetric(stats);
  const standing = resolveStanding(stats, board);
  const gap = matchesToQualify(standing);
  const minMatches = board.minMatches ?? stats.casual?.minMatches ?? null;
  const standingLocked = stats.state === "locked" || board.state === "locked";
  const standingAuth = stats.state === "auth" || board.state === "auth";
  const standingFallback = standingLocked ? "locked" : standingAuth ? "auth" : "unavailable";

  const casualChip = standing
    ? standing.eligible
      ? standing.position !== null
        ? `Casual position #${standing.position}`
        : "Casual qualifier"
      : gap !== null && gap > 0
        ? `${gap} matchmaking match${gap === 1 ? "" : "es"} to qualify`
        : gap === 0
          ? "Casual qualification pending"
          : standingLocked
            ? "Casual standing locked"
            : "Casual standing unavailable"
    : standingLocked
      ? "Casual standing locked"
      : "Casual standing unavailable";

  const casualChipTone = standing?.eligible
    ? " app-progress-chip--gold"
    : standing
      ? ""
      : " app-progress-chip--muted";

  const statsState = stateCopy(stats.state, "stats");
  const historyState = stateCopy(history.state, "history");
  const boardState = stateCopy(board.state, "board");
  const allVerified = history.rows.length > 0 && history.rows.every((row) => row.verified);

  return (
    <>
      <AppHud player={player} onSignOut={onSignOut} extra={<AppHudBackLink />} />

      <main className={`app-stage app-stage--wide${calm ? " app-calm" : ""}`}>
        <div className="app-column app-column--wide">
          {noticeList.length > 0 && <div className="app-column__notices">{noticeList}</div>}

          <div className="app-progress">
            <div className="app-progress__main">
              <section className="app-panel app-progress-hero app-rise" aria-labelledby="app-progress-title">
                <span className="app-progress-hero__crest" aria-hidden="true">
                  <CrownGlyph size={148} />
                </span>

                <div className="app-progress-hero__top">
                  <span className="app-progress-hero__avatar">
                    {player?.avatarUrl ? (
                      <Image
                        src={player.avatarUrl}
                        alt={player.avatarName ? `${player.avatarName} avatar` : "Player avatar"}
                        width={56}
                        height={56}
                        className="app-progress-hero__img"
                        unoptimized
                      />
                    ) : (
                      <span className="app-progress-hero__empty" aria-hidden="true">
                        <Icon name="user" size={24} />
                      </span>
                    )}
                  </span>
                  <div className="app-progress-hero__id">
                    <p className="app-progress-kicker">Verified record</p>
                    <h1 className="app-progress-hero__name" id="app-progress-title">
                      {displayName}
                    </h1>
                    <p className="app-progress-hero__handle">
                      {player?.username ? `@${player.username}` : "No username yet"}
                    </p>
                  </div>
                </div>

                <div className="app-progress-hero__metric">
                  <div className="app-progress-hero__score">
                    <p className="app-progress-hero__value">{hero.value}</p>
                    <p className="app-progress-hero__value-label">{hero.label}</p>
                  </div>
                  <div className="app-progress-hero__summary">
                    <p className="app-progress-hero__record">{hero.record}</p>
                    <p className="app-progress-hero__caption">{hero.caption}</p>
                  </div>
                </div>

                <div className="app-progress-chips">
                  <a href="#casual-leaderboard" className={`app-progress-chip${casualChipTone}`}>
                    <Icon name="progress" size={13} />
                    {casualChip}
                  </a>
                  {stats.state === "ready" || stats.state === "empty" ? (
                    <span className="app-progress-chip app-progress-chip--muted">
                      <Icon name="check" size={13} />
                      Settled results
                    </span>
                  ) : null}
                  {busy ? <span className="app-progress-chip app-progress-chip--muted">Refreshing</span> : null}
                </div>

                <div className="app-progress-hero__actions">
                  <a href="#casual-leaderboard" className="app-btn app-btn--ghost">
                    Casual board
                  </a>
                  <button
                    type="button"
                    className="app-btn app-btn--ghost"
                    onClick={onRefresh}
                    disabled={busy || historyBusy || boardBusy}
                  >
                    <Icon name="refresh" size={16} />
                    {busy ? "Refreshing" : "Refresh"}
                  </button>
                </div>
              </section>

              <section
                className="app-panel app-progress-record app-rise"
                aria-labelledby="app-progress-record-title"
                style={{ animationDelay: "80ms" }}
              >
                <PanelHead eyebrow="Match stats" title="Record detail" titleId="app-progress-record-title" />

                {stats.state === "ready" ? (
                  <>
                    <dl className="app-progress-tiles">
                      <div className="app-progress-tile">
                        <dt>Matches</dt>
                        <dd>{stats.total}</dd>
                      </div>
                      <div className="app-progress-tile app-progress-tile--win">
                        <dt>Wins</dt>
                        <dd>{stats.wins}</dd>
                      </div>
                      <div className="app-progress-tile app-progress-tile--loss">
                        <dt>Losses</dt>
                        <dd>{stats.losses}</dd>
                      </div>
                      <div className="app-progress-tile app-progress-tile--draw">
                        <dt>Draws</dt>
                        <dd>{stats.draws}</dd>
                      </div>
                      <div className="app-progress-tile app-progress-tile--gold">
                        <dt>Crowns earned</dt>
                        <dd>{stats.crownsEarned ?? "n/a"}</dd>
                      </div>
                      <div className="app-progress-tile app-progress-tile--muted">
                        <dt>Crowns conceded</dt>
                        <dd>{stats.crownsConceded ?? "n/a"}</dd>
                      </div>
                    </dl>

                    {stats.byType ? (
                      <div className="app-progress-split">
                        <SplitRow label="Private rooms" split={stats.byType.private} board={false} />
                        <SplitRow label="Matchmaking" split={stats.byType.matchmaking} board />
                      </div>
                    ) : (
                      <p className="app-progress-note">The private and matchmaking split is unavailable for this record.</p>
                    )}

                    <dl className="app-progress-window">
                      <div>
                        <dt>First verified match</dt>
                        <dd>{formatRecordDate(stats.firstMatchAt) ?? "Not reported"}</dd>
                      </div>
                      <div>
                        <dt>Latest verified match</dt>
                        <dd>{formatRecordDate(stats.latestMatchAt) ?? "Not reported"}</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <StatePlate
                    tone={stats.state}
                    label={statsState.label}
                    title={statsState.title}
                    body={statsState.body}
                  />
                )}
              </section>

              <section
                className="app-panel app-progress-legacy app-rise"
                aria-labelledby="app-progress-legacy-title"
                style={{ animationDelay: "120ms" }}
              >
                <span className="app-progress-legacy__crest" aria-hidden="true">
                  <CrownGlyph size={120} />
                </span>
                <p className="app-progress-kicker">Genesis legacy</p>
                <h2 className="app-progress-title" id="app-progress-legacy-title">
                  Every Chog keeps its record.
                </h2>
                <p className="app-progress-legacy__body">
                  Verified commander and Arena Patron appearances are written to the Genesis token, not the wallet.
                  Achievements stay with the token across transfers.
                </p>
                <div className="app-progress-legacy__actions">
                  <Link href="/app/progress/legacy" className="app-btn app-btn--ghost">
                    Open legacy vault
                  </Link>
                </div>
              </section>

              <section
                className="app-panel app-progress-history app-rise"
                aria-labelledby="app-progress-history-title"
                style={{ animationDelay: "140ms" }}
              >
                <PanelHead
                  eyebrow="Saved results"
                  title="Match history"
                  titleId="app-progress-history-title"
                  aside={
                    history.state === "ready" ? (
                      <span className="app-badge">{allVerified ? "Replay verified" : "Saved results"}</span>
                    ) : undefined
                  }
                />

                {history.state === "ready" ? (
                  <>
                    <ol className="app-progress-matches">
                      {history.rows.map((row) => (
                        <MatchRowView key={row.id} row={row} />
                      ))}
                    </ol>

                    {historyPageError && (
                      <p className="app-progress-inline-error" role="alert">
                        {historyPageError}
                      </p>
                    )}

                    <div className="app-progress-history__foot">
                      {history.nextCursor ? (
                        <button
                          type="button"
                          className="app-btn app-btn--ghost"
                          onClick={onLoadMoreMatches}
                          disabled={historyBusy || busy}
                        >
                          {historyBusy ? "Loading matches" : "Load more matches"}
                        </button>
                      ) : (
                        <p className="app-progress-caption">That is every saved match.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <StatePlate
                    tone={history.state}
                    label={historyState.label}
                    title={historyState.title}
                    body={historyState.body}
                    action={
                      history.state === "empty" ? (
                        <Link href="/app" className="app-btn app-btn--ghost">
                          Play a match
                        </Link>
                      ) : undefined
                    }
                  />
                )}
              </section>
            </div>

            <div className="app-progress__side">
              <section
                id="casual-leaderboard"
                className="app-panel app-progress-board app-rise"
                aria-labelledby="app-progress-board-title"
                style={{ animationDelay: "120ms" }}
              >
                <PanelHead
                  eyebrow="Unranked alpha"
                  title="Casual Alpha Leaderboard"
                  titleId="app-progress-board-title"
                />

                <p className="app-progress-board__note">
                  Only matchmaking results count toward placement. Private rooms are excluded.
                  {minMatches !== null
                    ? ` Minimum ${minMatches} matchmaking match${minMatches === 1 ? "" : "es"}.`
                    : ""}{" "}
                  Ordered by matchmaking wins, then win rate, then crowns. No trophies or rewards.
                </p>

                <StandingBlock standing={standing} gap={gap} fallback={standingFallback} />

                {board.state === "ready" ? (
                  <>
                    <ol className="app-progress-board__list">
                      {board.entries.map((entry) => (
                        <BoardRow key={`${entry.position ?? "x"}-${entry.username}`} entry={entry} />
                      ))}
                    </ol>

                    {boardPageError && (
                      <p className="app-progress-inline-error" role="alert">
                        {boardPageError}
                      </p>
                    )}

                    {board.total > 0 && board.entries.length > 0 && (
                      <div className="app-progress-board__foot">
                        <button
                          type="button"
                          className="app-btn app-btn--ghost"
                          onClick={() => onBoardPage(Math.max(0, board.offset - board.limit))}
                          disabled={boardBusy || busy || board.offset === 0}
                          aria-label="Previous leaderboard page"
                        >
                          Previous
                        </button>
                        <p className="app-progress-board__pages">
                          {boardBusy
                            ? "Loading standings"
                            : `${board.offset + 1}-${board.offset + board.entries.length} of ${board.total}`}
                        </p>
                        <button
                          type="button"
                          className="app-btn app-btn--ghost"
                          onClick={() => onBoardPage(board.offset + board.limit)}
                          disabled={boardBusy || busy || board.offset + board.entries.length >= board.total}
                          aria-label="Next leaderboard page"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <StatePlate
                    tone={board.state}
                    label={boardState.label}
                    title={boardState.title}
                    body={boardState.body}
                  />
                )}
              </section>
            </div>
          </div>

          <p className="app-sr" role="status" aria-live="polite">
            {status}
          </p>
        </div>

        <AppNav activeId="progress" />
      </main>
    </>
  );
}
