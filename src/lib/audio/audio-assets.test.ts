import { describe, expect, it } from "vitest";
import {
  AUDIO_ASSET_VERSION,
  BATTLE_AUDIO_ASSETS,
  BATTLE_AUDIO_CUE_KEYS,
  BATTLE_MUSIC_ASSETS,
  UI_AUDIO_ASSETS,
  UI_AUDIO_CUE_KEYS,
  UI_SFX_ASSETS,
  MUSIC_ASSETS,
} from "./audio-assets";

describe("battle audio asset inventory", () => {
  it("keeps the core cue keys stable and covers every cue", () => {
    expect(AUDIO_ASSET_VERSION).toBe("v001");
    expect(Object.keys(BATTLE_AUDIO_ASSETS).sort()).toEqual([...BATTLE_AUDIO_CUE_KEYS].sort());
    expect(Object.values(BATTLE_AUDIO_ASSETS).every((asset) => asset.path === null)).toBe(true);
    expect(Object.keys(UI_AUDIO_ASSETS).sort()).toEqual([...UI_AUDIO_CUE_KEYS].sort());
    expect(Object.values(UI_AUDIO_ASSETS).filter((asset) => asset.path).length).toBe(16);
    expect(UI_SFX_ASSETS).toBe(UI_AUDIO_ASSETS);
    expect(MUSIC_ASSETS).toBe(BATTLE_MUSIC_ASSETS);
  });

  it("keeps the non-commercial development loop out of production", () => {
    expect(BATTLE_MUSIC_ASSETS["track-a"].path).toBe("/assets/audio/v001/music/spooky-halloween.mp3");
    expect(BATTLE_MUSIC_ASSETS["track-b"].path).toBeNull();
    expect(BATTLE_MUSIC_ASSETS["track-b"].developmentPath).toBe("/api/dev-audio/battle");
    expect(BATTLE_MUSIC_ASSETS["track-b"].production).toBe(false);
  });
});
