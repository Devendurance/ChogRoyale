import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FriendsView from "./FriendsView";
import type { FriendsViewProps } from "./friends-types";

const noop = () => {};
const props: FriendsViewProps = {
  phase: "ready", player: null, lists: { friends: [], incoming: [], outgoing: [] },
  listsState: "ready", searchQuery: "", searchHits: null, searchState: "idle",
  actionId: null, busy: false, notices: [], calm: true, status: "", blocked: [], blockedState: "ready",
  onSignIn: noop, onSignOut: noop, onRefresh: noop, onSearchChange: noop, onSearch: noop,
  onSend: noop, onAccept: noop, onDecline: noop, onRemove: noop, onBlock: noop, onUnblock: noop,
};
const render = (overrides: Partial<FriendsViewProps>) => renderToStaticMarkup(createElement(FriendsView, { ...props, ...overrides }));

describe("friends presentation state", () => {
  it("keeps an initial search failure visible before any results exist", () => {
    const html = render({ searchState: "unavailable" });
    expect(html).toContain("Search is not available right now");
    expect(html).not.toContain("No players match");
  });
  it("does not present failed friendship reads as a zero count", () => {
    const html = render({ listsState: "unavailable" });
    expect(html).toContain("List unavailable");
    expect(html).not.toContain("0 friends");
    expect(html).not.toContain("No friends yet");
  });
  it("reserves empty messaging for a successful empty read", () => {
    const html = render({ searchState: "empty", searchHits: [] });
    expect(html).toContain("No players match that username yet");
    expect(html).toContain("No friends yet");
    expect(html).toContain("0 friends");
  });
});
