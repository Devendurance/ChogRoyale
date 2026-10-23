"use client";

// The Genesis legacy vault view (A3.2b). Pure presentation: the authenticated
// container owns the session and the network, so every value here is a plain
// prop and the same screen can be rendered from a presentation fixture.
//
// Token records are token-centric. A commander appearance means the token was
// fielded with a match-start ownership check. An Arena Patron appearance is a
// server-selected relationship, never a player commander choice. Holdings are
// cached verified-wallet observations, not a live ownership proof.

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import AppNotice from "./AppNotice";
import { dedupeNotices } from "./feedback-model";
import Icon from "./icons";
import { eligibilityLabel, visibleTrail } from "./legacy-model";
import type {
  AchievementView,
  LegacyEventView,
  LegacyViewProps,
  VaultToken,
} from "./legacy-types";

type StateTone =
  | "loading"
  | "empty"
  | "no-wallet"
  | "unavailable"
  | "locked"
  | "auth"
  | "not-found";

interface StateCopy {
  label: string;
  title: string;
  body: string;
}

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

function TokenArt({
  token,
  size,
  caption = false,
}: {
  token: VaultToken;
  size: "list" | "hero";
  caption?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showTokenImage = Boolean(token.imageUrl && !imageFailed);
  const showClassArt = !showTokenImage && token.classArt !== null;

  const note = showTokenImage
    ? "Original token art from the token metadata."
    : showClassArt
      ? `Commander class art, shared by every ${token.className ?? "commander"} of the class. Not this token's artwork.`
      : "Token artwork is not available in this build.";

  return (
    <span className={`app-legacy-art app-legacy-art--${size}`}>
      <span
        className={`app-legacy-crest app-legacy-crest--${size}${showTokenImage || showClassArt ? "" : " app-legacy-crest--empty"}`}
        title={showTokenImage ? "Original token art" : showClassArt ? "Commander class art" : "No token art"}
      >
        {showTokenImage ? (
          // The original image can resolve through any configured IPFS gateway,
          // so next/image has no fixed remote pattern to optimize against.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={token.imageUrl!}
            alt=""
            className="app-legacy-crest__img"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        ) : showClassArt && token.classArt ? (
          <Image
            src={token.classArt.src}
            alt=""
            width={token.classArt.width}
            height={token.classArt.height}
            className="app-legacy-crest__img"
            unoptimized
          />
        ) : (
          <CrownGlyph size={size === "hero" ? 40 : 20} />
        )}
      </span>
      {caption && <span className="app-legacy-art__note">{note}</span>}
    </span>
  );
}

function StatePlate({
  tone,
  label,
  title,
  body,
  action,
}: StateCopy & { tone: StateTone; action?: ReactNode }) {
  return (
    <div className={`app-legacy-state app-legacy-state--${tone}`}>
      {tone === "loading" && <span className="app-legacy-state__pulse" aria-hidden="true" />}
      <p className="app-legacy-state__label">{label}</p>
      <p className="app-legacy-state__title">{title}</p>
      <p className="app-legacy-state__body">{body}</p>
      {action && <div className="app-legacy-state__action">{action}</div>}
    </div>
  );
}

function BackToProgress() {
  return (
    <Link
      href="/app/progress"
      className="app-iconbtn"
      aria-label="Back to progress"
      title="Back to progress"
    >
      <Icon name="back" />
    </Link>
  );
}

function shortEligibility(token: VaultToken): string {
  if (token.eligibility === "eligible") {
    return token.eligibilityFreshness === "live" ? "Eligible, live" : "Eligible, cached";
  }
  if (token.eligibility === "pending") return "Class pending";
  if (token.eligibility === "not-eligible") return "Not eligible";
  return "No class";
}

function vaultStateCopy(state: LegacyViewProps["vault"]["state"]): StateCopy {
  switch (state) {
    case "empty":
      return {
        label: "Empty vault",
        title: "No Genesis tokens in your verified wallets",
        body: "Your verified wallets hold no Genesis tokens yet. This is a confirmed empty vault.",
      };
    case "no-wallet":
      return {
        label: "No wallet",
        title: "No verified wallet is linked",
        body: "Link a verified wallet to see the Genesis tokens held by this account.",
      };
    case "locked":
      return {
        label: "Locked",
        title: "The vault is locked",
        body: "This account cannot load its verified-wallet holdings right now.",
      };
    case "auth":
      return {
        label: "Session expired",
        title: "Sign in again to load the vault",
        body: "Your session is no longer valid, so the holdings could not be read.",
      };
    default:
      return {
        label: "Service unavailable",
        title: "Your Genesis vault isn't available yet",
        body: "The holdings service did not answer. This is not an empty vault.",
      };
  }
}

function recordStateCopy(state: LegacyViewProps["record"]["state"]): StateCopy {
  switch (state) {
    case "not-found":
      return {
        label: "Not indexed",
        title: "No indexed legacy record for this token",
        body: "The token is held, but the legacy index has no record for it. This is not a confirmed empty history.",
      };
    case "locked":
      return {
        label: "Locked",
        title: "The legacy record is locked",
        body: "This token record cannot be loaded for this account right now.",
      };
    case "auth":
      return {
        label: "Session expired",
        title: "Sign in again to load the record",
        body: "Your session is no longer valid, so the token record could not be read.",
      };
    default:
      return {
        label: "Service unavailable",
        title: "This legacy record isn't available yet",
        body: "The legacy service did not answer. This is not an empty record.",
      };
  }
}

function eventTitle(row: LegacyEventView): string {
  if (row.kind === "commander") return "Commander appearance";
  if (row.kind === "patron") return "Arena Patron appearance";
  if (row.kind === "achievement") {
    return row.achievementName ? `Achievement: ${row.achievementName}` : "Achievement awarded";
  }
  return "Commander outcome";
}

function eventNote(row: LegacyEventView): string | null {
  if (row.status === "corrected") return "Corrected record. Excluded from the verified counts.";
  if (row.kind === "patron") return "Assigned by the match, not selected as a commander.";
  if (row.kind === "commander" && row.ownershipVerified) return "Ownership verified at match start.";
  if (row.kind === "achievement") return "Awarded to this token.";
  return null;
}

function EventRow({ row }: { row: LegacyEventView }) {
  const score =
    row.kind === "commander" && row.crownsMine !== null && row.crownsOpponent !== null
      ? `${row.crownsMine} - ${row.crownsOpponent}`
      : null;
  const metaParts: string[] = [];
  if (row.kind === "commander") {
    metaParts.push(row.className ? `${row.className} commander` : "Commander class unavailable");
    metaParts.push(row.matchTypeLabel ?? "Match type unavailable");
  } else if (row.kind === "patron") {
    metaParts.push(row.themeLabel ? `${row.themeLabel} theme` : "Theme unavailable");
    metaParts.push(row.matchTypeLabel ?? "Match type unavailable");
  } else if (row.kind === "achievement") {
    metaParts.push("Token award");
  }
  metaParts.push(row.dateLabel ?? "Date unavailable");

  return (
    <li className={`app-legacy-event app-legacy-event--${row.kind}${row.status === "corrected" ? " app-legacy-event--corrected" : ""}`}>
      <span className="app-legacy-event__seal" aria-hidden="true">
        {row.kind === "achievement" ? (
          <Icon name="check" size={16} />
        ) : row.kind === "patron" ? (
          <CrownGlyph size={16} />
        ) : (
          <Icon name="swords" size={16} />
        )}
      </span>

      <div className="app-legacy-event__main">
        <div className="app-legacy-event__top">
          <p className="app-legacy-event__title">
            {eventTitle(row)}
            {row.kind === "commander" && row.resultLabel && (
              <span className={`app-legacy-result app-legacy-result--${row.result ?? "unknown"}`}>
                {row.resultLabel}
              </span>
            )}
            {row.status === "corrected" && <span className="app-badge app-badge--muted">Corrected</span>}
          </p>
          {score && (
            <span className="app-legacy-event__score">
              <CrownGlyph size={12} />
              <span className="app-sr">
                Crowns {row.crownsMine} to {row.crownsOpponent}.
              </span>
              <span aria-hidden="true">{score}</span>
            </span>
          )}
        </div>

        <p className="app-legacy-event__meta">
          {metaParts.map((part, index) => (
            <span key={`${index}-${part}`}>
              {index > 0 && <span aria-hidden="true"> · </span>}
              {part}
            </span>
          ))}
        </p>

        {eventNote(row) && <p className="app-legacy-event__note">{eventNote(row)}</p>}
      </div>
    </li>
  );
}

function AchievementCard({ item }: { item: AchievementView }) {
  const progressPercent =
    item.progressAvailable && item.progressCurrent !== null && item.progressTarget
      ? Math.min(100, Math.round((item.progressCurrent / item.progressTarget) * 100))
      : 0;

  return (
    <li className={`app-legacy-achievement app-legacy-achievement--${item.state}`}>
      <span className="app-legacy-achievement__seal" aria-hidden="true">
        {item.state === "earned" ? <Icon name="check" size={16} /> : <Icon name="lock" size={15} />}
      </span>
      <div className="app-legacy-achievement__body">
        <p className="app-legacy-achievement__name">{item.name}</p>
        <p className="app-legacy-achievement__description">{item.description}</p>

        {item.state === "earned" ? (
          <p className="app-legacy-achievement__meta">
            {item.awardedLabel ? `Earned ${item.awardedLabel}` : "Earned"}
          </p>
        ) : item.progressAvailable && item.progressCurrent !== null && item.progressTarget !== null ? (
          <>
            <div className="app-legacy-achievement__bar" aria-hidden="true">
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="app-legacy-achievement__meta">{item.progressLabel}</p>
          </>
        ) : (
          <p className="app-legacy-achievement__meta">Locked. Progress is not reported for this rule.</p>
        )}
      </div>
    </li>
  );
}

function AchievementsPanel({
  achievements,
}: {
  achievements: LegacyViewProps["achievements"];
}) {
  if (achievements.state === "locked" || achievements.state === "auth") {
    return (
      <StatePlate
        tone={achievements.state}
        label={achievements.state === "locked" ? "Locked" : "Session expired"}
        title={achievements.state === "locked" ? "Achievements are locked" : "Sign in again to load achievements"}
        body={
          achievements.state === "locked"
            ? "This token's awards cannot be loaded for this account right now."
            : "Your session is no longer valid, so the awards could not be read."
        }
      />
    );
  }
  if (achievements.state === "unavailable") {
    return (
      <StatePlate
        tone="unavailable"
        label="Service unavailable"
        title="Achievement details aren't available yet"
        body="The award service did not answer. This is not a zero-achievement result."
      />
    );
  }

  return (
    <>
      {achievements.note && <p className="app-legacy-note app-legacy-note--warn">{achievements.note}</p>}
      {achievements.items.length === 0 ? (
        <p className="app-legacy-note">No achievement details are available for this token.</p>
      ) : (
        <ul className="app-legacy-achievements__grid">
          {achievements.items.map((item) => (
            <AchievementCard key={item.code} item={item} />
          ))}
        </ul>
      )}
    </>
  );
}

export default function LegacyView({
  phase,
  player,
  vault,
  selectedToken,
  record,
  recordLoading,
  achievements,
  notices,
  busy,
  historyBusy,
  historyPageError,
  status,
  onSignIn,
  onSignOut,
  onRefresh,
  onSelectToken,
  onLoadMore,
}: LegacyViewProps) {
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
            <h1 className="app-gate__title">Opening the legacy vault</h1>
            <p className="app-gate__lead">Connecting to the Chog Royale legacy services.</p>
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
              Sign in to open your Genesis legacy vault. Records belong to the token, not the wallet that held it.
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
            <h1 className="app-gate__title">Your legacy vault could not be opened</h1>
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

  const vaultState = vaultStateCopy(vault.state);
  const recordState = recordStateCopy(record.state);
  const trail = visibleTrail(record.history);
  const hasRecord = !recordLoading && (record.state === "ready" || record.state === "empty");

  const vaultChip =
    vault.state === "ready"
      ? `${vault.tokens.length} Genesis token${vault.tokens.length === 1 ? "" : "s"}`
      : vault.state === "empty"
        ? "0 Genesis tokens"
        : vault.state === "no-wallet"
          ? "No verified wallet"
          : vault.state === "locked"
            ? "Vault locked"
            : vault.state === "auth"
              ? "Session expired"
              : "Vault unavailable";

  return (
    <>
      <AppHud player={player} onSignOut={onSignOut} extra={<BackToProgress />} />

      <main className="app-stage app-stage--wide app-stage--legacy">
        <div className="app-column app-column--wide">
          {noticeList.length > 0 && <div className="app-column__notices">{noticeList}</div>}

          <section className="app-panel app-legacy-hero app-rise" aria-labelledby="app-legacy-title">
            <span className="app-legacy-hero__crest" aria-hidden="true">
              <CrownGlyph size={170} />
            </span>

            <p className="app-legacy-kicker">Genesis legacy</p>
            <h1 className="app-legacy-hero__title" id="app-legacy-title">
              Genesis Legacy
            </h1>
            <p className="app-legacy-hero__lead">
              Verified commander and Arena Patron appearances are written to the Genesis token, not the wallet that
              held it. Achievements stay with the token across transfers.
            </p>

            <div className="app-legacy-chips">
              <span className="app-badge">{vaultChip}</span>
              {vault.latestObservedLabel && (
                <span className="app-badge app-badge--muted">Holdings observed {vault.latestObservedLabel}</span>
              )}
              {busy && <span className="app-badge app-badge--muted">Refreshing</span>}
            </div>
          </section>

          <div className={`app-legacy__grid${vault.state === "ready" && selectedToken ? "" : " app-legacy__grid--solo"}`}>
            <section className="app-panel app-legacy-vault app-rise" aria-labelledby="app-legacy-vault-title">
              <div className="app-legacy-panel__head">
                <div>
                  <p className="app-legacy-kicker">Holdings</p>
                  <h2 className="app-legacy-title" id="app-legacy-vault-title">
                    Genesis vault
                  </h2>
                </div>
                <button
                  type="button"
                  className="app-iconbtn"
                  onClick={onRefresh}
                  disabled={busy}
                  aria-label="Refresh Genesis holdings"
                  title="Refresh Genesis holdings"
                >
                  <Icon name="refresh" />
                </button>
              </div>

              <p className="app-legacy-note">
                Holdings come from cached observations of verified wallets. The battle server re-checks ownership at
                match start.
              </p>

              {vault.state === "ready" ? (
                <>
                  <ul className="app-legacy-vault__list" aria-label="Genesis tokens in your verified wallets">
                    {vault.tokens.map((token) => {
                      const selected = token.tokenId === selectedToken?.tokenId;
                      return (
                        <li key={token.tokenId}>
                          <button
                            type="button"
                            className={`app-legacy-token${selected ? " app-legacy-token--selected" : ""}`}
                            aria-pressed={selected}
                            onClick={() => onSelectToken(token.tokenId)}
                          >
                            <TokenArt token={token} size="list" />
                            <span className="app-legacy-token__names">
                              <span className="app-legacy-token__name">{token.name}</span>
                              <span className="app-legacy-token__meta">
                                Genesis #{token.tokenId}
                                {token.className ? ` · ${token.className}` : ""}
                              </span>
                              <span className={`app-legacy-token__chip app-legacy-token__chip--${token.eligibility}`}>
                                {shortEligibility(token)}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {!vault.classDataAvailable && (
                    <p className="app-legacy-note app-legacy-note--warn">
                      Commander classes are unavailable for this list.
                    </p>
                  )}
                </>
              ) : (
                <StatePlate
                  tone={vault.state}
                  label={vaultState.label}
                  title={vaultState.title}
                  body={vaultState.body}
                  action={
                    vault.state === "no-wallet" ? (
                      <Link href="/dev/onboarding" className="app-btn app-btn--ghost">
                        Open setup tools
                      </Link>
                    ) : undefined
                  }
                />
              )}
            </section>

            {vault.state === "ready" && selectedToken && (
              <div className="app-legacy__detail">
                <section
                  className="app-panel app-legacy-token-hero app-rise"
                  aria-labelledby="app-legacy-token-title"
                >
                  <TokenArt token={selectedToken} size="hero" caption />
                  <div className="app-legacy-token-hero__body">
                    <p className="app-legacy-kicker">{selectedToken.className ?? "Genesis token"}</p>
                    <h2 className="app-legacy-title app-legacy-title--token" id="app-legacy-token-title">
                      {selectedToken.name}
                    </h2>
                    <p className="app-legacy-token-hero__id">Genesis token #{selectedToken.tokenId}</p>
                    <div className="app-legacy-chips">
                      {selectedToken.className && <span className="app-badge">{selectedToken.className}</span>}
                      <span
                        className={`app-badge${selectedToken.eligibility === "eligible" ? "" : " app-badge--muted"}`}
                      >
                        {eligibilityLabel(selectedToken)}
                      </span>
                      <span className="app-badge app-badge--muted">
                        {selectedToken.holdingFreshness === "live" ? "Live holding" : "Cached holding"}
                      </span>
                    </div>
                    <p className="app-legacy-token-hero__note">
                      Legacy belongs to the token. Transfers do not erase its verified record.
                    </p>
                  </div>
                </section>

                <section
                  className="app-panel app-legacy-record app-rise"
                  aria-labelledby="app-legacy-record-title"
                  style={{ animationDelay: "80ms" }}
                >
                  <div className="app-legacy-panel__head">
                    <div>
                      <p className="app-legacy-kicker">Verified counts</p>
                      <h3 className="app-legacy-section-title" id="app-legacy-record-title">
                        Legacy record
                      </h3>
                    </div>
                    <span className="app-badge app-badge--muted">
                      {recordLoading ? "Reading" : record.state === "ready" ? "Token record" : "No record"}
                    </span>
                  </div>

                  {recordLoading ? (
                    <StatePlate
                      tone="loading"
                      label="Reading"
                      title="Reading the legacy record"
                      body="Checking the token's verified events and awards."
                    />
                  ) : record.state === "ready" || record.state === "empty" ? (
                    <>
                      <div className="app-legacy-medallions">
                        <div className="app-legacy-medallion app-legacy-medallion--commander">
                          <p className="app-legacy-medallion__label">Commander appearances</p>
                          <p className="app-legacy-medallion__value">{record.stats?.commanderAppearances ?? 0}</p>
                        </div>
                        <div className="app-legacy-medallion app-legacy-medallion--patron">
                          <p className="app-legacy-medallion__label">Arena Patron appearances</p>
                          <p className="app-legacy-medallion__value">{record.stats?.patronAppearances ?? 0}</p>
                        </div>
                        <div className="app-legacy-medallion app-legacy-medallion--win">
                          <p className="app-legacy-medallion__label">Victories</p>
                          <p className="app-legacy-medallion__value">{record.stats?.victories ?? 0}</p>
                        </div>
                        <div className="app-legacy-medallion app-legacy-medallion--loss">
                          <p className="app-legacy-medallion__label">Defeats</p>
                          <p className="app-legacy-medallion__value">{record.stats?.defeats ?? 0}</p>
                        </div>
                      </div>

                      {record.state === "empty" && (
                        <p className="app-legacy-record__empty">
                          No recorded legacy yet. This token has no verified commander or Arena Patron appearances.
                        </p>
                      )}

                      <p className="app-legacy-note">
                        Commander appearances record a match-start ownership check. Arena Patron appearances are
                        assigned by the match, independent of your commander choice.
                      </p>
                    </>
                  ) : (
                    <StatePlate
                      tone={record.state}
                      label={recordState.label}
                      title={recordState.title}
                      body={recordState.body}
                    />
                  )}
                </section>

                {hasRecord && record.state === "ready" && (
                  <section
                    className="app-panel app-legacy-history app-rise"
                    aria-labelledby="app-legacy-history-title"
                    style={{ animationDelay: "140ms" }}
                  >
                    <div className="app-legacy-panel__head">
                      <div>
                        <p className="app-legacy-kicker">Token trail</p>
                        <h3 className="app-legacy-section-title" id="app-legacy-history-title">
                          Recorded events
                        </h3>
                      </div>
                      <span className="app-badge app-badge--muted">
                        {record.total} event{record.total === 1 ? "" : "s"}
                      </span>
                    </div>

                    {trail.length > 0 ? (
                      <ol className="app-legacy-trail">
                        {trail.map((row) => (
                          <EventRow key={row.id} row={row} />
                        ))}
                      </ol>
                    ) : (
                      <p className="app-legacy-note">No appearance rows are recorded on this page.</p>
                    )}

                    {historyPageError && (
                      <p className="app-legacy-inline-error" role="alert">
                        {historyPageError}
                      </p>
                    )}

                    <div className="app-legacy-history__foot">
                      {record.nextOffset !== null ? (
                        <button
                          type="button"
                          className="app-btn app-btn--ghost"
                          onClick={onLoadMore}
                          disabled={historyBusy || busy}
                        >
                          {historyBusy ? "Loading events" : "Load more events"}
                        </button>
                      ) : (
                        <p className="app-legacy-caption">That is every recorded event.</p>
                      )}
                    </div>
                  </section>
                )}

                {hasRecord && (
                  <section
                    className="app-panel app-legacy-achievements app-rise"
                    aria-labelledby="app-legacy-achievements-title"
                    style={{ animationDelay: "200ms" }}
                  >
                    <div className="app-legacy-panel__head">
                      <div>
                        <p className="app-legacy-kicker">Token awards</p>
                        <h3 className="app-legacy-section-title" id="app-legacy-achievements-title">
                          Achievements
                        </h3>
                      </div>
                      <span className="app-badge app-badge--muted">
                        {achievements.earnedCount} earned
                      </span>
                    </div>
                    <AchievementsPanel achievements={achievements} />
                  </section>
                )}
              </div>
            )}
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
