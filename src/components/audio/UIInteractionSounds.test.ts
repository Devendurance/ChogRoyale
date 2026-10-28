import { describe, expect, it, vi } from "vitest";
import {
  cueForClickTarget,
  cueForDragTarget,
  cueForSemanticControl,
  nearestSemanticControl,
  shouldPlayDelegatedClick,
  unlockAndPlay,
} from "./UIInteractionSounds";

class FakeElement extends EventTarget {
  readonly parentElement: FakeElement | null;
  readonly tagName: string;
  readonly attrs: Record<string, string>;
  readonly disabled: boolean;

  constructor(tagName: string, attrs: Record<string, string> = {}, parentElement: FakeElement | null = null) {
    super();
    this.tagName = tagName.toLowerCase();
    this.attrs = attrs;
    this.parentElement = parentElement;
    this.disabled = attrs.disabled === "true";
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs[name] !== undefined;
  }

  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const token = part.trim();
      if (token === "button" || token === "a[href]" || token === "summary") return this.tagName === token.split("[")[0];
      if (token === "input" || token === "textarea" || token === "select" || token === "option") return this.tagName === token;
      if (token === "[role=button]") return this.attrs.role === "button";
      if (token === "[role=tab]") return this.attrs.role === "tab";
      if (token === "[role=menuitem]") return this.attrs.role === "menuitem";
      if (token === "[contenteditable=true]") return this.attrs.contenteditable === "true";
      if (token === "[data-audio-cue]") return this.attrs["data-audio-cue"] !== undefined;
      if (token === "[data-audio-modal=true]") return this.attrs["data-audio-modal"] === "true";
      if (token === "[data-audio-navigation=true]") return this.attrs["data-audio-navigation"] === "true";
      if (token === "[data-audio-card-select=true]") return this.attrs["data-audio-card-select"] === "true";
      if (token === "[data-card-select=true]") return this.attrs["data-card-select"] === "true";
      if (token === "[data-audio-drag=true]") return this.attrs["data-audio-drag"] === "true";
      if (token === "[draggable=true]") return this.attrs.draggable === "true";
      if (token === "[data-audio-skip=true]") return this.attrs["data-audio-skip"] === "true";
      if (token === "[data-card-select=true]") return this.attrs["data-card-select"] === "true";
      if (token === "fieldset[disabled]") return this.tagName === "fieldset" && this.attrs.disabled === "true";
      return false;
    });
  }

  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
}

// The test suite has no DOM runtime dependency. The production boundary only
// needs the small Element surface above for its delegated classification.
globalThis.Element = FakeElement as unknown as typeof Element;

function element(tagName: string, attrs: Record<string, string> = {}, parent: FakeElement | null = null): FakeElement {
  return new FakeElement(tagName, attrs, parent);
}

describe("delegated UI interaction sounds", () => {
  it("uses the nearest semantic control for nested clicks", () => {
    const button = element("button");
    const label = element("span", {}, button);

    expect(nearestSemanticControl(label)).toBe(button);
    expect(cueForClickTarget(label)).toBe("primary");
  });

  it("does not cue disabled or aria-disabled controls", () => {
    const nativeButton = element("button", { disabled: "true" });
    const native = element("span", {}, nativeButton);
    const ariaButton = element("button", { "aria-disabled": "true" });
    const aria = element("span", {}, ariaButton);

    expect(cueForClickTarget(native)).toBeNull();
    expect(cueForClickTarget(aria)).toBeNull();
  });

  it("honors semantic skip markers so React cues do not double", () => {
    const button = element("button", { "data-audio-skip": "true" });
    expect(cueForClickTarget(element("span", {}, button))).toBeNull();
  });

  it("maps app links, disclosures, and tabs to navigation", () => {
    const link = element("a", { href: "/app/messages" });
    const summary = element("summary");
    const tab = element("div", { role: "tab" });
    const modal = element("button", { "data-audio-modal": "true" });

    expect(cueForClickTarget(element("span", {}, link))).toBe("navigation");
    expect(cueForClickTarget(element("span", {}, summary))).toBe("navigation");
    expect(cueForClickTarget(element("span", {}, tab))).toBe("navigation");
    expect(cueForClickTarget(element("span", {}, modal))).toBe("secondary");
  });

  it("keeps a prevented same-origin link audible while canceled buttons stay silent", () => {
    const link = element("a", { href: "/app/messages" });
    const linkTarget = element("span", {}, link);
    const preventedLink = {
      target: linkTarget,
      defaultPrevented: true,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    };
    const preventedButton = {
      ...preventedLink,
      target: element("span", {}, element("button")),
    };

    expect(shouldPlayDelegatedClick(preventedLink)).toBe(true);
    expect(shouldPlayDelegatedClick(preventedButton)).toBe(false);
  });

  it("ignores typing controls and recognizes a real drag target", () => {
    const field = element("input");
    const card = element("div", { draggable: "true" });

    expect(cueForClickTarget(field)).toBeNull();
    expect(cueForDragTarget(element("span", {}, card))).toBe("card-drag");
    expect(cueForSemanticControl(card as unknown as HTMLElement)).toBe("card-drag");
  });

  it("starts unlock synchronously and preserves the controller's preference policy", async () => {
    const unlock = vi.fn(() => Promise.resolve(true));
    const playUi = vi.fn(() => true);
    const getSnapshot = vi.fn(() => ({
      preferences: {
        masterVolume: 1,
        musicVolume: 0.52,
        uiVolume: 0.72,
        battleVolume: 0.62,
        masterMuted: false,
        musicMuted: true,
        uiMuted: false,
        battleMuted: false,
      },
      ready: false,
      needsUnlock: true,
      pageHidden: false,
      battlePhase: "idle" as const,
    }));

    unlockAndPlay({ unlock, playUi, getSnapshot }, "navigation");

    expect(unlock).toHaveBeenCalledTimes(1);
    expect(playUi).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(playUi).toHaveBeenCalledWith("navigation");
    expect(getSnapshot().preferences.musicMuted).toBe(true);
  });
});
