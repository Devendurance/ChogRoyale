"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { getAvatar } from "@/lib/avatars";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import { uiSound } from "@/components/audio/ui-interactions";
import { useLobbyCatalog } from "./catalog-context";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import { GiftError, giftEligibilityCopy, giftIntent, giftOutcomeCopy, giftPeerName, giftRequest, giftWasConfirmed, parseGiftEligibility, parseGiftFriends, parseGiftHistory, parseGiftQuote, parseGiftResponse, type GiftEligibility, type GiftHistory, type GiftPeer, type SponsorshipQuote, type SponsorshipRequest } from "./gifts-model";
import "./gifts.css";

const base = "/api/players/me/gifts";
const asError = (error: unknown) => error instanceof GiftError ? error : new GiftError(503);
type QuoteState = { recipientId: string; cardId: string; eligibility: GiftEligibility; quote: SponsorshipQuote | null };

function Confirmation({ quote, name, cardName, close, confirm }: { quote: SponsorshipQuote; name: string; cardName: string; close: () => void; confirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = ref.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="app-gifts__dialog" aria-labelledby="gift-confirm-title" aria-describedby="gift-confirm-copy" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}><h2 id="gift-confirm-title">Sponsor this upgrade?</h2><p id="gift-confirm-copy">Spend {quote.cost} Gold to sponsor one purchased level for {name}&apos;s {cardName}. The server will recheck their earned XP, current level, friendship, limits and your balance before confirming.</p><div className="app-gifts__actions"><button autoFocus className="app-btn app-btn--ghost" onClick={close}>Cancel</button><button className="app-btn app-btn--save" data-audio-skip="true" onClick={() => { uiSound("confirm"); confirm(); }}>Confirm {quote.cost} Gold</button></div></dialog>;
}

function ErrorNotice({ error, retry }: { error: GiftError | null; retry: () => void }) {
  const { login } = useLogin();
  if (!error) return null;
  return <div className="app-gifts__error" role="alert"><p>{error.message}</p><button className="app-btn app-btn--ghost" onClick={error.status === 401 ? () => login() : retry}>{error.status === 401 ? "Sign in" : "Refresh"}</button></div>;
}

export function GiftsAccount({ getToken, signOut }: { getToken: () => Promise<string | null>; signOut: () => void }) {
  const catalog = useLobbyCatalog();
  const cards = Object.values(catalog.cards);
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [friends, setFriends] = useState<GiftPeer[] | null>(null);
  const [history, setHistory] = useState<GiftHistory | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<GiftError | null>(null);
  const [historyError, setHistoryError] = useState<GiftError | null>(null);
  const [goldError, setGoldError] = useState<GiftError | null>(null);
  const [actionError, setActionError] = useState<GiftError | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null);
  const [quoteError, setQuoteError] = useState<GiftError | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmationState] = useState(false);
  const [outcome, setOutcome] = useState<{ message: string; confirmed: boolean } | null>(null);
  const [uncertain, setUncertain] = useState<SponsorshipRequest | null>(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const live = useRef(true);
  const read = useRef<Promise<void> | null>(null);
  const lock = useRef(false);
  const quoteSequence = useRef(0);
  const intent = useRef<{ signature: string; request: SponsorshipRequest } | null>(null);
  const load = useCallback(() => {
    if (read.current) return read.current;
    const work = async () => {
      setRefreshing(true);
      const results = await Promise.allSettled([
        giftRequest<{ player: ProfilePayload }>("/api/players/me", getToken),
        giftRequest<unknown>("/api/players/me/friends", getToken).then(parseGiftFriends),
        giftRequest<unknown>(`${base}/sponsorships`, getToken).then(parseGiftHistory),
        giftRequest<{ gold: { balance: number } }>("/api/players/me/gold", getToken),
      ]);
      if (!live.current) return;
      if (results[0].status === "fulfilled") setProfile(results[0].value.player);
      if (results[1].status === "fulfilled") { setFriends(results[1].value); setError(null); } else setError(asError(results[1].reason));
      if (results[2].status === "fulfilled") { setHistory(results[2].value); setHistoryError(null); } else setHistoryError(asError(results[2].reason));
      if (results[3].status === "fulfilled" && Number.isInteger(results[3].value.gold?.balance) && results[3].value.gold.balance >= 0) { setBalance(results[3].value.gold.balance); setGoldError(null); } else setGoldError(results[3].status === "rejected" ? asError(results[3].reason) : new GiftError(503));
      setRefreshing(false);
    };
    read.current = work().finally(() => { read.current = null; });
    return read.current;
  }, [getToken]);
  useEffect(() => {
    live.current = true;
    void load();
    const visible = () => { if (document.visibilityState === "visible" && !lock.current) { setQuoteState(null); setQuoteRevision((value) => value + 1); void load(); } };
    document.addEventListener("visibilitychange", visible);
    return () => { live.current = false; quoteSequence.current += 1; document.removeEventListener("visibilitychange", visible); };
  }, [load]);
  useEffect(() => {
    const sequence = ++quoteSequence.current;
    if (!recipientId || !cardId || !friends?.some((friend) => friend.id === recipientId) || error || refreshing || busy) return;
    let cancelled = false;
    const work = async () => {
      setQuoting(true); setQuoteError(null);
      try {
        const eligibility = parseGiftEligibility(await giftRequest(`${base}/eligibility?peerId=${encodeURIComponent(recipientId)}`, getToken));
        const quote = eligibility.eligible ? parseGiftQuote(await giftRequest(`${base}/sponsorships/quote?recipientId=${encodeURIComponent(recipientId)}&cardId=${encodeURIComponent(cardId)}`, getToken)) : null;
        if (cancelled || !live.current || sequence !== quoteSequence.current) return;
        if (quote && quote.cardId !== cardId) throw new GiftError(503);
        setQuoteState({ recipientId, cardId, eligibility, quote });
      } catch (failure) { if (!cancelled && live.current && sequence === quoteSequence.current) { setQuoteState(null); setQuoteError(asError(failure)); } }
      finally { if (!cancelled && live.current && sequence === quoteSequence.current) setQuoting(false); }
    };
    void work();
    return () => { cancelled = true; };
  }, [recipientId, cardId, friends, error, refreshing, busy, getToken, quoteRevision]);
  const refresh = () => { setQuoteState(null); setQuoteRevision((value) => value + 1); void load(); };
  const selectedFriend = friends?.find((friend) => friend.id === recipientId);
  const selectedCard = catalog.cards[cardId];
  const currentQuote = quoteState?.recipientId === recipientId && quoteState.cardId === cardId ? quoteState : null;
  const quote = currentQuote?.quote;
  const eligible = currentQuote?.eligibility.eligible && quote?.eligible && quote.reason === "eligible" && quote.nextLevel !== null && quote.cost !== null;
  const retryIntent = uncertain?.recipientId === recipientId && uncertain?.cardId === cardId;
  const enabled = !busy && !refreshing && (retryIntent || (!!eligible && !quoting && !error && !goldError && balance !== null));
  const submit = async () => {
    if (lock.current || !enabled || (!retryIntent && (!quote || quote.nextLevel === null))) return;
    lock.current = true; setBusy(true); setConfirmation(false); setActionError(null); setOutcome(null);
    if (!retryIntent) intent.current = giftIntent(intent.current, recipientId, cardId, quote!.nextLevel!, () => crypto.randomUUID());
    try {
      const response = parseGiftResponse(await giftRequest(`${base}/sponsorships`, getToken, "POST", intent.current!.request));
      if (!live.current) return;
      if (response.cardId !== cardId) throw new GiftError(503);
      const confirmed = giftWasConfirmed(response);
      setOutcome({ confirmed, message: giftOutcomeCopy(response.status) });
      uiSound(response.status === "sponsored" ? "reward" : response.status === "duplicate" ? "confirm" : "error");
      // Any authoritative domain result completes this intent. Network uncertainty keeps it.
      intent.current = null;
      setUncertain(null);
      setQuoteState(null);
      if (read.current) await read.current;
      await load();
      if (live.current) setQuoteRevision((value) => value + 1);
    } catch (failure) {
      if (!live.current) return;
      uiSound("error");
      setActionError(asError(failure));
      setUncertain(!(failure instanceof GiftError) || failure.status >= 500 ? intent.current?.request ?? null : null);
      if (failure instanceof GiftError && [403,404,409].includes(failure.status)) { setQuoteState(null); if (read.current) await read.current; await load(); }
    } finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const avatar = selectedFriend ? getAvatar(selectedFriend.avatarId) : null;
  const setConfirmation = (open: boolean) => {
    if (open && retryIntent) { uiSound("confirm"); void submit(); return; }
    setConfirmationState(open);
  };
  const receipts = (role: "sent" | "received") => <section className="app-panel app-gifts__panel"><h2>{role === "sent" ? "Gifts sent" : "Gifts received"}</h2><p className="app-gifts__fine">Confirmed Gold upgrade sponsorships.</p>{historyError ? <ErrorNotice error={historyError} retry={refresh} /> : !history ? <p role="status">Loading confirmed history...</p> : history[role].length === 0 ? <p>No confirmed sponsorships {role} yet.</p> : <ul className="app-gifts__history">{history[role].map((receipt) => {
    const card = catalog.cards[receipt.cardId];
    const peer = friends?.find((friend) => friend.id === (role === "sent" ? receipt.recipientId : receipt.sponsorId));
    return <li key={receipt.id}>{card?.art && <Image src={card.art.src} alt="" width={58} height={74} />}<div><h3>{card?.name ?? "Card identity unavailable"}</h3><p>{role === "sent" ? "To" : "From"} {giftPeerName(peer)}</p><p className="app-gifts__fine">Level {receipt.fromLevel} → {receipt.toLevel} · {receipt.cost} Gold</p><time dateTime={receipt.createdAt}>{new Date(receipt.createdAt).toLocaleString()}</time></div><span className="app-gifts__badge">Confirmed</span></li>;
  })}</ul>}</section>;
  return <><AppHud player={profile ? resolvePlayer(profile) : null} onSignOut={signOut} /><main className="app-stage"><div className="app-column app-gifts" aria-busy={refreshing || busy}><header className="app-gifts__heading"><div><p className="app-eyebrow">Give a friend a boost</p><h1>Gifting</h1><p>Sponsor a card upgrade with your earned Gold.</p></div><button className="app-btn app-btn--ghost" disabled={busy || refreshing} onClick={refresh}>{refreshing ? "Refreshing..." : "Refresh"}</button></header><nav className="app-gifts__links" aria-label="Gifting navigation"><Link href="/app/friends">Friends</Link><Link href="/app/decks">Your collection</Link><Link href="/app/profile">Profile</Link></nav><ErrorNotice error={error} retry={refresh} /><ErrorNotice error={actionError} retry={refresh} />{outcome && <p className={outcome.confirmed ? "app-gifts__success" : "app-gifts__warning"} role="status">{outcome.message}</p>}<div className="app-gifts__grid"><section className="app-panel app-gifts__panel"><p className="app-gifts__badge">Gold upgrade sponsorship</p><h2>Choose your gift</h2><p>You pay the Gold for one purchased card level. Your friend must have earned the required card XP. Their XP stays intact.</p><div className="app-gifts__balance"><span>Your earned Gold</span><strong>{goldError ? "Unavailable" : balance === null ? "Loading..." : balance.toLocaleString()}</strong></div><ErrorNotice error={goldError} retry={refresh} /><fieldset disabled={busy || refreshing || !!error}><legend className="app-sr">Sponsorship selection</legend><label>Accepted friend<select className="app-settings-input" value={recipientId} onChange={(event) => { setRecipientId(event.target.value); setQuoteState(null); setOutcome(null); setActionError(null); }}><option value="">Choose a friend</option>{friends?.map((friend) => <option key={friend.id} value={friend.id}>{giftPeerName(friend)}</option>)}</select></label>{friends?.length === 0 && !error && <p>No accepted friends to choose from. <Link href="/app/friends">Open Friends</Link>.</p>}{selectedFriend && <div className="app-gifts__peer">{avatar && <Image src={avatar.assetUrl} alt="" width={44} height={44} />}<span>{giftPeerName(selectedFriend)}</span></div>}<label>Ordinary card<select className="app-settings-input" value={cardId} onChange={(event) => { setCardId(event.target.value); setQuoteState(null); setOutcome(null); setActionError(null); }}>{cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label></fieldset><ErrorNotice error={quoteError} retry={refresh} />{quoting && <p role="status">Checking friendship and card upgrade eligibility...</p>}{currentQuote && <div className="app-gifts__quote"><p>{giftEligibilityCopy(currentQuote.eligibility)}</p>{currentQuote.eligibility.reason === "too-new" && currentQuote.eligibility.nextEligibleAt && <p className="app-gifts__fine">Earliest eligibility <time dateTime={currentQuote.eligibility.nextEligibleAt}>{new Date(currentQuote.eligibility.nextEligibleAt).toLocaleString()}</time>. The server checks again before sponsoring.</p>}{quote && (quote.eligible ? <><p className="app-gifts__badge">Ready to sponsor</p><dl><div><dt>Current purchased level</dt><dd>{quote.nextLevel}</dd></div><div><dt>Next purchased level</dt><dd>{quote.nextLevel! + 1}</dd></div><div><dt>Gold cost</dt><dd>{quote.cost}</dd></div></dl></> : <p className="app-gifts__warning">{giftOutcomeCopy(quote.reason)}</p>)}</div>}<button className="app-btn app-btn--save app-gifts__submit" data-audio-skip="true" disabled={!enabled} onClick={() => setConfirmation(true)} aria-describedby="gift-submit-hint">{busy ? "Waiting for server confirmation..." : actionError ? "Retry sponsorship" : quote?.eligible ? `Sponsor upgrade · ${quote.cost} Gold` : "Check eligibility to sponsor"}</button><p id="gift-submit-hint" className="app-gifts__fine">Choose an accepted friend and card. A server-approved quote is required. Gold is spent only when the server confirms the upgrade.</p></section><section className="app-panel app-gifts__panel app-gifts__preview">{selectedCard?.art && <Image className="app-gifts__card-art" src={selectedCard.art.src} alt={selectedCard.name} width={selectedCard.art.width} height={selectedCard.art.height} />}<h2>{selectedCard?.name ?? "Choose a card"}</h2><p>Help a friend unlock the next step they&apos;ve earned.</p><ul><li>Requires 30 days of accepted friendship.</li><li>Card XP stays earned through play.</li><li>No card copies or currency move between players.</li><li>Current sponsorship limits are checked by the server.</li></ul><p className="app-gifts__fine">Gold is an in-game balance. This screen doesn&apos;t use $CHOG or process purchases.</p></section></div><div className="app-gifts__grid">{receipts("sent")}{receipts("received")}</div><AppNav activeId="profile" /></div></main>{confirmation && enabled && quote && <Confirmation quote={quote} name={giftPeerName(selectedFriend)} cardName={selectedCard?.name ?? "card"} close={() => setConfirmation(false)} confirm={() => void submit()} />}</>;
}

export default function GiftsScreen() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();
  if (!ready) return <main className="app-stage app-stage--gate"><p role="status">Opening gifting...</p></main>;
  if (!authenticated || !user) return <main className="app-stage app-stage--gate"><section className="app-panel app-gate"><h1>Gifting</h1><p>Sign in to sponsor a friend&apos;s card upgrade.</p><button className="app-btn app-btn--save" onClick={() => login()}>Sign in</button><Link href="/app">Back to lobby</Link></section></main>;
  return <GiftsAccount key={user.id} getToken={getAccessToken} signOut={() => void logout()} />;
}
