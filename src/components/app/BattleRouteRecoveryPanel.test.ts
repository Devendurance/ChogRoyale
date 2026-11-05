import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BattleRouteRecoveryPanel from "./BattleRouteRecoveryPanel";
import { battleRouteAccess } from "./player-battle-route-model";

const tutorial = { stage: 1, completedStages: 1, graduated: false, grandfathered: false, nextStage: 2, enforcement: true, access: "training-required" } as const;
const ready = { state: "ready", tutorial } as const;
const unavailable = { state: "unavailable", message: "down" } as const;
const locked = { state: "locked", message: "setup" } as const;

describe("battleRouteAccess", () => {
  it("holds the panel inert while the read is in flight", () => {
    expect(battleRouteAccess({ state: "loading" }, false, false)).toEqual({ mountPanel: true, setupReady: false, recovery: null });
  });

  it("opens new sessions only on a successful read that allows them", () => {
    expect(battleRouteAccess(ready, false, false)).toEqual({ mountPanel: true, setupReady: true, recovery: null });
    expect(battleRouteAccess(ready, false, true)).toEqual({ mountPanel: true, setupReady: true, recovery: null });
  });

  it.each([unavailable, locked])("never mounts a new panel on a failed read ($state)", (read) => {
    expect(battleRouteAccess(read, false, false)).toEqual({ mountPanel: false, setupReady: false, recovery: "retry" });
  });

  it("signs in on an expired session and never mounts, even with a saved seat", () => {
    for (const seat of [false, true]) {
      expect(battleRouteAccess({ state: "session" }, false, seat)).toEqual({ mountPanel: false, setupReady: false, recovery: "sign-in" });
    }
  });

  it("blocks a gated player without a seat", () => {
    expect(battleRouteAccess(ready, true, false)).toEqual({ mountPanel: false, setupReady: false, recovery: "training-required" });
  });

  it.each([
    [ready, true, "training-required"],
    [unavailable, false, "retry"],
    [locked, false, "retry"],
  ] as const)("keeps a saved seat reconnectable but resume-only (%#)", (read, trainingLocked, recovery) => {
    expect(battleRouteAccess(read, trainingLocked, true)).toEqual({ mountPanel: true, setupReady: true, recovery });
  });
});

describe("BattleRouteRecoveryPanel", () => {
  const render = (recovery: "retry" | "sign-in" | "training-required", invite = false) =>
    renderToStaticMarkup(createElement(BattleRouteRecoveryPanel, { recovery, invite, progress: "1/3", backHref: "/app/play", backLabel: "Back", onRetry: () => undefined, onSignIn: () => undefined }));

  it("offers a retry and keeps the invitation when the read fails", () => {
    const html = render("retry", true);
    expect(html).toContain("Try again");
    expect(html).toContain("Your invitation is still in this address");
  });

  it("offers sign-in for an expired session", () => {
    const html = render("sign-in");
    expect(html).toContain("Sign in");
    expect(html).toContain("no battle was opened");
  });

  it("names server progress for a gated player", () => {
    expect(render("training-required")).toContain("1/3");
  });
});
