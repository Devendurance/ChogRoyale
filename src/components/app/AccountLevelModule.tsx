"use client";

import Link from "next/link";
import Icon from "./icons";
import type { AccountLevelView } from "./profile-types";
import styles from "./AccountLevelModule.module.css";

interface AccountLevelModuleProps {
  accountLevel: AccountLevelView;
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

export default function AccountLevelModule({ accountLevel }: AccountLevelModuleProps) {
  const headingId = "app-account-level-title";
  const percent = progressPercent(accountLevel);

  if (accountLevel.state !== "ready" || accountLevel.level === null || accountLevel.totalXp === null) {
    const copy = stateCopy(accountLevel);
    return (
      <section
        className={`app-panel ${styles.module} ${styles[accountLevel.state]}`}
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
          <span className={styles.badge}>{copy.label}</span>
        </div>

        <div className={styles.state} role={accountLevel.state === "unavailable" ? "status" : undefined}>
          <span className={styles.stateMark} aria-hidden="true">
            <Icon name={accountLevel.state === "loading" ? "refresh" : "lock"} size={20} />
          </span>
          <div>
            <p className={styles.stateTitle}>{copy.title}</p>
            <p className={styles.stateBody}>{copy.body}</p>
          </div>
        </div>

        <Link href="/app/progress" className={`app-btn app-btn--ghost ${styles.action}`}>
          <Icon name="progress" size={16} />
          View Progress
        </Link>
      </section>
    );
  }

  const level = accountLevel.level;
  const nextLevel = accountLevel.maxLevel
    ? null
    : Math.min(accountLevel.maxAccountLevel, level + 1);
  const progressLabel = accountLevel.maxLevel
    ? `Level ${level} is the current maximum.`
    : `${formatXp(accountLevel.xpIntoLevel)} XP in Level ${level}`;
  const nextCopy = accountLevel.maxLevel
    ? "Lifetime XP keeps counting after the level cap."
    : `${formatXp(accountLevel.xpToNext)} XP to Level ${nextLevel}`;

  return (
    <section className={`app-panel ${styles.module} ${styles.ready}`} aria-labelledby={headingId}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Account progression</p>
          <h2 className={styles.title} id={headingId}>
            Account Level
          </h2>
        </div>
        <span className={`${styles.badge} ${styles.badgeReady}`}>Level {accountLevel.level}</span>
      </div>

      <div className={styles.metrics}>
        <div className={styles.levelMetric}>
          <span className={styles.levelCrest} aria-hidden="true">
            <span>LV</span>
            <strong>{accountLevel.level}</strong>
          </span>
          <span className={styles.metricCaption}>Current level</span>
        </div>
        <div className={styles.xpMetric}>
          <strong>{formatXp(accountLevel.totalXp)}</strong>
          <span>Lifetime XP</span>
        </div>
      </div>

      <div className={styles.progressBlock}>
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

      <Link href="/app/progress" className={`app-btn app-btn--ghost ${styles.action}`}>
        <Icon name="progress" size={16} />
        View Progress
      </Link>
    </section>
  );
}
