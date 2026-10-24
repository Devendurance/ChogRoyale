export interface MessagePeer {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
}
export interface Conversation {
  conversationId: string;
  peer: MessagePeer;
  lastMessage: { id: string; sender: string; snippet: string; createdAt: string } | null;
  unread: number;
}
export interface Message {
  id: string;
  conversationId: string;
  sender: string;
  content: string;
  status: "sent" | "read";
  createdAt: string;
  readAt: string | null;
}
export interface MessagePage { messages: Message[]; nextCursor: string | null }
export function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<Message>;
  return typeof row.id === "string" && typeof row.conversationId === "string" && typeof row.sender === "string" && typeof row.content === "string" && typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)) && (row.status === "sent" || row.status === "read");
}
export function isConversation(value: unknown): value is Conversation {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<Conversation>;
  return typeof row.conversationId === "string" && typeof row.peer?.id === "string" && typeof row.unread === "number" && (row.lastMessage === null || (typeof row.lastMessage?.snippet === "string" && typeof row.lastMessage?.createdAt === "string" && Number.isFinite(Date.parse(row.lastMessage.createdAt))));
}
export class MessagingError extends Error {
  constructor(public status: number) { super(messageError(status)); }
}
export function messageError(status: number): string {
  if (status === 401) return "Your session expired. Sign in again to open messages.";
  if (status === 403) return "Messaging is unavailable for this conversation.";
  if (status === 404) return "This conversation is unavailable. Return to your inbox or open a friend from Friends.";
  if (status === 429) return "You're sending too quickly. Wait a minute before trying again.";
  if (status === 400) return "That message couldn't be accepted. Use 1 to 1,000 characters.";
  return "Messages couldn't reach the service. Your draft is still here. Try again shortly.";
}
export function peerName(peer: MessagePeer): string {
  return (typeof peer.displayName === "string" && peer.displayName.trim()) || (typeof peer.username === "string" && peer.username.trim()) || "Player";
}
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const rows = new Map(existing.map((m) => [m.id, m]));
  for (const message of incoming) rows.set(message.id, message);
  return [...rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export function validDraft(content: string): boolean {
  return content.trim().length > 0 && content.trim().length <= 1000;
}
export async function messagingRequest<T>(path: string, getToken: () => Promise<string | null>, body?: unknown): Promise<T> {
  try {
    const token = await getToken();
    if (!token) throw new MessagingError(401);
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new MessagingError(response.status);
    const envelope = await response.json();
    if (envelope.success !== true || envelope.data == null) throw new MessagingError(503);
    return envelope.data as T;
  } catch (error) {
    throw error instanceof MessagingError ? error : new MessagingError(503);
  }
}
