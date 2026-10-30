import { beforeEach, describe, expect, it, vi } from "vitest";
import { mediaQueryMatches, subscribeMediaQuery } from "./use-media";

describe("media query compatibility helpers", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back safely when matchMedia is unavailable", () => {
    expect(mediaQueryMatches("(min-width: 1px)")).toBe(false);
    expect(subscribeMediaQuery("(min-width: 1px)", vi.fn())).toBeTypeOf("function");
  });

  it("supports modern and legacy media-listener APIs", () => {
    const modern = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("window", { matchMedia: () => modern });
    const modernStop = subscribeMediaQuery("(min-width: 1px)", vi.fn());
    expect(mediaQueryMatches("(min-width: 1px)")).toBe(true);
    expect(modern.addEventListener).toHaveBeenCalledOnce();
    modernStop();
    expect(modern.removeEventListener).toHaveBeenCalledOnce();

    const legacy = {
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    vi.stubGlobal("window", { matchMedia: () => legacy });
    const legacyStop = subscribeMediaQuery("(min-width: 1px)", vi.fn());
    expect(mediaQueryMatches("(min-width: 1px)")).toBe(false);
    expect(legacy.addListener).toHaveBeenCalledOnce();
    legacyStop();
    expect(legacy.removeListener).toHaveBeenCalledOnce();
  });
});
