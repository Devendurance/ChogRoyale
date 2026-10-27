import { afterEach, describe, expect, it, vi } from "vitest";
import { battleInvitePath, battleInviteUrl, copyInviteText, hasMatchingInviteResume, inviteReturnPath, roomJoinError, validRoomCode } from "./battle-invite";

describe("private battle invitations", () => {
  it("preserves the generated case-sensitive nanoid alphabet", () => {
    expect(validRoomCode(" aB_12-xY9 ")).toBe("aB_12-xY9");
    for (const invalid of ["", "short", "toolong1234", "../secret", "abc?12345", "abc/12345", "abc 12345"]) expect(validRoomCode(invalid)).toBeNull();
  });
  it("shares only the current origin and a validated private room", () => {
    expect(battleInviteUrl("https://chogroyale.xyz/dev/battle?token=secret", "aB_12-xY9")).toBe("https://chogroyale.xyz/app/play/battle?mode=private&room=aB_12-xY9");
    expect(battleInvitePath("evil/room")).toBeNull();
  });
  it("allows only canonical room destinations after onboarding", () => {
    const path = battleInvitePath("aB_12-xY9")!;
    expect(inviteReturnPath(path + "&token=never-retained")).toBe(path);
    for (const value of ["https://evil.test", "//evil.test", "/app", "/app/play/battle?mode=ranked&room=aB_12-xY9", "/app/play/battle?mode=private&room=bad"]) expect(inviteReturnPath(value)).toBeNull();
  });
  it("keeps refusal states useful without displaying raw service errors", () => {
    expect(roomJoinError(new Error("room is full"))).toContain("full");
    expect(roomJoinError(new Error("Battle already started"))).toContain("already started");
    expect(roomJoinError(new Error("room not found"))).toContain("expired");
    expect(roomJoinError(new Error("private backend connection details"))).toBe("Couldn't join this room. Check your connection and try again.");
  });
});

describe("invitation clipboard", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("copies through the browser clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyInviteText("room-link")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("room-link");
  });
  it("falls back after clipboard permission rejection and restores focus", async () => {
    class Element { focus = vi.fn(); }
    const previous = new Element();
    const input = { value: "", style: { cssText: "" }, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    vi.stubGlobal("document", { activeElement: previous, createElement: () => input, body: { appendChild: vi.fn() }, execCommand });
    expect(await copyInviteText("case_Safe")).toBe(true);
    expect(input.value).toBe("case_Safe");
    expect(input.select).toHaveBeenCalledOnce();
    expect(input.remove).toHaveBeenCalledOnce();
    expect(previous.focus).toHaveBeenCalledOnce();
  });
  it("reports unavailable copying so the UI offers manual text", async () => {
    const input = { value: "", style: { cssText: "" }, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("document", { activeElement: null, createElement: () => input, body: { appendChild: vi.fn() }, execCommand: () => false });
    expect(await copyInviteText("room-link")).toBe(false);
    expect(input.remove).toHaveBeenCalledOnce();
  });
});

describe("invitation recovery precedence", () => {
  it("recovers only the same room with stored seat credentials", () => {
    expect(hasMatchingInviteResume("aB_12-xY9", {roomId:"aB_12-xY9",resumeToken:"test-only-resume"})).toBe(true);
    expect(hasMatchingInviteResume("aB_12-xY9", {roomId:"other1234",resumeToken:"test-only-resume"})).toBe(false);
    expect(hasMatchingInviteResume("aB_12-xY9", {roomId:"aB_12-xY9",resumeToken:""})).toBe(false);
    expect(hasMatchingInviteResume("aB_12-xY9", null)).toBe(false);
    expect(battleInvitePath("aB_12-xY9")).not.toContain("resume");
  });
});
