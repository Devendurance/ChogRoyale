import { afterEach, describe, expect, it } from "vitest";
import {
  getKingdomTourActive,
  setKingdomTourActive,
  subscribeKingdomTourActive,
} from "./kingdom-tour-active";

describe("kingdom tour active store", () => {
  afterEach(() => setKingdomTourActive(false));

  it("notifies subscribers only when the real value changes", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeKingdomTourActive(() => seen.push(getKingdomTourActive()));
    setKingdomTourActive(true);
    setKingdomTourActive(true);
    setKingdomTourActive(false);
    unsubscribe();
    setKingdomTourActive(true);
    expect(seen).toEqual([true, false]);
    expect(getKingdomTourActive()).toBe(true);
  });
});
