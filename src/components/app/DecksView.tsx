"use client";

// The decks and collection view (A2). Pure presentation: every value arrives
// as a plain prop, so this component renders the same way from the
// authenticated container and from a static preview with sample data.
//
// The composition follows the DESIGN.md lobby spec and the C and D reference
// clips: a Decks/Collection switcher, a Battle Deck ribbon, a four by two
// card grid with energy badges, an average cost chip, a card detail panel and
// a filterable collection grid. Server-backed card progression appears in the
// collection without changing the deck contract.

import { useEffect, useRef } from "react";
import Image from "next/image";
import AppHud, { AppHudBackLink } from "./AppHud";
import AppNav from "./AppNav";
import AppNotice from "./AppNotice";
import Icon from "./icons";
import { dedupeNotices } from "./feedback-model";
import { DECK_CARD_COUNT, progressionDisplayState, progressionPercent, progressionStatusText } from "./decks-model";
import type { DeckCardProgression, DecksCatalogCard, DecksCommanderOption, DecksViewProps, ProgressionPhase, UpgradeStatus } from "./decks-types";
import type { LobbyArt } from "./lobby-types";

/** The energy cost badge, read from the real card cost. */
function CostBadge({ cost, size = "md" }: { cost: number; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`app-cost app-cost--${size}`}>
      <Icon name="energy" size={size === "lg" ? 18 : size === "sm" ? 11 : 14} />
      <span className="app-cost__num" aria-hidden="true">
        {cost}
      </span>
      <span className="app-sr">Energy cost {cost}</span>
    </span>
  );
}

/** Approved art rendered at its own intrinsic size. */
function Plate({ art, alt, className, sizes }: { art: LobbyArt; alt: string; className: string; sizes?: string }) {
  return <Image src={art.src} alt={alt} width={art.width} height={art.height} className={className} sizes={sizes} unoptimized />;
}

/** One slot of the battle deck. Empty slots show where a card goes. */
function DeckSlot({
  card,
  index,
  selected,
  swapping,
  onSelect,
}: {
  card: DecksCatalogCard | null;
  index: number;
  selected: boolean;
  swapping: boolean;
  onSelect: (index: number) => void;
}) {
  if (!card) {
    return (
      <li className="app-slot app-slot--empty">
        <span className="app-slot__art app-slot__art--empty" aria-hidden="true">
          <span className="app-slot__placeholder">
            <Icon name="decks" size={18} />
          </span>
        </span>
        <span className="app-slot__name app-slot__name--empty">Slot {index + 1}</span>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        className={`app-slot${selected ? " app-slot--selected" : ""}${swapping ? " app-slot--target" : ""}`}
        onClick={() => onSelect(index)}
        data-audio-skip="true"
        aria-pressed={selected}
      >
        <span className="app-slot__gem">
          <span className="app-slot__gem-num" aria-hidden="true">
            {card.cost}
          </span>
          <span className="app-sr">Energy cost {card.cost}</span>
        </span>
        <span className="app-slot__art">
          {card.art ? (
            <Plate art={card.art} alt="" className="app-slot__img" sizes="(max-width: 639px) 76px, 120px" />
          ) : (
            <span className="app-slot__initial" aria-hidden="true">
              {card.name.charAt(0)}
            </span>
          )}
        </span>
        <span className="app-slot__name">{card.name}</span>
      </button>
    </li>
  );
}

function ProgressionBadge({
  entry,
  goldBalance,
  phase,
}: {
  entry: DeckCardProgression | null;
  goldBalance: number | null;
  phase: ProgressionPhase;
}) {
  const state = progressionDisplayState(entry, goldBalance, phase === "ready" ? "ready" : "unavailable");
  if (state === "unavailable") return <span className="app-progression__badge app-progression__badge--muted" title="Card progression unavailable">Unavailable</span>;
  if (!entry) return <span className="app-progression__badge app-progression__badge--muted" title="Card progression unavailable">Unavailable</span>;
  return (
    <span className={`app-progression__badge app-progression__badge--${state}`}>
      {state === "maxed" ? "MAX" : `Lv ${entry.purchasedLevel}`}
    </span>
  );
}

/** One card in the collection grid. */
function CollectionTile({
  card,
  inDeck,
  selected,
  progression,
  goldBalance,
  progressionPhase,
  onSelect,
}: {
  card: DecksCatalogCard;
  inDeck: boolean;
  selected: boolean;
  progression: DeckCardProgression | null;
  goldBalance: number | null;
  progressionPhase: ProgressionPhase;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`app-tile${selected ? " app-tile--selected" : ""}${inDeck ? " app-tile--indeck" : ""}`}
        onClick={() => onSelect(card.id)}
        data-audio-skip="true"
        aria-pressed={selected}
      >
        <span className="app-tile__gem">
          <span className="app-tile__gem-num" aria-hidden="true">
            {card.cost}
          </span>
          <span className="app-sr">Energy cost {card.cost}</span>
        </span>
        {inDeck && <span className="app-tile__indeck">In deck</span>}
        <ProgressionBadge entry={progression} goldBalance={goldBalance} phase={progressionPhase} />
        <span className="app-tile__art">
          {card.art ? (
            <Plate art={card.art} alt="" className="app-tile__img" sizes="(max-width: 639px) 76px, 110px" />
          ) : (
            <span className="app-tile__initial" aria-hidden="true">
              {card.name.charAt(0)}
            </span>
          )}
        </span>
        <span className="app-tile__name">{card.name}</span>
        <span className="app-tile__type">{card.typeLabel}</span>
        {progression && progressionPhase === "ready" && (
          <span className="app-tile__xp" aria-label={`${progression.xp} lifetime XP`}>
            {progression.xp} XP
          </span>
        )}
      </button>
    </li>
  );
}

/** The commander tile that closes the battle deck grid. */
function CommanderTile({ option, onOpen }: { option: DecksCommanderOption | null; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="app-slot app-slot--commander" onClick={onOpen}>
        <span className="app-slot__gem">
          <span className="app-slot__gem-num" aria-hidden="true">
            {option?.cost ?? "\u2014"}
          </span>
          <span className="app-sr">Commander deploy cost {option?.cost ?? "unknown"}</span>
        </span>
        <span className="app-slot__art">
          {option?.art ? (
            <Plate art={option.art} alt="" className="app-slot__img" sizes="(max-width: 639px) 76px, 120px" />
          ) : (
            <span className="app-slot__initial" aria-hidden="true">
              <Icon name="commanders" size={20} />
            </span>
          )}
        </span>
        <span className="app-slot__name">{option?.displayName ?? "Commander"}</span>
        <span className="app-slot__type">{option?.ownership === "lent" ? "Lent, unavailable" : option?.basis === "borrowed" ? "Borrowed commander" : "Commander"}</span>
      </button>
    </li>
  );
}

/** The card detail panel. It is not modal: the deck stays reachable behind it. */
function DetailSheet({
  card,
  inDeck,
  deckFull,
  progression,
  progressionPhase,
  goldBalance,
  upgradeCardId,
  upgradeStatus,
  upgradeMessage,
  onUpgrade,
  onAction,
  onClose,
}: {
  card: DecksCatalogCard;
  inDeck: boolean;
  deckFull: boolean;
  progression: DeckCardProgression | null;
  progressionPhase: ProgressionPhase;
  goldBalance: number | null;
  upgradeCardId: string | null;
  upgradeStatus: UpgradeStatus;
  upgradeMessage: string | null;
  onUpgrade: (id: string) => void;
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    node.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayState = progressionDisplayState(progression, goldBalance, progressionPhase === "ready" ? "ready" : "unavailable");
  const percent = progressionPercent(progression);
  const canUpgrade = displayState === "ready" && progression !== null && upgradeCardId === null;

  return (
    <section className="app-sheet" role="dialog" aria-labelledby="app-sheet-title" ref={panel} tabIndex={-1}>
      <button type="button" className="app-sheet__close" onClick={onClose} aria-label="Close the card details">
        <Icon name="close" size={18} />
      </button>
      <div className="app-sheet__head">
        <span className="app-sheet__art">
          {card.art ? (
            <Plate art={card.art} alt="" className="app-sheet__img" sizes="120px" />
          ) : (
            <span className="app-sheet__initial" aria-hidden="true">
              {card.name.charAt(0)}
            </span>
          )}
        </span>
        <div className="app-sheet__meta">
          <CostBadge cost={card.cost} size="lg" />
          <h2 className="app-sheet__title" id="app-sheet-title">
            {card.name}
          </h2>
          <p className="app-sheet__type">{card.typeLabel}</p>
          <div className="app-sheet__chips">
            {card.traits.map((trait) => (
              <span key={trait} className="app-badge">
                {trait}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="app-sheet__text">{card.description}</p>
      <dl className="app-sheet__stats">
        {card.stats.map((stat) => (
          <div key={stat.label} className="app-sheet__stat">
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
      <section className="app-progression" aria-labelledby="app-progression-title">
        <div className="app-progression__head">
          <div>
            <p className="app-progression__eyebrow" id="app-progression-title">Card progression</p>
            <p className="app-progression__headline">
              {progressionPhase === "ready" && progression ? `Purchased level ${progression.purchasedLevel}` : "Server progression"}
            </p>
          </div>
          <ProgressionBadge entry={progression} goldBalance={goldBalance} phase={progressionPhase} />
        </div>

        {progressionPhase === "ready" && progression ? (
          <>
            <div className="app-progression__levels" aria-label={`Purchased level ${progression.purchasedLevel} of 10, XP potential level ${progression.xpLevel}`}>
              {Array.from({ length: 10 }, (_, index) => {
                const level = index + 1;
                const purchased = level <= progression.purchasedLevel;
                const potential = !purchased && level <= progression.xpLevel;
                return <span key={level} className={`app-progression__level${purchased ? " app-progression__level--purchased" : potential ? " app-progression__level--potential" : ""}`} />;
              })}
            </div>
            <div className="app-progression__meter" role="progressbar" aria-label="Lifetime XP toward the next purchased level" aria-valuemin={0} aria-valuemax={progression.xpTarget ?? progression.xp} aria-valuenow={progression.xp}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="app-progression__facts">
              <span><strong>{progression.xp}</strong> lifetime XP</span>
              <span><strong>Lv {progression.xpLevel}</strong> XP potential</span>
              <span>{progression.xpTarget === null ? "Max level reached" : `${progression.xpTarget} XP target`}</span>
            </div>
            <div className="app-progression__upgrade">
              <div>
                <span className="app-progression__cost-label">Next upgrade</span>
                <strong>{progression.goldCost === null ? "MAX" : `${progression.goldCost} Gold`}</strong>
              </div>
              <button type="button" className="app-btn app-btn--battle" onClick={() => onUpgrade(card.id)} data-audio-skip="true" disabled={!canUpgrade}>
                {upgradeCardId === card.id && upgradeStatus === "working" ? "Confirming" : displayState === "maxed" ? "Max level" : displayState === "ready" ? "Upgrade card" : progressionStatusText(displayState, progression)}
              </button>
            </div>
            {upgradeMessage && <p className={`app-progression__message${upgradeStatus === "error" ? " app-progression__message--error" : ""}`} role="status">{upgradeMessage}</p>}
          </>
        ) : (
          <p className="app-progression__message">{progressionPhase === "loading" ? "Reading server progression…" : "Card progression is unavailable. No level or Gold is shown until the server responds."}</p>
        )}
      </section>
      <div className="app-sheet__actions">
        <button type="button" className={`app-btn ${inDeck ? "app-btn--danger" : "app-btn--battle"}`} onClick={() => onAction(card.id)}>
          {inDeck ? "Remove from deck" : deckFull ? "Replace a deck card" : "Add to deck"}
        </button>
      </div>
    </section>
  );
}

/** The commander panel: the five free classes and any eligible NFT commander. */
function CommanderSheet({
  options,
  current,
  onSelect,
  onClose,
}: {
  options: DecksCommanderOption[];
  current: DecksCommanderOption | null;
  onSelect: (option: DecksCommanderOption) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    node.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const free = options.filter((o) => o.kind === "free");
  const nfts = options.filter((o) => o.kind === "nft");

  return (
    <section className="app-sheet" role="dialog" aria-labelledby="app-sheet-title" ref={panel} tabIndex={-1}>
      <button type="button" className="app-sheet__close" onClick={onClose} aria-label="Close the commander list">
        <Icon name="close" size={18} />
      </button>
      <h2 className="app-sheet__title app-sheet__title--wide" id="app-sheet-title">
        Your commander
      </h2>
      <p className="app-sheet__text">
        One commander joins the seven cards above. A free starter and an NFT commander of the same class have identical combat numbers.
      </p>

      <ul className="app-cmdrs">
        {free.map((option) => {
          const active = current?.key === option.key;
          return (
            <li key={option.key}>
              <button
                type="button"
                className={`app-cmdr${active ? " app-cmdr--active" : ""}`}
                onClick={() => onSelect(option)}
                data-audio-skip="true"
                aria-pressed={active}
              >
                <span className="app-cmdr__badge">Free</span>
                <span className="app-cmdr__name">{option.displayName}</span>
                <span className="app-cmdr__class">
                  {option.className}
                  {option.cost !== null ? ` \u00b7 ${option.cost} energy` : ""}
                </span>
                {active && <Icon name="check" size={16} className="app-cmdr__check" />}
              </button>
            </li>
          );
        })}
      </ul>

      <h3 className="app-sheet__sub">Chog Genesis NFT commanders</h3>
      {nfts.length === 0 ? (
        <p className="app-sheet__text">
          No owned or borrowed Chog Genesis NFT commanders are available on this account. The free starters above are always available.
        </p>
      ) : (
        <ul className="app-cmdrs">
          {nfts.map((option) => {
            const active = current?.key === option.key;
            const blocked = Boolean(option.blockedReason);
            return (
              <li key={option.key}>
                <button
                  type="button"
                  className={`app-cmdr${active ? " app-cmdr--active" : ""}${blocked ? " app-cmdr--blocked" : ""}`}
                  onClick={() => onSelect(option)}
                  data-audio-skip="true"
                  disabled={blocked}
                  aria-pressed={active}
                >
                  <span className="app-cmdr__badge app-cmdr__badge--nft">{option.ownership === "lent" ? "LENT" : option.basis === "borrowed" ? "BORROWED" : "OWNED"}</span>
                  <span className="app-cmdr__name">{option.displayName}</span>
                  <span className="app-cmdr__class">
                    {option.className}
                    {option.cost !== null ? ` \u00b7 ${option.cost} energy` : ""}
                  </span>
                  {active && <Icon name="check" size={16} className="app-cmdr__check" />}
                  {blocked && <span className="app-cmdr__reason">{option.blockedReason}</span>}
                  {option.loan && <span className="app-cmdr__reason">{option.ownership === "lent" ? "Lent until" : "Borrowed until"} <time dateTime={option.loan.endsAt}>{new Date(option.loan.endsAt).toLocaleString()}</time></span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="app-sheet__note">
        Selecting an NFT commander records a claim. Ownership or active borrowed use is checked again when you ready up and at match start. Borrowing gives in-game use only. The NFT stays in its owner&apos;s wallet.
      </p>
      {current && current.stats.length > 0 && (
        <>
          <h3 className="app-sheet__sub">
            {current.className} class numbers{current.kind === "nft" ? " (same for the free starter)" : ""}
          </h3>
          <dl className="app-sheet__stats">
            {current.stats.map((stat) => (
              <div key={stat.label} className="app-sheet__stat">
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

export default function DecksView(props: DecksViewProps) {
  const {
    phase,
    player,
    tab,
    onTabChange,
    cards,
    visibleCards,
    roleFilter,
    costFilter,
    costs,
    onRoleFilter,
    onCostFilter,
    deckCards,
    swapping,
    deckProblems,
    averageCost,
    averageLabel,
    onDeckSlot,
    onCancelSwap,
    commanderOption,
    commanderOptions,
    onSelectCommander,
    selectedCardId,
    commanderOpen,
    onSelectCard,
    onOpenCommander,
    onCloseDetail,
    onCardAction,
    progression,
    progressionPhase,
    progressionMessage,
    goldBalance,
    goldHistoryAvailable,
    upgradeCardId,
    upgradeStatus,
    upgradeMessage,
    onUpgrade,
    saveState,
    saveLabel,
    saveStatus,
    revision,
    saving,
    canSave,
    saveError,
    conflict,
    onSave,
    onLoadAccountDeck,
    onOverwriteAccountDeck,
    notices,
    busy,
    calm,
    status,
    onSignIn,
    onSignOut,
    onRefresh,
  } = props;

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
            <h1 className="app-gate__title">Opening your deck</h1>
            <p className="app-gate__lead">Reading your saved deck and the current card ruleset.</p>
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
              <Icon name="decks" size={36} />
            </span>
            <h1 className="app-gate__title">Chog Royale</h1>
            <p className="app-gate__lead">
              Build the deck you take into the arena: seven cards and one commander, from the cards that actually exist in the ruleset.
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
            <h1 className="app-gate__title">Your deck could not be opened</h1>
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

  const selectedCard = selectedCardId ? (cards.find((c) => c.id === selectedCardId) ?? null) : null;
  const deckFull = deckCards.filter(Boolean).length >= DECK_CARD_COUNT;
  const stateTone =
    saveState === "saved"
      ? "ok"
      : saveState === "unsaved" || saveState === "unavailable" || saveState === "conflict"
        ? "warn"
        : saveState === "save-failed"
          ? "error"
          : "info";

  return (
    <>
      <AppHud player={player} onSignOut={onSignOut} extra={<AppHudBackLink />} />

      <main className={`app-stage app-stage--wide${calm ? " app-calm" : ""}`}>
        <div className="app-column app-column--wide">
          {noticeList.length > 0 && <div className="app-column__notices">{noticeList}</div>}

          <div className="app-subtabs" role="tablist" aria-label="Deck and collection">
            <button
              type="button"
              role="tab"
              id="app-tab-deck"
              aria-selected={tab === "deck"}
              aria-controls="app-panel-deck"
              className={`app-subtabs__tab${tab === "deck" ? " app-subtabs__tab--active" : ""}`}
              onClick={() => onTabChange("deck")}
            >
              <Icon name="decks" size={18} />
              Decks
            </button>
            <button
              type="button"
              role="tab"
              id="app-tab-collection"
              aria-selected={tab === "collection"}
              aria-controls="app-panel-collection"
              className={`app-subtabs__tab${tab === "collection" ? " app-subtabs__tab--active" : ""}`}
              onClick={() => onTabChange("collection")}
            >
              <Icon name="collection" size={18} />
              Collection
            </button>
          </div>

          {tab === "deck" ? (
            <section
              className="app-panel app-decks app-rise"
              id="app-panel-deck"
              role="tabpanel"
              aria-labelledby="app-tab-deck"
            >
              <div className="app-ribbon">
                <h1 className="app-ribbon__title">Battle Deck</h1>
                <span className={`app-state app-state--${stateTone}`}>{saveLabel}</span>
              </div>

              {swapping && (
                <div className="app-swap" role="status">
                  <Icon name="swap" size={16} />
                  <span>Tap the card in your deck you want to replace.</span>
                  <button type="button" className="app-swap__cancel" onClick={onCancelSwap}>
                    Cancel
                  </button>
                </div>
              )}

              <div className="app-decks__body">
                <div className="app-decks__main">
                  <ul className="app-deckgrid">
                    {deckCards.map((card, index) => (
                      <DeckSlot
                        key={card?.id ?? `empty-${index}`}
                        card={card}
                        index={index}
                        selected={selectedCardId === card?.id}
                        swapping={swapping}
                        onSelect={onDeckSlot}
                      />
                    ))}
                    <CommanderTile option={commanderOption} onOpen={onOpenCommander} />
                  </ul>

                  <div className="app-decks__foot">
                    <span className="app-costchip">
                      <Icon name="energy" size={16} />
                      <span className="app-costchip__num">{averageCost ?? "\u2014"}</span>
                      <span className="app-costchip__label">{averageLabel}</span>
                    </span>
                    <span className="app-decks__count">
                      {deckCards.filter(Boolean).length} of {DECK_CARD_COUNT} cards
                      {revision !== null ? ` \u00b7 revision ${revision}` : ""}
                    </span>
                  </div>
                </div>

                <div className="app-decks__side">
                  {deckProblems.length > 0 && (
                    <ul className="app-problems">
                      {deckProblems.map((problem) => (
                        <li key={problem.code + problem.text}>{problem.text}</li>
                      ))}
                    </ul>
                  )}

                  <div className="app-save">
                    <p className="app-save__status">{saveStatus}</p>
                    {saveError && <p className="app-save__error">{saveError}</p>}
                    {conflict && (
                      <div className="app-conflict">
                        <p className="app-conflict__text">
                          The account holds revision {conflict.revision} with {conflict.cards.length} cards. Choose which deck to keep.
                        </p>
                        <div className="app-conflict__actions">
                          <button type="button" className="app-btn app-btn--ghost" onClick={onLoadAccountDeck}>
                            Load the account deck
                          </button>
                          <button type="button" className="app-btn app-btn--ghost" onClick={onOverwriteAccountDeck} disabled={saving}>
                            Overwrite with mine
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="app-save__actions">
                      <button type="button" className="app-btn app-btn--battle app-btn--save" onClick={onSave} disabled={!canSave}>
                        <Icon name="check" size={18} />
                        {saving ? "Saving" : "Save deck"}
                      </button>
                      <button type="button" className="app-btn app-btn--ghost" onClick={onRefresh} disabled={busy}>
                        <Icon name="refresh" size={16} />
                        {busy ? "Refreshing" : "Refresh"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section
              className="app-panel app-collection app-rise"
              id="app-panel-collection"
              role="tabpanel"
              aria-labelledby="app-tab-collection"
            >
              <div className="app-ribbon">
                <h1 className="app-ribbon__title">Card Collection</h1>
                <div className="app-ribbon__right">
                  <span className="app-state app-state--info">{visibleCards.length} of {cards.length} cards</span>
                  <span className="app-gold" title={goldHistoryAvailable ? "Server-confirmed Gold balance" : "Gold balance unavailable"}>
                    <span className="app-gold__coin" aria-hidden="true">G</span>
                    <span className="app-gold__value">{goldBalance === null ? "—" : goldBalance}</span>
                    <span className="app-gold__label">Gold</span>
                  </span>
                </div>
              </div>

              <div className={`app-progression-notice app-progression-notice--${progressionPhase}`} role={progressionPhase === "unavailable" || progressionPhase === "session" || progressionPhase === "locked" ? "status" : undefined}>
                <span className="app-progression-notice__mark" aria-hidden="true">✦</span>
                <span>{progressionPhase === "ready" ? "Server progression" : progressionPhase === "loading" ? "Reading card progression…" : progressionMessage ?? "Card progression is unavailable."}</span>
              </div>

              <div className="app-filters">
                <div className="app-filters__row" role="group" aria-label="Filter by card role">
                  {(["all", "troop", "spell", "building"] as const).map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={`app-chipbtn${roleFilter === role ? " app-chipbtn--active" : ""}`}
                      onClick={() => onRoleFilter(role)}
                      aria-pressed={roleFilter === role}
                    >
                      {role === "all" ? "All" : role === "troop" ? "Troops" : role === "spell" ? "Spells" : "Buildings"}
                    </button>
                  ))}
                </div>
                <div className="app-filters__row" role="group" aria-label="Filter by energy cost">
                  <button
                    type="button"
                    className={`app-chipbtn${costFilter === "all" ? " app-chipbtn--active" : ""}`}
                    onClick={() => onCostFilter("all")}
                    aria-pressed={costFilter === "all"}
                  >
                    Any cost
                  </button>
                  {costs.map((cost) => (
                    <button
                      key={cost}
                      type="button"
                      className={`app-chipbtn${costFilter === String(cost) ? " app-chipbtn--active" : ""}`}
                      onClick={() => onCostFilter(String(cost) as "1" | "2" | "3" | "4" | "5")}
                      aria-pressed={costFilter === String(cost)}
                    >
                      {cost}
                    </button>
                  ))}
                </div>
              </div>

              {visibleCards.length === 0 ? (
                <div className="app-empty">
                  <Icon name="collection" size={26} />
                  <p className="app-empty__title">No card matches that filter</p>
                  <p className="app-empty__body">Every card in the current ruleset is listed here. Clear the filter to see them all.</p>
                </div>
              ) : (
                <ul className="app-collection__grid">
                  {visibleCards.map((card) => (
                    <CollectionTile
                      key={card.id}
                      card={card}
                      inDeck={deckCards.some((c) => c?.id === card.id)}
                      selected={selectedCardId === card.id}
                      progression={progression[card.id] ?? null}
                      goldBalance={goldBalance}
                      progressionPhase={progressionPhase}
                      onSelect={onSelectCard}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {selectedCard && (
          <DetailSheet
            card={selectedCard}
            inDeck={deckCards.some((c) => c?.id === selectedCard.id)}
            deckFull={deckFull}
            progression={progression[selectedCard.id] ?? null}
            progressionPhase={progressionPhase}
            goldBalance={goldBalance}
            upgradeCardId={upgradeCardId}
            upgradeStatus={upgradeStatus}
            upgradeMessage={upgradeMessage}
            onUpgrade={onUpgrade}
            onAction={onCardAction}
            onClose={onCloseDetail}
          />
        )}
        {commanderOpen && (
          <CommanderSheet options={commanderOptions} current={commanderOption} onSelect={onSelectCommander} onClose={onCloseDetail} />
        )}

        <p className="app-sr" role="status" aria-live="polite">
          {status}
        </p>

        <AppNav activeId="decks" />
      </main>
    </>
  );
}
