// Both seats use the same engine pocket rule after an enemy lane tower falls.
import { describe, expect, it } from "vitest";
import { initMatch, troopDeployCheck } from "@/lib/combat";
import { scenarioConfig } from "@/lib/arena-scenarios";
import { practiceBotDeck } from "@/server/battle/practice";

const fresh = () => initMatch(scenarioConfig(practiceBotDeck(), practiceBotDeck(), null, "tutorial-pockets"));

describe("Training Camp tower pockets", () => {
  it("opens the left pocket for seat 0 after the enemy left tower falls", () => {
    const state = fresh();
    const tower = state.structures.find((entry) => entry.structure === "tower" && entry.owner === 1 && entry.x < 50)!;
    expect(troopDeployCheck(state.structures, 0, 30, 95, [])).toMatchObject({ ok: false });
    tower.alive = false;
    expect(troopDeployCheck(state.structures, 0, 30, 95, [])).toMatchObject({ ok: true, zone: "pocket-left" });
    expect(troopDeployCheck(state.structures, 0, 70, 95, [])).toMatchObject({ ok: false });
    expect(troopDeployCheck(state.structures, 0, 30, 60, [])).toMatchObject({ ok: true, zone: "own" });
  });

  it("opens the left pocket for seat 1 after the enemy left tower falls", () => {
    const state = fresh();
    const tower = state.structures.find((entry) => entry.structure === "tower" && entry.owner === 0 && entry.x < 50)!;
    expect(troopDeployCheck(state.structures, 1, 30, 65, [])).toMatchObject({ ok: false });
    tower.alive = false;
    expect(troopDeployCheck(state.structures, 1, 30, 65, [])).toMatchObject({ ok: true, zone: "pocket-left" });
    expect(troopDeployCheck(state.structures, 1, 70, 65, [])).toMatchObject({ ok: false });
    expect(troopDeployCheck(state.structures, 1, 30, 95, [])).toMatchObject({ ok: true, zone: "own" });
  });
});
