"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import { availableToLend, LoanError, loanIntentKey, loanPeerName, loanRequest, parseLoanCommanders, parseLoanFriends, parseLoanLists, remainingLoanTime, validLoanDuration, type CommanderLoan, type LoanCommander, type LoanLists, type LoanPeer } from "./loans-model";
import "./loans.css";

const base = "/api/players/me/loans";
type Confirmation = { loan: CommanderLoan; action: "revoke" | "return" };
function Confirm({ value, close, confirm }: { value: Confirmation; close: () => void; confirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <dialog ref={ref} className="app-loans__dialog" aria-labelledby="loan-confirm-title" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}><h2 id="loan-confirm-title">{value.action === "revoke" ? "Revoke this loan?" : "Return this commander?"}</h2><p>{value.action === "revoke" ? "This prevents future match starts using the loan. Matches already locked and historical matches are unchanged." : "You'll give up temporary deployment access. Matches already locked and historical matches are unchanged."}</p><div className="app-loans__actions"><button autoFocus className="app-btn app-btn--ghost" onClick={close}>Keep loan</button><button className="app-btn app-btn--save" onClick={confirm}>{value.action === "revoke" ? "Revoke loan" : "Return commander"}</button></div></dialog>;
}
function CommanderArt({ commander }: { commander?: LoanCommander }) {
  return commander?.imageUrl ? <Image className="app-loans__art" src={commander.imageUrl} alt="" width={88} height={88} unoptimized /> : <span className="app-loans__art app-loans__art--missing">Genesis<br />NFT</span>;
}
function LoanRow({ loan, role, commander, peer, busy, onAction, onDetail, now }: { loan: CommanderLoan; role: "lent" | "borrowed"; commander?: LoanCommander; peer?: LoanPeer; busy: boolean; onAction: (value: Confirmation) => void; onDetail: (loan: CommanderLoan) => void; now: number }) {
  return <li className="app-loans__loan"><CommanderArt commander={commander} /><div className="app-loans__loan-copy"><div className="app-loans__row"><h3>{commander?.name || `Chog Genesis #${loan.tokenId}`}</h3><span className={`app-loans__badge app-loans__badge--${loan.status}`}>{loan.status}</span></div><p>{role === "lent" ? "Lent to" : "Borrowed from"} {loanPeerName(peer)}</p><p className="app-loans__fine">{role === "borrowed" ? "Temporary game access. You don't own this NFT." : "Your NFT stays in your wallet. Deployment is unavailable while lent."}</p><dl><div><dt>Started</dt><dd><time dateTime={loan.startsAt}>{new Date(loan.startsAt).toLocaleDateString()}</time></dd></div><div><dt>Expires</dt><dd><time dateTime={loan.endsAt}>{new Date(loan.endsAt).toLocaleString()}</time></dd></div></dl>{loan.status === "active" && <p className="app-loans__fine">{remainingLoanTime(loan.endsAt, now)}</p>}<div className="app-loans__actions"><button className="app-btn app-btn--ghost" disabled={busy} onClick={() => onDetail(loan)}>Check status</button>{loan.status === "active" && <button className="app-btn app-btn--ghost" disabled={busy} onClick={() => onAction({ loan, action: role === "lent" ? "revoke" : "return" })}>{role === "lent" ? "Revoke" : "Return early"}</button>}{role === "borrowed" && loan.status === "active" && <Link className="app-btn app-btn--save" href="/app/decks">Open deck</Link>}</div></div></li>;
}

function LoansAccount({ getToken, signOut }: { getToken: () => Promise<string | null>; signOut: () => void }) {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [loans, setLoans] = useState<LoanLists | null>(null);
  const [commanders, setCommanders] = useState<LoanCommander[] | null>(null);
  const [friends, setFriends] = useState<LoanPeer[] | null>(null);
  const [error, setError] = useState<LoanError | null>(null);
  const [inventoryError, setInventoryError] = useState<LoanError | null>(null);
  const [friendError, setFriendError] = useState<LoanError | null>(null);
  const [actionError, setActionError] = useState<LoanError | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tokenId, setTokenId] = useState("");
  const [borrowerId, setBorrowerId] = useState("");
  const [days, setDays] = useState(1);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [now, setNow] = useState(0);
  const live = useRef(true);
  const mutation = useRef(false);
  const read = useRef<Promise<void> | null>(null);
  const intent = useRef<{ signature: string; key: string } | null>(null);
  const load = useCallback(() => {
    if (read.current) return read.current;
    const work = async () => {
      setRefreshing(true);
      const results = await Promise.allSettled([
        loanRequest<{ player: ProfilePayload }>("/api/players/me", getToken),
        loanRequest<unknown>(base, getToken).then(parseLoanLists),
        loanRequest<unknown>("/api/players/me/commanders?fresh=1", getToken).then(parseLoanCommanders),
        loanRequest<unknown>("/api/players/me/friends", getToken).then(parseLoanFriends),
      ]);
      if (!live.current) return;
      if (results[0].status === "fulfilled") setProfile(results[0].value.player);
      if (results[1].status === "fulfilled") { setLoans(results[1].value); setError(null); } else setError(results[1].reason instanceof LoanError ? results[1].reason : new LoanError(503));
      if (results[2].status === "fulfilled") { setCommanders(results[2].value); setInventoryError(null); } else setInventoryError(results[2].reason instanceof LoanError ? results[2].reason : new LoanError(503));
      if (results[3].status === "fulfilled") { setFriends(results[3].value); setFriendError(null); } else setFriendError(new LoanError(results[3].reason instanceof LoanError ? results[3].reason.status : 503));
      setNow(Date.now()); setRefreshing(false);
    };
    read.current = work().finally(() => { read.current = null; });
    return read.current;
  }, [getToken]);
  useEffect(() => { live.current = true; void load(); const visible = () => { if (document.visibilityState === "visible") void load(); }; document.addEventListener("visibilitychange", visible); const timer = window.setInterval(() => { if (document.visibilityState === "visible") setNow(Date.now()); }, 60000); return () => { live.current = false; document.removeEventListener("visibilitychange", visible); window.clearInterval(timer); }; }, [load]);
  const act = async (path: string, body?: unknown, created = false) => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setActionError(null); setNotice(""); setConfirmation(null);
    try {
      await loanRequest(path, getToken, "POST", body);
      if (!live.current) return;
      if (created) intent.current = null;
      setNotice(created ? "Loan confirmed by the server. Your commander access is being refreshed." : "Loan action confirmed by the server. The current state is being refreshed.");
      // A visibility read may have started before the mutation completed.
      // Finish it first, then request a post-confirmation snapshot.
      if (read.current) await read.current;
      await load();
    } catch (failure) {
      if (!live.current) return;
      const next = failure instanceof LoanError ? failure : new LoanError(503);
      setActionError(next);
      if (next.status === 409 || next.status === 403 || next.status === 404) await load();
    } finally { mutation.current = false; if (live.current) setBusy(false); }
  };
  const locked = busy || refreshing || !!error;
  const eligible = commanders?.filter((entry) => availableToLend(entry, loans?.lent ?? [])) ?? [];
  const canSubmit = !locked && !inventoryError && !friendError && !!loans && eligible.some((entry) => entry.tokenId === tokenId) && !!friends?.some((friend) => friend.id === borrowerId) && validLoanDuration(days);
  const activeLent = loans?.lent.filter((loan) => loan.status === "active") ?? [];
  const activeBorrowed = loans?.borrowed.filter((loan) => loan.status === "active") ?? [];
  const history = loans ? [...loans.lent.map((loan) => ({ loan, role: "lent" as const })), ...loans.borrowed.map((loan) => ({ loan, role: "borrowed" as const }))].filter(({ loan }) => loan.status !== "active").sort((a, b) => b.loan.createdAt.localeCompare(a.loan.createdAt)) : [];
  const row = (loan: CommanderLoan, role: "lent" | "borrowed") => <LoanRow key={loan.id} loan={loan} role={role} commander={commanders?.find((entry) => entry.tokenId === loan.tokenId)} peer={friends?.find((friend) => friend.id === (role === "lent" ? loan.borrowerId : loan.ownerId))} now={now} busy={locked} onAction={setConfirmation} onDetail={(selected) => { if (mutation.current) return; mutation.current = true; setBusy(true); setActionError(null); void loanRequest<{ loan: CommanderLoan }>(`${base}/${selected.id}`, getToken).then(async (value) => { if (!live.current) return; parseLoanLists({ lent: [value.loan], borrowed: [] }); setNotice(`Current server status: ${value.loan.status}.`); await load(); }).catch((failure) => { if (live.current) setActionError(failure instanceof LoanError ? failure : new LoanError(503)); }).finally(() => { mutation.current = false; if (live.current) setBusy(false); }); }} />;
  return <><AppHud player={profile ? resolvePlayer(profile) : null} onSignOut={signOut} /><main className="app-stage"><div className="app-column app-loans" aria-busy={refreshing || busy}><header className="app-loans__heading"><div><p className="app-eyebrow">Genesis commanders</p><h1>Commander lending</h1><p>Share temporary battle access with a friend.</p></div><button className="app-btn app-btn--ghost" disabled={busy || refreshing} onClick={() => void load()}>{refreshing ? "Refreshing..." : "Refresh"}</button></header><nav className="app-loans__links" aria-label="Lending navigation"><Link href="/app/commanders">Commanders</Link><Link href="/app/decks">Decks</Link><Link href="/app/friends">Friends</Link></nav>{[error, actionError].filter(Boolean).map((failure, index) => <div className="app-loans__error" role="alert" key={index}><p>{failure?.message}</p><button className="app-btn app-btn--ghost" disabled={busy || refreshing} onClick={() => void load()}>Refresh state</button></div>)}{notice && <p className="app-loans__notice" role="status">{notice}</p>}{!loans && !error && <p role="status">Loading your loans...</p>}{error && loans && <p>The last verified loans remain visible. Actions are paused until refresh succeeds.</p>}<div className="app-loans__grid"><section className="app-panel app-loans__panel"><p className="app-loans__badge">Game access only</p><h2>Lend a commander</h2><p>The NFT stays in your wallet. Your friend gains temporary in-game deployment access, and you can&apos;t deploy it while lent. Access can expire or be revoked. This is not an NFT transfer.</p>{inventoryError && <p className="app-loans__error" role="alert">Your verified commander holdings are unavailable. Refresh before lending.</p>}{friendError && <p className="app-loans__error" role="alert">Accepted friends are unavailable. Refresh before choosing a borrower.</p>}<form onSubmit={(event) => { event.preventDefault(); if (!canSubmit) return; const signature = JSON.stringify([tokenId, borrowerId, days]); intent.current = loanIntentKey(intent.current, signature, () => crypto.randomUUID()); void act(base, { tokenId, borrowerId, durationDays: days, idempotencyKey: intent.current.key }, true); }}><fieldset disabled={locked || !!inventoryError || !!friendError}><legend className="app-sr-only">New commander loan</legend><label>Genesis commander<select className="app-settings-input" value={tokenId} onChange={(event) => setTokenId(event.target.value)} required><option value="">Choose a verified holding</option>{eligible.map((entry) => <option key={entry.tokenId} value={entry.tokenId}>{entry.name || `Chog Genesis #${entry.tokenId}`} · OWNED</option>)}</select></label>{commanders && !inventoryError && eligible.length === 0 && <p className="app-loans__fine">No lendable Genesis commander is available from your verified holdings. Active lent commanders remain unavailable.</p>}{tokenId && <div className="app-loans__selection"><CommanderArt commander={commanders?.find((entry) => entry.tokenId === tokenId)} /><p>Token #{tokenId}<br /><span className="app-loans__fine">Ownership is checked by the server when you submit.</span></p></div>}<label>Accepted friend<select className="app-settings-input" value={borrowerId} onChange={(event) => setBorrowerId(event.target.value)} required><option value="">Choose a friend</option>{friends?.map((friend) => <option key={friend.id} value={friend.id}>{loanPeerName(friend)}</option>)}</select></label>{friends?.length === 0 && <p className="app-loans__fine">No accepted friends to choose from. <Link href="/app/friends">Open Friends</Link>.</p>}<label>Loan duration<select className="app-settings-input" value={days} onChange={(event) => setDays(Number(event.target.value))}>{Array.from({ length: 7 }, (_, index) => <option value={index + 1} key={index}>{index + 1} {index === 0 ? "day" : "days"}</option>)}</select></label><p className="app-loans__fine" id="loan-submit-hint">Choose a commander, accepted friend and 1 to 7 days. Your loan begins only after server confirmation.</p><button className="app-btn app-btn--save" type="submit" disabled={!canSubmit} aria-describedby="loan-submit-hint">{busy ? "Waiting for confirmation..." : actionError ? "Retry loan submission" : "Lend commander"}</button></fieldset></form></section><section className="app-panel app-loans__panel"><p className="app-loans__badge">Temporary deployment access</p><h2>How lending works</h2><ul className="app-loans__rules"><li>Ownership stays with the lender.</li><li>The borrower selects the commander through the existing deck screen.</li><li>The battle server verifies the loan, friendship and ownership at match start.</li><li>Revocation prevents future starts. Already locked matches stay unchanged.</li></ul><p className="app-loans__fine">An expiry countdown is a display estimate. Server status decides access.</p></section></div>{loans && <><section className="app-panel app-loans__panel"><h2>Commanders I&apos;ve lent</h2>{activeLent.length === 0 ? <p>No active outgoing loans.</p> : <ul className="app-loans__list">{activeLent.map((loan) => row(loan, "lent"))}</ul>}</section><section className="app-panel app-loans__panel"><h2>Commanders I&apos;ve borrowed</h2>{activeBorrowed.length === 0 ? <p>No active borrowed commanders.</p> : <ul className="app-loans__list">{activeBorrowed.map((loan) => row(loan, "borrowed"))}</ul>}</section><section className="app-panel app-loans__panel"><h2>Loan history</h2>{history.length === 0 ? <p>No completed loans.</p> : <ul className="app-loans__list">{history.map(({ loan, role }) => row(loan, role))}</ul>}</section></>}<AppNav activeId="commanders" /></div></main>{confirmation && <Confirm value={confirmation} close={() => setConfirmation(null)} confirm={() => void act(`${base}/${confirmation.loan.id}/${confirmation.action}`)} />}</>;
}

export default function LoansScreen() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();
  if (!ready) return <main className="app-stage app-stage--gate"><p role="status">Opening commander lending...</p></main>;
  if (!authenticated || !user) return <main className="app-stage app-stage--gate"><section className="app-panel app-gate"><h1>Commander lending</h1><p>Sign in to lend a Genesis commander or view temporary access.</p><button className="app-btn app-btn--save" onClick={() => login()}>Sign in</button><Link href="/app">Back to lobby</Link></section></main>;
  return <LoansAccount key={user.id} getToken={getAccessToken} signOut={() => void logout()} />;
}
