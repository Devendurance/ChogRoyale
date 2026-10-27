"use client";

// The friends view (B4.1). Pure presentation: every value arrives as a plain
// prop, so this renders the same way from the authenticated container and
// from a static preview with sample data.
//
// Rows show only the identity the server returns (username, display name,
// avatar). No wallet address, player id or Privy identifier is rendered.

import { useState } from "react";
import "./friends.css";
import Link from "next/link";
import Image from "next/image";
import { getAvatar } from "@/lib/avatars";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import AppNotice from "./AppNotice";
import Icon from "./icons";
import { dedupeNotices } from "./feedback-model";
import { friendHandle, friendName, listChip, searchAction, searchChip } from "./friends-model";
import type { FriendEntry, FriendsViewProps } from "./friends-types";

function FriendAvatar({ avatarId }: { avatarId: string | null }) {
  const avatar = getAvatar(avatarId);
  return <span className="app-friend__avatar" aria-hidden="true">{avatar ? <Image src={avatar.assetUrl} width={40} height={40} alt="" unoptimized /> : <Icon name="user" size={22} />}</span>;
}

function FriendRow({
  entry,
  actionId,
  onAccept,
  onDecline,
  onRemove,
  onBlock,
}: {
  entry: FriendEntry;
  actionId: string | null;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onRemove: (id: string) => void;
  onBlock: (playerId: string) => void;
}) {
  const busy = actionId === entry.friendshipId;
  const blockBusy = actionId === `block:${entry.player.id}`;
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="app-friend">
      <FriendAvatar avatarId={entry.player.avatarId} />
      <span className="app-friend__names">
        <span className="app-friend__name">{friendName({ player: entry.player })}</span>
        <span className="app-friend__handle">{friendHandle({ player: entry.player })}</span>
      </span>
      <span className="app-badge">{listChip(entry)}</span>
      <span className="app-friend__actions">
        {entry.status === "accepted" && <Link className="app-btn app-btn--save" href={`/app/messages?player=${encodeURIComponent(entry.player.id)}`}>Message</Link>}
        {entry.status === "accepted" && <Link className="app-btn app-btn--ghost" href="/app/gifts">Gift</Link>}
        {entry.status === "pending" && entry.incoming ? (
          <>
            <button
              type="button"
              className="app-btn app-btn--save"
              disabled={busy}
              onClick={() => onAccept(entry.friendshipId)}
            >
              {busy ? "Working" : "Accept"}
            </button>
            <button
              type="button"
              className="app-btn app-btn--ghost"
              disabled={busy}
              onClick={() => onDecline(entry.friendshipId)}
            >
              {busy ? "Working" : "Decline"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="app-btn app-btn--ghost"
            disabled={busy}
            onClick={() => {
              const name = friendName({ player: entry.player });
              if (window.confirm(entry.status === "accepted" ? `Remove ${name} from your friends?` : `Cancel your friend request to ${name}?`)) onRemove(entry.friendshipId);
            }}
          >
            {busy ? "Working" : entry.status === "accepted" ? "Remove" : "Cancel"}
          </button>
        )}
        {confirming ? (
          <>
          <button
            type="button"
            className="app-btn app-btn--ghost"
            disabled={blockBusy}
            onClick={() => {
              setConfirming(false);
              onBlock(entry.player.id);
            }}
          >
            {blockBusy ? "Working" : "Confirm block"}
          </button>
          <button type="button" className="app-btn app-btn--ghost" onClick={() => setConfirming(false)}>Cancel block</button>
          </>
        ) : (
          <button
            type="button"
            className="app-btn app-btn--ghost"
            disabled={blockBusy}
            onClick={() => setConfirming(true)}
          >
            Block
          </button>
        )}
      </span>
    </li>
  );
}

export default function FriendsView({
  phase,
  player,
  lists,
  listsState,
  searchQuery,
  searchHits,
  searchState,
  actionId,
  busy,
  notices,
  calm,
  status,
  onSignIn,
  onSignOut,
  onRefresh,
  onSearchChange,
  onSearch,
  onSend,
  onAccept,
  onDecline,
  onRemove,
  blocked,
  blockedState,
  onBlock,
  onUnblock,
}: FriendsViewProps) {
  const [confirmBlockId, setConfirmBlockId] = useState<string | null>(null);
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
            <h1 className="app-gate__title">Opening your friends</h1>
            <p className="app-gate__lead">Connecting to your Chog Royale account.</p>
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
              <Icon name="friends" size={36} />
            </span>
            <h1 className="app-gate__title">Chog Royale</h1>
            <p className="app-gate__lead">
              Friends holds your Chog Royale friends and requests. Sign in to load the real list.
            </p>
            <button type="button" className="app-btn app-btn--battle" onClick={onSignIn}>
              <Icon name="user" size={22} />
              Log in
            </button>
            <p className="app-gate__note">Sign-in runs through Privy. Nothing on this screen is editable before then.</p>
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
            <h1 className="app-gate__title">Your friends could not be opened</h1>
            {noticeList.length > 0 ? (
              <div className="app-gate__notices">{noticeList}</div>
            ) : (
              <p className="app-gate__lead">Your friends list could not be read.</p>
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

  return (
    <>
      <AppHud player={player} onSignOut={onSignOut} />

      <main className={`app-stage app-stage--wide friends-page${calm ? " app-calm" : ""}`}>
        <div className="app-column app-column--wide">
          {noticeList.length > 0 && <div className="app-column__notices">{noticeList}</div>}

          <header className="app-settings-head friends-head app-rise">
            <p className="app-settings-head__eyebrow">Social</p>
            <h1 className="app-settings-head__title">Friends</h1>
            <Link className="app-btn app-btn--ghost friends-head__messages" href="/app/messages"><Icon name="friends" size={18} />Open messages</Link>
            <p className="app-settings-head__lead">
              Find your people. Add friends, catch up, and get ready for the next battle.
            </p>
          </header>

            <div className="friends-identity">
              <section className="app-panel friends-identity__panel app-rise" aria-labelledby="app-friends-you-title">
                <h2 className="app-profile-panel__title" id="app-friends-you-title">
                  Playing as
                </h2>
                <div className="app-profile-id__names">
                  <p className="app-profile-id__name">{displayName}</p>
                  <p className="app-profile-id__handle">
                    {player?.username ? `@${player.username}` : "No username yet"}
                  </p>
                  <div className="app-profile-id__chips">
                    <span className="app-badge">
                      {listsState === "unavailable" ? "List unavailable" : lists.friends.length === 1 ? "1 friend" : `${lists.friends.length} friends`}
                    </span>
                    {listsState !== "unavailable" && lists.incoming.length > 0 ? (
                      <span className="app-badge">
                        {lists.incoming.length === 1 ? "1 request" : `${lists.incoming.length} requests`}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="app-profile-account__actions">
                  <button type="button" className="app-btn app-btn--ghost" onClick={onRefresh} disabled={busy}>
                    <Icon name="refresh" size={16} />
                    {busy ? "Refreshing" : "Refresh"}
                  </button>
                </div>
              </section>
            </div>

          <div className="friends-layout">
            <div className="friends-sections">
              <section className="app-panel friends-discover app-rise" aria-labelledby="app-friends-discover-title">
                <h2 className="app-profile-panel__title" id="app-friends-discover-title">
                  Find a friend
                </h2>
                <form
                  className="app-settings-form friends-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSearch();
                  }}
                >
                  <div className="app-settings-field">
                    <label className="app-settings-field__label" htmlFor="app-friends-search">
                      Search by username
                    </label>
                    <input
                      id="app-friends-search"
                      className="app-settings-input"
                      type="search"
                      value={searchQuery}
                      autoComplete="off"
                      placeholder="Type a username"
                      disabled={busy}
                      onChange={(event) => onSearchChange(event.target.value)}
                    />
                  </div>
                  <div className="app-settings-save">
                    <button
                      type="submit"
                      className="app-btn app-btn--save"
                      disabled={busy || searchQuery.trim().length === 0}
                    >
                      {busy ? "Searching" : "Search"}
                    </button>
                  </div>
                </form>

                {searchState === "unavailable" ? (
                  <p className="app-profile-note">Search is not available right now. Try again shortly.</p>
                ) : searchHits === null ? null : searchHits.length === 0 ? (
                  <p className="app-profile-note">No players match that username yet.</p>
                ) : (
                  <ul className="app-friends-list">
                    {searchHits.map((hit) => {
                      const action = searchAction(hit);
                      const chip = searchChip(hit);
                      const hitBusy = actionId === hit.player.id;
                      const blockBusy = actionId === `block:${hit.player.id}`;
                      const confirming = confirmBlockId === hit.player.id;
                      return (
                        <li key={hit.player.id} className="app-friend">
                          <FriendAvatar avatarId={hit.player.avatarId} />
                          <span className="app-friend__names">
                            <span className="app-friend__name">{friendName({ player: hit.player })}</span>
                            <span className="app-friend__handle">{friendHandle({ player: hit.player })}</span>
                          </span>
                          {chip ? <span className="app-badge">{chip}</span> : null}
                          <span className="app-friend__actions">
                            {action ? (
                              <button
                                type="button"
                                className="app-btn app-btn--save"
                                disabled={busy || hitBusy}
                                onClick={() =>
                                  action === "Add" ? onSend(hit.player.id) : onAccept(hit.friendshipId ?? "")
                                }
                              >
                                {hitBusy ? "Working" : action}
                              </button>
                            ) : null}
                            {confirming ? (
                              <>
                              <button
                                type="button"
                                className="app-btn app-btn--ghost"
                                disabled={busy || blockBusy}
                                onClick={() => {
                                  setConfirmBlockId(null);
                                  onBlock(hit.player.id);
                                }}
                              >
                                {blockBusy ? "Working" : "Confirm block"}
                              </button>
                              <button type="button" className="app-btn app-btn--ghost" onClick={() => setConfirmBlockId(null)}>Cancel block</button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="app-btn app-btn--ghost"
                                disabled={busy || blockBusy}
                                onClick={() => setConfirmBlockId(hit.player.id)}
                              >
                                Block
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="app-panel app-rise" aria-labelledby="app-friends-requests-title" style={{ animationDelay: "90ms" }}>
                <h2 className="app-profile-panel__title" id="app-friends-requests-title">
                  Requests
                </h2>
                {listsState === "unavailable" ? (
                  <p className="app-profile-note">Requests are not available right now. Try again shortly.</p>
                ) : lists.incoming.length === 0 && lists.outgoing.length === 0 ? (
                  <p className="app-profile-note">No pending requests. New requests you send or receive show up here.</p>
                ) : (
                  <>
                    {lists.incoming.length > 0 ? (
                      <>
                        <h3 className="app-profile-caption">Incoming</h3>
                        <ul className="app-friends-list">
                          {lists.incoming.map((entry) => (
                            <FriendRow
                              key={entry.friendshipId}
                              entry={entry}
                              actionId={actionId}
                              onAccept={onAccept}
                              onDecline={onDecline}
                              onRemove={onRemove}
                              onBlock={onBlock}
                            />
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {lists.outgoing.length > 0 ? (
                      <>
                        <h3 className="app-profile-caption">Sent</h3>
                        <ul className="app-friends-list">
                          {lists.outgoing.map((entry) => (
                            <FriendRow
                              key={entry.friendshipId}
                              entry={entry}
                              actionId={actionId}
                              onAccept={onAccept}
                              onDecline={onDecline}
                              onRemove={onRemove}
                              onBlock={onBlock}
                            />
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </>
                )}
              </section>

              <section className="app-panel app-rise" aria-labelledby="app-friends-list-title" style={{ animationDelay: "150ms" }}>
                <h2 className="app-profile-panel__title" id="app-friends-list-title">
                  Your friends
                </h2>
                {listsState === "unavailable" ? (
                  <p className="app-profile-note">Your friends list is not available right now. Try again shortly.</p>
                ) : lists.friends.length === 0 ? (
                  <p className="app-profile-note">
                    No friends yet. Search above to find players and send your first request.
                  </p>
                ) : (
                  <ul className="app-friends-list">
                    {lists.friends.map((entry) => (
                      <FriendRow
                        key={entry.friendshipId}
                        entry={entry}
                        actionId={actionId}
                        onAccept={onAccept}
                        onDecline={onDecline}
                        onRemove={onRemove}
                        onBlock={onBlock}
                      />
                    ))}
                  </ul>
                )}
              </section>

              <section className="app-panel friends-blocked app-rise" aria-labelledby="app-friends-blocked-title" style={{ animationDelay: "180ms" }}>
                <h2 className="app-profile-panel__title" id="app-friends-blocked-title">
                  Blocked players
                </h2>
                {blockedState === "unavailable" ? (
                  <p className="app-profile-note">Blocked players are not available right now. Try again shortly.</p>
                ) : blocked.length === 0 ? (
                  <p className="app-profile-note">No blocked players. Blocking ends the friendship and stops new requests.</p>
                ) : (
                  <ul className="app-friends-list">
                    {blocked.map((item) => {
                      const unblockBusy = actionId === `unblock:${item.player.id}`;
                      return (
                        <li key={item.player.id} className="app-friend">
                          <FriendAvatar avatarId={item.player.avatarId} />
                          <span className="app-friend__names">
                            <span className="app-friend__name">{friendName({ player: item.player })}</span>
                            <span className="app-friend__handle">{friendHandle({ player: item.player })}</span>
                          </span>
                          <span className="app-badge">Blocked</span>
                          <span className="app-friend__actions">
                            <button
                              type="button"
                              className="app-btn app-btn--ghost"
                              disabled={busy || unblockBusy}
                              onClick={() => onUnblock(item.player.id)}
                            >
                              {unblockBusy ? "Working" : "Unblock"}
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>


          </div>

          <p className="app-sr" role="status" aria-live="polite">
            {status}
          </p>
        </div>

        <AppNav activeId="friends" />
      </main>
    </>
  );
}
