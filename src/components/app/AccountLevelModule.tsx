"use client";

import Link from "next/link";
import Icon from "./icons";
import type { AccountLevelView } from "./profile-types";
import styles from "./AccountLevelModule.module.css";

interface AccountLevelModuleProps {
  accountLevel: AccountLevelView;
  presentation?: "card" | "content";
  showViewProgress?: boolean;
}

function formatXp(value: number | null): string {
  return value === null ? "n/a" : value.toLocaleString("en-US");
}

function progressPercent(accountLevel: AccountLevelView): number {
  if (
    accountLevel.state !== "ready" ||
    accountLevel.xpIntoLevel === null ||
    accountLevel.currentLevelThreshold === null ||
    accountLevel.nextLevelThreshold === null
  ) {
    return 0;
  }
  const span = accountLevel.nextLevelThreshold - accountLevel.currentLevelThreshold;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, (accountLevel.xpIntoLevel / span) * 100));
}

function stateCopy(accountLevel: AccountLevelView): { label: string; title: string; body: string } {
  if (accountLevel.state === "loading") {
    return {
      label: "Loading",
      title: "Reading account level",
      body: "Your server-authoritative progression is on its way.",
    };
  }
  if (accountLevel.state === "disabled") {
    return {
      label: "Coming soon",
      title: "Account levels are paused",
      body: accountLevel.message ?? "Account XP is not active yet. Your progression will appear when it opens.",
    };
  }
  return {
    label: "Unavailable",
    title: "Account level is unavailable",
    body: accountLevel.message ?? "The account progression service did not answer. No level or XP is inferred.",
  };
}

export default function AccountLevelModule({
  accountLevel,
  presentation = "card",
  showViewProgress = true,
}: AccountLevelModuleProps) {
  const headingId = "app-account-level-title";
  const isCard = presentation === "card";
  const percent = progressPercent(accountLevel);
  const stateClass =
    accountLevel.state === "disabled"
      ? styles.disabled
      : accountLevel.state === "unavailable"
        ? styles.unavailable
        : "";
  const contentClass = `${styles.content} ${isCard ? "" : styles.embedded} ${stateClass}`;

  if (accountLevel.state !== "ready" || accountLevel.level === null || accountLevel.totalXp === null) {
    const copy = stateCopy(accountLevel);
    const content = (
      <div className={styles.state} role={accountLevel.state === "unavailable" ? "status" : undefined}>
        <span className={styles.stateMark} aria-hidden="true">
          <Icon name={accountLevel.state === "loading" ? "refresh" : "lock"} size={20} />
        </span>
        <div className={styles.stateCopy}>
          {!isCard && <p className={styles.stateLabel}>{copy.label}</p>}
          <p className={styles.stateTitle}>{copy.title}</p>
          <p className={styles.stateBody}>{copy.body}</p>
        </div>
      </div>
    );

    if (!isCard) {
      return (
        <div className={contentClass} aria-busy={accountLevel.state === "loading"}>
          {content}
          {showViewProgress && (
            <Link href="/app/progress" className={`app-btn app-btn--ghost ${styles.action}`}>
              <Icon name="progress" size={16} />
              View Progress
            </Link>
          )}
        </div>
      );
    }

    return (
      <section
        className={`app-panel ${styles.module} ${styles.content} ${stateClass}`}
        aria-labelledby={headingId}
        aria-busy={accountLevel.state === "loading"}
      >
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Account progression</p>
            <h2 className={styles.title} id={headingId}>
              Account Level
            </h2>
          </div>
          <span
            className={`${styles.badge} ${
              accountLevel.state === "loading"
                ? styles.badgeLoading
                : accountLevel.state === "disabled"
                  ? styles.badgeDisabled
                  : styles.badgeUnavailable
            }`}
          >
            {copy.label}
          </span>
        </div>
        {content}
        <Link href="/app/progress" className={`app-btn app-btn--ghost ${styles.action}`}>
          <Icon name="progress" size={16} />
          View Progress
        </Link>
      </section>
    );
  }

  const level = accountLevel.level;
  const nextLevel = accountLevel.maxLevel ? null : Math.min(accountLevel.maxAccountLevel, level + 1);
  const progressLabel = accountLevel.maxLevel
    ? `Level ${level} is the current maximum.`
    : `${formatXp(accountLevel.xpIntoLevel)} XP in Level ${level}`;
  const nextCopy = accountLevel.maxLevel
    ? "Lifetime XP keeps counting after the level cap."
    : `${formatXp(accountLevel.xpToNext)} XP to Level ${nextLevel}`;

  const content = (
    <>
      <div className={styles.metrics}>
        <div className={styles.levelMetric}>
          <span className={styles.levelCrest} aria-hidden="true">
            <span>LV</span>
            <strong>{level}</strong>
          </span>
          <span className={styles.metricCaption}>Current level</span>
        </div>
        <div className={styles.xpMetric}>
          <strong>{formatXp(accountLevel.totalXp)}</strong>
          <span>Lifetime XP</span>
        </div>
      </div>

      <div className={`${styles.progressBlock} ${accountLevel.maxLevel ? styles.progressMax : ""}`}>
        <div className={styles.progressMeta}>
          <span>{progressLabel}</span>
          <span>{accountLevel.maxLevel ? "MAX" : `${Math.round(percent)}%`}</span>
        </div>
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label={accountLevel.maxLevel ? "Account level maximum" : "Account level progress"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={accountLevel.maxLevel ? 100 : Math.round(percent)}
          aria-valuetext={
            accountLevel.maxLevel
              ? "Maximum account level"
              : `${formatXp(accountLevel.xpIntoLevel)} XP in Level ${level}, ${formatXp(accountLevel.xpToNext)} XP to the next level`
          }
        >
          <span style={{ width: `${accountLevel.maxLevel ? 100 : percent}%` }} />
        </div>
        <p className={styles.nextCopy}>{nextCopy}</p>
      </div>
    </>
  );

  if (!isCard) {
    return (
      <div className={contentClass}>
        {content}
        {showViewProgress && (
          <Link href="/app/progress" className={`app-btn app-btn--ghost ${styles.action}`}>
            <Icon name="progress" size={16} />
            View Progress
          </Link>
        )}
      </div>
    );
  }

  return (
    <section className={`app-panel ${styles.module} ${styles.content}`} aria-labelledby={headingId}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Account progression</p>
          <h2 className={styles.title} id={headingId}>
            Account Level
          </h2>
        </div>
        <span className={`${styles.badge} ${styles.badgeReady} ${accountLevel.maxLevel ? styles.badgeMax : ""}`}>
          {accountLevel.maxLevel ? "Max level" : `Level ${level}`}
        </span>
      </div>
      {content}
      <Link href="/app/progress" className={`app-btn app-btn--ghost ${styles.action}`}>
        <Icon name="progress" size={16} />
        View Progress
      </Link>
    </section>
  );
}
