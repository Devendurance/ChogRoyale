import { describe, expect, it } from "vitest";
import { audioSettingsStatus } from "./AudioSettings";

const preferences = {
  masterVolume: 1,
  musicVolume: 0.52,
  uiVolume: 0.72,
  battleVolume: 0.62,
  masterMuted: false,
  musicMuted: false,
  uiMuted: false,
  battleMuted: false,
};

describe("audio settings status", () => {
  it("reports deliberate master zero volume as sound off", () => {
    expect(audioSettingsStatus({ preferences: { ...preferences, masterVolume: 0 }, ready: false, needsUnlock: false })).toBe("Sound off");
  });

  it("reports deliberate all-channel silence as sound off", () => {
    expect(audioSettingsStatus({
      preferences: { ...preferences, musicMuted: true, uiVolume: 0, battleMuted: true },
      ready: false,
      needsUnlock: false,
    })).toBe("Sound off");
  });

  it("keeps unavailable and unlock states distinct from deliberate silence", () => {
    expect(audioSettingsStatus({ preferences, ready: false, needsUnlock: false })).toBe("Sound unavailable");
    expect(audioSettingsStatus({ preferences, ready: false, needsUnlock: true })).toBe("Enable sound");
    expect(audioSettingsStatus({ preferences, ready: true, needsUnlock: false })).toBe("Sound on");
  });
});
