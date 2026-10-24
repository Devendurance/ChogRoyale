"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { getAvatar } from "@/lib/avatars";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import { ClanError, clanPeerName, clanRequest, isClanDetail, isClanInvite, isClanPeer, isMyClan, permissionsFor, validClanFields, type Clan, type ClanDetail, type ClanInvite, type ClanPeer, type MyClan } from "./clans-model";
import "./clans.css";

type GetToken = () => Promise<string | null>;
type Action = { path: string; method?: string; body?: unknown; success: string };
type Confirmation = Action & { title: string; explanation: string; label: string };
const base = "/api/players/me/clans";
const asError = (error: unknown) => error instanceof ClanError ? error : new ClanError(503);
const sameError = (left: ClanError | null, right: ClanError | null) => Boolean(left && right && left.status === right.status && left.message === right.message);

function Peer({ player }: { player: ClanPeer }) {
  const avatar = getAvatar(player.avatarId);
  return <div className="app-clans__peer">{avatar ? <Image src={avatar.assetUrl} alt="" width={40} height={40} /> : <span className="app-clans__avatar" aria-hidden="true">?</span>}<div><span>{clanPeerName(player)}</span>{player.username && <small>@{player.username}</small>}</div></div>;
}
function ErrorNotice({ error, retry }: { error: ClanError | null; retry: () => void }) {
  const { login } = useLogin();
  if (!error) return null;
  return <div className="app-clans__error" role="alert"><p>{error.message}</p><button className="app-btn app-btn--ghost" onClick={error.status === 401 ? () => login() : retry}>{error.status === 401 ? "Sign in" : "Refresh"}</button>{error.status === 403 && <Link className="app-btn app-btn--ghost" href="/app/profile">Open profile</Link>}</div>;
}

function ConfirmDialog({ confirmation, close, confirm }: { confirmation: Confirmation; close: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="app-clans__dialog" aria-labelledby="clan-confirm-title" aria-describedby="clan-confirm-copy" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}><h2 id="clan-confirm-title">{confirmation.title}</h2><p id="clan-confirm-copy">{confirmation.explanation}</p><div className="app-clans__actions"><button autoFocus className="app-btn app-btn--ghost" onClick={close}>Cancel</button><button className="app-btn app-btn--save" onClick={confirm}>{confirmation.label}</button></div></dialog>;
}

function ClanForm({ clan, busy, submit }: { clan?: Clan; busy: boolean; submit: (action: Action) => Promise<boolean> }) {
  const [name, setName] = useState(clan?.name ?? "");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState(clan?.description ?? "");
  const valid = validClanFields(name, description, clan ? undefined : tag);
  const changed = !clan || name !== clan.name || description !== (clan.description ?? "");
  return <form className="app-clans__form" onSubmit={(event) => {
    event.preventDefault();
    if (!valid || busy || !changed) return;
    void submit({ path: clan ? `${base}/${clan.id}` : base, method: clan ? "PATCH" : "POST", body: { name: name.trim().replace(/\s+/g, " "), description: description.trim() || null, ...(clan ? {} : { tag: tag.trim().toUpperCase() }) }, success: clan ? "Clan details saved." : "Clan created." });
  }}>
    <h2>{clan ? "Clan details" : "Create a clan"}</h2>
    <p>{clan ? "The owner can edit the name and description. The tag stays fixed." : "Start a clan as its owner, or accept an invitation below. You can belong to one clan at a time."}</p>
    <label>Clan name<input className="app-settings-input" value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={32} required disabled={busy} autoComplete="off" aria-describedby="clan-name-hint" /></label>
    <small id="clan-name-hint">3 to 32 characters. No &lt; or &gt; characters.</small>
    {!clan && <><label>Clan tag<input className="app-settings-input" value={tag} onChange={(event) => setTag(event.target.value.toUpperCase())} minLength={2} maxLength={6} pattern="[A-Za-z0-9]{2,6}" required disabled={busy} autoComplete="off" aria-describedby="clan-tag-hint" /></label><small id="clan-tag-hint">2 to 6 letters or digits. Your tag is permanent.</small></>}
    <label>Description<textarea className="app-settings-input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} rows={3} disabled={busy} aria-describedby="clan-description-hint" /></label><small id="clan-description-hint">{description.length}/280 characters. No &lt; or &gt; characters.</small>
    <button type="submit" className="app-btn app-btn--save" disabled={busy || !valid || !changed}>{busy ? "Checking server..." : clan ? "Save details" : "Create clan"}</button>
  </form>;
}

function ClansAccount({ getToken, signOut }: { getToken: GetToken; signOut: () => void }) {
  const [profile, setProfile] = useState<(ProfilePayload & { id: string }) | null>(null);
  const [membership, setMembership] = useState<MyClan | null>(null);
  const [detail, setDetail] = useState<ClanDetail | null>(null);
  const [invites, setInvites] = useState<ClanInvite[] | null>(null);
  const [friends, setFriends] = useState<ClanPeer[] | null>(null);
  const [clanError, setClanError] = useState<ClanError | null>(null);
  const [inviteError, setInviteError] = useState<ClanError | null>(null);
  const [friendError, setFriendError] = useState<ClanError | null>(null);
  const [actionError, setActionError] = useState<ClanError | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const live = useRef(true);
  const lock = useRef(false);
  const readLock = useRef<Promise<boolean> | null>(null);

  const load = useCallback((): Promise<boolean> => {
    if (readLock.current) return readLock.current;
    const work = async () => {
      setRefreshing(true);
      const [identity, current, invitationList, friendList] = await Promise.allSettled([
        clanRequest<{ player: ProfilePayload & { id: string } }>("/api/players/me", getToken),
        clanRequest<unknown>(base, getToken),
        clanRequest<{ invites: unknown[] }>(`${base}/invites`, getToken),
        clanRequest<{ friends: { player: ClanPeer }[] }>("/api/players/me/friends", getToken),
      ]);
      if (!live.current) return false;
      if (identity.status === "fulfilled" && identity.value.player && typeof identity.value.player.id === "string") setProfile(identity.value.player);
      else setProfile(null);
      let currentOk = false;
      try {
        if (current.status === "rejected") throw current.reason;
        if (!isMyClan(current.value)) throw new ClanError(503);
        let roster: ClanDetail | null = null;
        if (current.value.clan) {
          const result = await clanRequest<unknown>(`${base}/${current.value.clan.id}`, getToken);
          if (!isClanDetail(result) || result.clan.id !== current.value.clan.id || result.clan.status !== "active") throw new ClanError(503);
          roster = result;
        }
        if (!live.current) return false;
        setMembership(current.value);
        setDetail(roster);
        setClanError(null);
        currentOk = true;
      } catch (error) { if (live.current) setClanError(asError(error)); }
      if (!live.current) return false;
      if (invitationList.status === "fulfilled" && Array.isArray(invitationList.value.invites) && invitationList.value.invites.every(isClanInvite)) {
        setInvites(invitationList.value.invites);
        setInviteError(null);
      } else setInviteError(invitationList.status === "rejected" ? asError(invitationList.reason) : new ClanError(503));
      if (friendList.status === "fulfilled" && Array.isArray(friendList.value.friends) && friendList.value.friends.every((row) => row && isClanPeer(row.player))) {
        setFriends(friendList.value.friends.map((row) => row.player));
        setFriendError(null);
      } else setFriendError(friendList.status === "rejected" ? asError(friendList.reason) : new ClanError(503));
      return currentOk;
    };
    const pending = work().finally(() => { readLock.current = null; if (live.current) setRefreshing(false); });
    readLock.current = pending;
    return pending;
  }, [getToken]);
  useEffect(() => {
    live.current = true;
    const timer = setTimeout(() => void load(), 0);
    return () => { live.current = false; clearTimeout(timer); };
  }, [load]);

  async function act(action: Action): Promise<boolean> {
    if (lock.current || refreshing) return false;
    lock.current = true;
    setBusy(true);
    setActionError(null);
    setNotice("");
    setConfirmation(null);
    let successful = false;
    let failure: ClanError | null = null;
    try { await clanRequest(action.path, getToken, action.method ?? "POST", action.body); successful = true; }
    catch (error) { failure = asError(error); }
    const reread = await load();
    if (live.current) {
      if (failure) setActionError(failure);
      else setNotice(reread ? action.success : "The server accepted the change. Refresh to verify your current clan state.");
      setBusy(false);
    }
    lock.current = false;
    return successful && reread;
  }
  const locked = busy || refreshing;
  const membershipLocked = locked || clanError !== null;
  const clan = detail?.clan;
  const role = detail?.myRole;
  const owner = clan ? detail?.members.find((member) => member.player.id === clan.ownerId)?.player : undefined;
  const permissions = role ? permissionsFor(role) : null;
  const rosterIds = new Set(detail?.members.map((member) => member.player.id));
  const availableFriends = friends?.filter((friend) => !rosterIds.has(friend.id)) ?? [];

  return <><AppHud player={profile ? resolvePlayer(profile) : null} onSignOut={signOut} /><main className="app-stage"><div className="app-column app-clans" aria-busy={refreshing}>
    <header className="app-clans__heading"><div><p className="app-eyebrow">Your community</p><h1>Clans</h1><p>Your clan, roster and invitations in one place.</p></div><button className="app-btn app-btn--ghost" disabled={locked} onClick={() => { setNotice(""); void load(); }}>{refreshing ? "Refreshing..." : "Refresh"}</button></header>
    <div className="app-clans__links"><Link href="/app/friends">Friends</Link><Link href="/app/messages">Messages</Link><Link href="/app">Back to lobby</Link></div>
    <ErrorNotice error={actionError} retry={() => { setActionError(null); void load(); }} />
    {notice && <p className="app-clans__notice" role="status">{notice}</p>}
    <ErrorNotice error={clanError} retry={() => void load()} />
    {!membership && !clanError && <p role="status">Loading your clan...</p>}
    {clanError && membership && <p className="app-clans__hint">The last verified clan state is shown below. Membership controls are paused until a refresh succeeds.</p>}
    {membership?.clan === null && <section className="app-panel app-clans__panel"><p className="app-clans__badge">No active clan</p><ClanForm busy={membershipLocked} submit={act} /></section>}
    {clan && role && <fieldset className="app-clans__membership" disabled={membershipLocked}>
      <section className="app-panel app-clans__panel app-clans__summary"><div className="app-clans__crest" aria-hidden="true">{clan.tag}</div><div><p className="app-clans__badge">{role} · {clan.memberCount}/30 members</p><h2>{clan.name}</h2><p className="app-clans__description">{clan.description || "No description yet."}</p><p className="app-clans__hint">Owner: {owner ? clanPeerName(owner) : "Current owner"}</p></div></section>
      <div className="app-clans__grid"><section className="app-panel app-clans__panel"><h2>Clan roster</h2><p>Roles and membership reflect the last server refresh.</p><ul className="app-clans__list">{detail.members.map((member) => {
        const self = member.player.id === profile?.id;
        const allowed = permissionsFor(role, member.role, self || !profile);
        const name = clanPeerName(member.player);
        const memberPath = `${base}/${clan.id}/members/${member.player.id}`;
        return <li key={member.player.id}><div className="app-clans__row"><Peer player={member.player} /><span className="app-clans__badge">{member.role}{self ? " · You" : ""}</span></div><div className="app-clans__actions">
          {allowed.changeRole && <button className="app-btn app-btn--ghost" disabled={locked} onClick={() => setConfirmation({ title: member.role === "member" ? `Promote ${name}?` : `Demote ${name}?`, explanation: member.role === "member" ? "Officers can invite friends and remove members. Only the owner can change roles or clan details." : "This player will become a member and lose officer permissions.", label: member.role === "member" ? "Promote" : "Demote", path: `${memberPath}/role`, body: { role: member.role === "member" ? "officer" : "member" }, success: "Member role updated." })}>{member.role === "member" ? "Promote" : "Demote"}</button>}
          {allowed.remove && <button className="app-btn app-btn--ghost" disabled={locked} onClick={() => setConfirmation({ title: `Remove ${name}?`, explanation: "They'll leave the active roster. A new invitation is required to join again.", label: "Remove member", path: memberPath, method: "DELETE", success: "Member removed." })}>Remove</button>}
          {allowed.transfer && <button className="app-btn app-btn--ghost" disabled={locked} onClick={() => setConfirmation({ title: `Transfer ownership to ${name}?`, explanation: "They'll become the owner. You'll become a member and lose owner permissions. Only the new owner can transfer ownership back.", label: "Transfer ownership", path: `${base}/${clan.id}/transfer`, body: { playerId: member.player.id }, success: "Ownership transferred." })}>Transfer ownership</button>}
        </div></li>;
      })}</ul></section>
      <div className="app-clans__stack">{permissions?.invite && <section className="app-panel app-clans__panel"><h2>Invite a friend</h2><p>Only accepted friends can be invited. The server checks availability and capacity when you send.</p><ErrorNotice error={friendError} retry={() => void load()} />{!friendError && friends && availableFriends.length === 0 && <p>No accepted friends outside this roster. <Link href="/app/friends">Open Friends</Link>.</p>}{!friendError && <ul className="app-clans__list">{availableFriends.map((friend) => <li key={friend.id}><Peer player={friend} /><button className="app-btn app-btn--ghost" disabled={locked} onClick={() => void act({ path: `${base}/${clan.id}/invites`, body: { playerId: friend.id }, success: `Invitation confirmed for ${clanPeerName(friend)}. The invitation expires after seven days.` })}>Invite</button></li>)}</ul>}<p className="app-clans__hint">Invitations expire after seven days. Sending again keeps the existing pending invitation.</p></section>}
      {permissions?.edit && <section className="app-panel app-clans__panel"><ClanForm key={`${clan.id}:${clan.updatedAt}`} clan={clan} busy={locked} submit={act} /></section>}
      <section className="app-panel app-clans__panel"><h2>Membership</h2>{permissions?.leave ? <><p>Leaving frees your active clan slot. You&apos;ll need a new invitation to return.</p><button className="app-btn app-btn--ghost" disabled={locked} onClick={() => setConfirmation({ title: `Leave ${clan.name}?`, explanation: "You'll leave this roster and lose your clan role. A new invitation is required to return.", label: "Leave clan", path: `${base}/${clan.id}/leave`, success: "You left the clan." })}>Leave clan</button></> : <><p>The owner must transfer ownership before leaving, or archive the clan for everyone.</p><button className="app-btn app-btn--ghost" disabled={locked} onClick={() => setConfirmation({ title: `Archive ${clan.name}?`, explanation: "This archives the clan and clears active membership for everyone. History is retained. This screen cannot reactivate an archived clan.", label: "Archive clan", path: `${base}/${clan.id}/archive`, success: "Clan archived. Active memberships have been cleared." })}>Archive clan</button></>}</section></div></div>
    </fieldset>}
    <section className="app-panel app-clans__panel app-clans__invitations"><h2>Your invitations</h2><p>Invitations expire after seven days. Acceptance is checked again by the server.</p>{sameError(clanError, inviteError) ? <p className="app-clans__hint">Invitations are unavailable with the clan service. Use the refresh action above to try again.</p> : <ErrorNotice error={inviteError} retry={() => void load()} />}{!invites && !inviteError && <p role="status">Loading invitations...</p>}{!inviteError && invites?.length === 0 && <p>No pending invitations.</p>}{!inviteError && <ul className="app-clans__list">{invites?.map((invite) => <li key={invite.id}><div><h3>[{invite.clan.tag}] {invite.clan.name}</h3><p>Invited by {clanPeerName(invite.inviter)}</p><p className="app-clans__hint">Expires <time dateTime={invite.expiresAt}>{new Date(invite.expiresAt).toLocaleString()}</time></p></div><div className="app-clans__actions"><button className="app-btn app-btn--save" disabled={locked || clanError !== null || membership?.clan !== null || invite.status !== "pending"} onClick={() => setConfirmation({ title: `Join ${invite.clan.name}?`, explanation: "You'll join as a member. You can belong to only one active clan, and the server will recheck this invitation before joining.", label: "Join clan", path: `${base}/invites/${invite.id}/accept`, success: "Invitation accepted. You joined the clan." })}>Accept</button><button className="app-btn app-btn--ghost" disabled={locked || invite.status !== "pending"} onClick={() => void act({ path: `${base}/invites/${invite.id}/decline`, success: "Invitation declined." })}>Decline</button></div></li>)}</ul>}{!clanError && membership?.clan && <p className="app-clans__hint">Leave your current clan before accepting another invitation.</p>}</section>
    <AppNav activeId="profile" />
  </div></main>{confirmation && <ConfirmDialog confirmation={confirmation} close={() => setConfirmation(null)} confirm={() => void act(confirmation)} />}</>;
}

export default function ClansScreen() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();
  if (!ready) return <main className="app-stage app-stage--gate"><p role="status">Opening clans...</p></main>;
  if (!authenticated || !user) return <main className="app-stage app-stage--gate"><section className="app-panel app-gate"><h1>Clans</h1><p>Sign in to view your clan and invitations.</p><button className="app-btn app-btn--save" onClick={() => login()}>Sign in</button><Link href="/app">Back to lobby</Link></section></main>;
  return <ClansAccount key={user.id} getToken={getAccessToken} signOut={() => void logout()} />;
}
