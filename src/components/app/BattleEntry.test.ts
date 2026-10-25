import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BattleEntry from "./BattleEntry";

function entry(mode: "private" | "unranked" | "ranked", code = "", error: string | null = null) {
  return renderToStaticMarkup(React.createElement(BattleEntry, { mode, code, error,
    onCodeChange: () => {}, onFind: () => {}, onCreate: () => {}, onJoin: () => {} }));
}

describe("battle entry mode boundaries", () => {
  it("offers private creation and a labelled code join without matchmaking", () => {
    const html = entry("private", "FRIEND12");
    expect(html).toContain("Create Private Room");
    expect(html).toContain('for="battle-room-code"');
    expect(html).toContain('id="battle-room-code"');
    expect(html).toContain('value="FRIEND12"');
    expect(html).toContain("Join with Code");
    expect(html).not.toContain("Find Opponent");
    expect(html).not.toContain('type="submit" class="app-btn app-btn--ghost" disabled');
  });

  it("disables an empty private join until a room code is supplied", () => {
    expect(entry("private")).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Join with Code/);
    expect(entry("private", "   ")).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Join with Code/);
  });

  it("offers only matchmaking for unranked entry", () => {
    const html = entry("unranked");
    expect(html).toContain("Find Opponent");
    expect(html).not.toContain("Create Private Room");
    expect(html).not.toContain("Join with Code");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
  });

  it("keeps ranked closed without exposing a queue or private-room action", () => {
    const html = entry("ranked");
    expect(html).toContain("Ranked queue is unavailable in this build.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });

  it("shows an idle server error as an alert while retaining the selected mode action", () => {
    const html = entry("private", "", "Room is unavailable. Try another code.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Room is unavailable. Try another code.");
    expect(html).toContain("Create Private Room");
  });
});
