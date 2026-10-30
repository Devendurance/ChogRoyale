import Link from "next/link";
import { GameIcon } from "@/components/game/GameIcon";
import { accountXpProgressPercent } from "./account-xp-model";
import type { AccountXpLevelView } from "./account-xp-model";
import type { HomeMetricView, HomeSummaryProps } from "./home-summary-model";
import styles from "./HomeSummary.module.css";

export type { HomeSummaryProps } from "./home-summary-model";

function MetricValue({ metric, label }: { metric: HomeMetricView; label: string }) {
  if (metric.state === "ready") return <strong className={styles.metricValue}>{metric.value.toLocaleString("en-US")}</strong>;
  const value = metric.state === "loading"
    ? "Loading"
    : metric.state === "auth"
      ? "Sign in"
      : metric.state === "locked"
        ? "Setup locked"
        : "Unavailable";
  return (
    <span className={styles.metricState} role={metric.state !== "loading" ? "status" : undefined}>
      <strong className={styles.metricValue}>{value}</strong>
      {metric.message && <span className={styles.metricMessage}>{metric.message}</span>}
      <span className="app-sr">{label} value</span>
    </span>
  );
}

function accountProgress(accountLevel: AccountXpLevelView) {
  const percent = accountLevel.state === "ready"
    ? accountXpProgressPercent({
        state: "ready",
        maxLevel: accountLevel.maxLevel,
        xpIntoLevel: accountLevel.xpIntoLevel,
        currentLevelThreshold: accountLevel.currentLevelThreshold,
        nextLevelThreshold: accountLevel.nextLevelThreshold,
      })
    : null;

  if (
    accountLevel.state === "ready" &&
    accountLevel.level !== null &&
    accountLevel.totalXp !== null &&
    percent !== null &&
    (accountLevel.maxLevel || (accountLevel.xpIntoLevel !== null && accountLevel.xpToNext !== null))
  ) {
    const levelSpan = accountLevel.maxLevel
      ? null
      : accountLevel.nextLevelThreshold! - accountLevel.currentLevelThreshold!;
    return {
      ready: true,
      level: accountLevel.level,
      percent,
      primary: accountLevel.maxLevel ? "Maximum level" : `Level ${accountLevel.level}`,
      secondary: accountLevel.maxLevel
        ? `${accountLevel.totalXp.toLocaleString("en-US")} lifetime XP`
        : `${accountLevel.xpIntoLevel!.toLocaleString("en-US")} / ${levelSpan!.toLocaleString("en-US")} XP · ${accountLevel.xpToNext!.toLocaleString("en-US")} to go`,
      announcement: accountLevel.maxLevel
        ? `Account level ${accountLevel.level}, maximum level reached.`
        : `Account level ${accountLevel.level}, ${accountLevel.xpIntoLevel!.toLocaleString("en-US")} of ${levelSpan!.toLocaleString("en-US")} XP in this level, ${accountLevel.xpToNext!.toLocaleString("en-US")} XP to the next level.`,
    };
  }

  const loading = accountLevel.state === "loading";
  const disabled = accountLevel.state === "disabled";
  return {
    ready: false,
    level: null,
    percent: null,
    primary: loading ? "Loading account level" : disabled ? "Account XP paused" : "Account level unavailable",
    secondary: accountLevel.message ?? (loading ? "Reading your progression" : "No level or XP is shown."),
    announcement: accountLevel.message ?? (loading ? "Reading account progression." : "Account progression is unavailable."),
  };
}

export default function HomeSummary({ gold, crowns, accountLevel }: HomeSummaryProps) {
  const progress = accountProgress(accountLevel);

  return (
    <section className={`app-panel ${styles.summary}`} aria-label="Account summary">
      <div className={styles.metrics}>
        <div className={`${styles.metric} ${styles.goldMetric}`}>
          <span className={styles.coin} aria-hidden="true">G</span>
          <div className={styles.metricCopy}>
            <span className={styles.metricLabel}>Gold</span>
            <MetricValue metric={gold} label="Gold" />
          </div>
          <details className={styles.goldDisclosure}>
            <summary aria-label="Gold options" title="Gold options">+</summary>
            <div className={styles.goldPopover}>
              <Link href="/app/play" className={styles.earnLink}>Earn Gold</Link>
              <p>Gold purchases are unavailable.</p>
            </div>
          </details>
        </div>

        <div className={`${styles.metric} ${styles.crownMetric}`}>
          <GameIcon kind="crown" size={26} className={styles.crown} />
          <div className={styles.metricCopy}>
            <span className={styles.metricLabel}>Crowns earned</span>
            <MetricValue metric={crowns} label="Crowns earned" />
          </div>
        </div>
      </div>

      <Link href="/app/progress" className={styles.levelLink} aria-label={`View Progress. ${progress.announcement}`}>
        <span className={styles.levelCrest} aria-hidden="true">
          <span className={styles.crestInner}>
            <span>LVL</span>
            <strong>{progress.ready ? progress.level : progress.level === null && accountLevel.state === "loading" ? "…" : "?"}</strong>
          </span>
        </span>
        <span className={styles.levelDetails}>
          <span className={styles.levelHeading}>
            <strong>{progress.primary}</strong>
            <span>{progress.secondary}</span>
          </span>
          <span
            className={`${styles.xpTrack} ${progress.ready ? "" : accountLevel.state === "loading" ? styles.xpLoading : styles.xpUnavailable}`}
            aria-hidden="true"
          >
            {progress.ready && <span style={{ width: `${progress.percent}%` }} />}
          </span>
          <span className={styles.progressHint}>View Progress</span>
        </span>
      </Link>
    </section>
  );
}
