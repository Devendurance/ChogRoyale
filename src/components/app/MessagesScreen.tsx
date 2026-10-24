"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getAvatar } from "@/lib/avatars";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import AppHud from "./AppHud";
import AppNav from "./AppNav";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import type { FriendLists } from "./friends-types";
import { MessagingError, isConversation, isMessage, mergeMessages, messagingRequest, peerName, validDraft, type Conversation, type Message, type MessagePage } from "./messages-model";
import "./messages.css";

type GetToken = () => Promise<string | null>;
const errorFor = (error: unknown) => error instanceof MessagingError ? error : new MessagingError(503);
function PeerAvatar({ avatarId }: { avatarId: string | null }) {
  const avatar = getAvatar(avatarId);
  return avatar ? <Image className="app-messages__avatar" src={avatar.assetUrl} alt="" width={36} height={36} /> : <span className="app-messages__avatar" aria-hidden="true">?</span>;
}

function ErrorNotice({ error, retry }: { error: MessagingError | null; retry: () => void }) {
  const { login } = useLogin();
  if (!error) return null;
  return <div className="app-messages__error" role="alert"><p>{error.message}</p><button className="app-btn app-btn--ghost" onClick={error.status === 401 ? () => login() : retry}>{error.status === 401 ? "Sign in" : "Try again"}</button></div>;
}

function ConversationPane({ conversation, canSend, getToken, changed }: { conversation: Conversation; canSend: boolean; getToken: GetToken; changed: () => void }) {
  const id = conversation.conversationId;
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<MessagingError | null>(null);
  const [sendError, setSendError] = useState<MessagingError | null>(null);
  const [receiptError, setReceiptError] = useState<MessagingError | null>(null);
  const [pollPaused, setPollPaused] = useState(false);
  const live = useRef(true);
  const reading = useRef(false);
  const sendLock = useRef(false);
  const pages = useRef(1);
  const attempt = useRef<{ content: string; key: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const acknowledged = useRef(new Set<string>());

  const read = useCallback(async (more = false) => {
    if (reading.current) return;
    reading.current = true;
    setBusy(true);
    try {
      let next: string | null = more ? cursor : null;
      let rows: Message[] = [];
      const count = more ? 1 : pages.current;
      for (let i = 0; i < count; i++) {
        const page: MessagePage = await messagingRequest(`/api/players/me/messages/${id}?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, getToken);
        if (!Array.isArray(page.messages) || !page.messages.every(isMessage) || (page.nextCursor !== null && typeof page.nextCursor !== "string")) throw new MessagingError(503);
        rows = mergeMessages(rows, page.messages);
        next = page.nextCursor;
        if (!next) break;
      }
      if (!live.current) return;
      setMessages((old) => mergeMessages(old, rows));
      setCursor(next);
      if (more) pages.current++;
      setLoaded(true);
      setError(null);
    } catch (e) { if (live.current) setError(errorFor(e)); }
    finally { reading.current = false; if (live.current) setBusy(false); }
  }, [cursor, getToken, id]);
  const readRef = useRef(read);
  useEffect(() => { readRef.current = read; }, [read]);
  useEffect(() => {
    live.current = true;
    let ticks = 0;
    const first = setTimeout(() => void readRef.current(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      if (++ticks > 30) { setPollPaused(true); return; }
      void readRef.current();
    }, 10_000);
    return () => { live.current = false; clearTimeout(first); clearInterval(timer); };
  }, []);

  useEffect(() => {
    const root = log.current;
    if (!root || !loaded) return;
    let inFlight = false;
    const acknowledge = async () => {
      if (inFlight || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const box = root.getBoundingClientRect();
      const visible = [...root.querySelectorAll<HTMLElement>("[data-received]")].filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom <= Math.min(box.bottom, window.innerHeight - 64) && rect.top >= Math.max(box.top, 0) && !acknowledged.current.has(row.dataset.received!);
      });
      const messageId = visible.at(-1)?.dataset.received;
      if (!messageId) return;
      inFlight = true;
      try {
        await messagingRequest(`/api/players/me/messages/${id}/read`, getToken, { messageId });
        if (!live.current) return;
        for (const row of visible) acknowledged.current.add(row.dataset.received!);
        setReceiptError(null);
        changed();
      } catch (e) { if (live.current) setReceiptError(errorFor(e)); }
      finally { inFlight = false; }
    };
    const observer = new IntersectionObserver(() => void acknowledge(), { root, threshold: 1 });
    root.querySelectorAll("[data-received]").forEach((row) => observer.observe(row));
    window.addEventListener("focus", acknowledge);
    return () => { observer.disconnect(); window.removeEventListener("focus", acknowledge); };
  }, [messages, loaded, getToken, id, changed]);

  async function send() {
    if (!canSend || !validDraft(draft) || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setSendError(null);
    const content = draft.trim();
    if (!attempt.current || attempt.current.content !== content) attempt.current = { content, key: crypto.randomUUID() };
    try {
      const result = await messagingRequest<{ message: Message }>("/api/players/me/messages", getToken, { conversationId: id, content, idempotencyKey: attempt.current.key });
      if (!isMessage(result.message)) throw new MessagingError(503);
      if (!live.current) return;
      setMessages((old) => mergeMessages(old, [result.message]));
      setDraft("");
      attempt.current = null;
      changed();
    } catch (e) { if (live.current) setSendError(errorFor(e)); }
    finally { sendLock.current = false; if (live.current) setSending(false); }
  }
  const locked = !canSend || sendError?.status === 403 || sendError?.status === 404;
  return <section className="app-panel app-messages__thread" aria-labelledby="message-peer">
    <header className="app-messages__thread-head"><Link className="app-btn app-btn--ghost app-messages__back" href="/app/messages">Back to inbox</Link><div><h2 id="message-peer">{peerName(conversation.peer)}</h2><p>{conversation.peer.username ? `@${conversation.peer.username}` : "Private conversation"}</p></div><button className="app-btn app-btn--ghost" disabled={busy} onClick={() => void read()}>Refresh</button></header>
    <ErrorNotice error={error} retry={() => void read()} />
    <div className="app-messages__log" ref={log} role="region" aria-label="Message history" tabIndex={0} aria-busy={busy}>
      {!loaded && !error && <p role="status">Loading messages...</p>}
      {loaded && messages.length === 0 && <p>No messages yet. Say hello to your friend.</p>}
      <ol>{messages.map((message) => {
        const incoming = message.sender === conversation.peer.id;
        return <li key={message.id} className={`app-messages__bubble${incoming ? "" : " app-messages__bubble--mine"}`} data-received={incoming && message.status !== "read" ? message.id : undefined}><span className="app-messages__sender">{incoming ? peerName(conversation.peer) : "You"}</span><p>{message.content}</p><small><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>{!incoming && ` · ${message.status === "read" ? "Read" : "Sent"}`}</small></li>;
      })}</ol>
      {cursor && <button className="app-btn app-btn--ghost" disabled={busy} onClick={() => void read(true)}>{busy ? "Loading" : "Load more messages"}</button>}
    </div>
    <div className="app-messages__receipt" role="status">{receiptError ? "Read confirmation is unavailable. Refresh to try again." : "Sent means stored by the server. Read means your friend opened the message."}{pollPaused && " Automatic refresh paused. Use Refresh for new messages."}</div>
    <form className="app-messages__composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {locked && <p>Sending is unavailable. You must be accepted friends to message.</p>}
      <ErrorNotice error={sendError} retry={() => void send()} />
      <label htmlFor="message-draft">Message</label><textarea id="message-draft" className="app-settings-input" value={draft} maxLength={1000} rows={3} disabled={locked || sending} onChange={(event) => { setDraft(event.target.value); setSendError(null); }} aria-describedby="message-count" />
      <div className="app-messages__compose-actions"><span id="message-count">{draft.length}/1,000</span><button className="app-btn app-btn--save" disabled={locked || sending || !validDraft(draft)} type="submit">{sending ? "Sending" : sendError ? "Retry send" : "Send"}</button></div>
    </form>
  </section>;
}

function MessagesAccount({ getToken, signOut }: { getToken: GetToken; signOut: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const conversationId = params.get("conversation");
  const startPlayer = params.get("player");
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<MessagingError | null>(null);
  const [startRetry, setStartRetry] = useState(0);
  const live = useRef(true);
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const [identity, inbox, friends] = await Promise.all([
        messagingRequest<{ player: ProfilePayload }>("/api/players/me", getToken),
        messagingRequest<{ conversations: Conversation[] }>("/api/players/me/messages", getToken),
        messagingRequest<FriendLists>("/api/players/me/friends", getToken),
      ]);
      if (!Array.isArray(inbox.conversations) || !inbox.conversations.every(isConversation) || !Array.isArray(friends.friends) || !identity.player) throw new MessagingError(503);
      if (!live.current) return;
      setProfile(identity.player);
      setConversations(inbox.conversations);
      setFriendIds(friends.friends.map((friend) => friend.player.id));
      setLoaded(true);
      setError(null);
    } catch (e) { if (live.current) setError(errorFor(e)); }
    finally { loading.current = false; }
  }, [getToken]);
  useEffect(() => {
    live.current = true;
    const first = setTimeout(() => void load(), 0);
    let polls = 0;
    const interval = setInterval(() => { if (document.visibilityState === "visible" && document.hasFocus() && ++polls <= 30) void load(); }, 10_000);
    return () => { live.current = false; clearTimeout(first); clearInterval(interval); };
  }, [load]);
  useEffect(() => {
    if (!startPlayer || !loaded) return;
    let active = true;
    void messagingRequest<{ conversationId: string }>("/api/players/me/messages/conversations", getToken, { peerId: startPlayer }).then(async (result) => {
      if (!active) return;
      await load();
      if (active) router.replace(`/app/messages?conversation=${encodeURIComponent(result.conversationId)}`);
    }).catch((e) => { if (active) setError(errorFor(e)); });
    return () => { active = false; };
  }, [startPlayer, loaded, startRetry, getToken, load, router]);
  const selected = conversations.find((entry) => entry.conversationId === conversationId);
  return <><AppHud player={profile ? resolvePlayer(profile) : null} onSignOut={signOut} /><main className="app-stage"><div className="app-column app-messages">
    <header className="app-messages__heading"><div><p className="app-eyebrow">Friends</p><h1>Messages</h1><p>Private conversations with your accepted friends.</p></div><Link className="app-btn app-btn--ghost" href="/app/friends">Open Friends</Link></header>
    <ErrorNotice error={error} retry={() => { void load(); if (startPlayer) setStartRetry((value) => value + 1); }} />
    <div className={`app-messages__layout${selected ? " app-messages__layout--selected" : ""}`}>
      <section className="app-panel app-messages__inbox" aria-labelledby="messages-inbox"><header><h2 id="messages-inbox">Inbox</h2><button className="app-btn app-btn--ghost" onClick={() => void load()}>Refresh</button></header>
        <p className="app-messages__receipt">Refreshes while this page is visible for up to five minutes. Use Refresh any time.</p>
        {!loaded && !error && <p role="status">{startPlayer ? "Opening conversation..." : "Loading your inbox..."}</p>}
        {loaded && !error && conversations.length === 0 && <p>No conversations yet. Open Friends and choose Message beside an accepted friend.</p>}
        {error && <p>Your inbox is unavailable. Refresh to check again.</p>}
        {!error && <ul>{conversations.map((entry) => <li key={entry.conversationId}><Link href={`/app/messages?conversation=${entry.conversationId}`} className={`app-messages__conversation${selected === entry ? " app-messages__conversation--active" : ""}`} aria-current={selected === entry ? "page" : undefined}><PeerAvatar avatarId={entry.peer.avatarId} /><span className="app-messages__peer">{peerName(entry.peer)}</span><span className="app-messages__snippet">{entry.lastMessage?.snippet || "Start a conversation"}</span>{entry.lastMessage && <time className="app-messages__time" dateTime={entry.lastMessage.createdAt}>{new Date(entry.lastMessage.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>}{entry.unread > 0 && <span className="app-messages__unread" aria-label={`${entry.unread} unread messages`}>{entry.unread}</span>}</Link></li>)}</ul>}
      </section>
      {selected ? <ConversationPane key={selected.conversationId} conversation={selected} canSend={friendIds.includes(selected.peer.id)} getToken={getToken} changed={load} /> : <section className="app-panel app-messages__placeholder"><h2>{conversationId && loaded ? "Conversation unavailable" : "Your conversations"}</h2><p>{conversationId && loaded ? "Choose a conversation in your inbox or open an accepted friend from Friends." : "Choose a conversation to read and reply."}</p></section>}
    </div><AppNav activeId="profile" />
  </div></main></>;
}

export default function MessagesScreen() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();
  if (!ready) return <main className="app-stage app-stage--gate"><p role="status">Opening messages...</p></main>;
  if (!authenticated || !user) return <main className="app-stage app-stage--gate"><section className="app-panel app-gate"><h1>Messages</h1><p>Sign in to open private conversations with your friends.</p><button className="app-btn app-btn--save" onClick={() => login()}>Sign in</button><Link href="/app">Back to lobby</Link></section></main>;
  return <MessagesAccount key={user.id} getToken={getAccessToken} signOut={() => void logout()} />;
}
