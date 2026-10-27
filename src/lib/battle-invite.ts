/** Colyseus generates case-sensitive nanoid(9) room identifiers. */
export function validRoomCode(value: string | null | undefined): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{9}$/.test(value.trim()) ? value.trim() : null;
}

export function battleInvitePath(room: string): string | null {
  const code = validRoomCode(room);
  return code ? `/app/play/battle?mode=private&room=${encodeURIComponent(code)}` : null;
}

export function battleInviteUrl(origin: string, room: string): string | null {
  const path = battleInvitePath(room);
  return path ? new URL(path, origin).href : null;
}

/** Accept only this one internal return destination, never arbitrary next URLs. */
export function inviteReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith("/app/play/battle?")) return null;
  const url = new URL(value, "https://invite.invalid");
  const room = url.searchParams.get("room");
  return url.pathname === "/app/play/battle" && url.searchParams.get("mode") === "private" && room ? battleInvitePath(room) : null;
}

export function roomJoinError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/full|maxclients|seat.*reserved/i.test(message)) return "This room is full. Ask your friend for a new invitation.";
  if (/locked/i.test(message)) return "This room is full or its battle has already started. Ask your friend for a new invitation.";
  if (/started|battle is over|resume not authorized/i.test(message)) return "This battle has already started or ended. Ask your friend for a new invitation.";
  if (/not found|expired|disposed|does not exist|invalid room/i.test(message)) return "This room has expired or is no longer available. Check the code with your friend.";
  if (/already.*(room|queue|connected|battle)/i.test(message)) return "You're already in a room or queue. Leave it before joining this invitation.";
  return "Couldn't join this room. Check your connection and try again.";
}

export async function copyInviteText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* Older browsers and denied permissions use the selectable fallback. */ }
  const previous = document.activeElement;
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(input);
  input.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch { /* Leave manual selection available in the UI. */ }
  input.remove();
  if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  return copied;
}
