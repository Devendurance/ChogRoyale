"use client";

import { useAppAudio, type AppAudioContextValue } from "./AppAudioProvider";
import "./audio-settings.css";

type AudioChannel = "master" | "music" | "ui" | "battle";

const CHANNELS: ReadonlyArray<{
  id: AudioChannel;
  label: string;
  description: string;
  volumeKey: "masterVolume" | "musicVolume" | "uiVolume" | "battleVolume";
  mutedKey: "masterMuted" | "musicMuted" | "uiMuted" | "battleMuted";
}> = [
  { id: "master", label: "Master", description: "All game audio", volumeKey: "masterVolume", mutedKey: "masterMuted" },
  { id: "music", label: "Background music", description: "Menus and battle music", volumeKey: "musicVolume", mutedKey: "musicMuted" },
  { id: "ui", label: "Interface effects", description: "Buttons, alerts and rewards", volumeKey: "uiVolume", mutedKey: "uiMuted" },
  { id: "battle", label: "Battle effects", description: "Battlefield effects", volumeKey: "battleVolume", mutedKey: "battleMuted" },
];

function channelValue(audio: AppAudioContextValue, channel: (typeof CHANNELS)[number]): number {
  return audio.preferences[channel.volumeKey];
}

export function audioSettingsStatus({ preferences, ready, needsUnlock }: Pick<AppAudioContextValue, "preferences" | "ready" | "needsUnlock">): "Sound off" | "Enable sound" | "Sound unavailable" | "Sound on" {
  const allChannelsSilent = (preferences.musicMuted || preferences.musicVolume === 0)
    && (preferences.uiMuted || preferences.uiVolume === 0)
    && (preferences.battleMuted || preferences.battleVolume === 0);
  if (preferences.masterMuted || preferences.masterVolume === 0 || allChannelsSilent) return "Sound off";
  if (ready) return "Sound on";
  return needsUnlock ? "Enable sound" : "Sound unavailable";
}

export default function AudioSettings() {
  const context = useAppAudio();
  if (!context) return null;
  const { preferences } = context;
  const masterMuted = preferences.masterMuted;
  const status = audioSettingsStatus(context);
  const soundOff = status === "Sound off";
  return (
    <section className="audio-settings" aria-labelledby="audio-settings-title">
      <div className="audio-settings__heading">
        <div>
          <p className="audio-settings__eyebrow">Sound</p>
          <h2 className="audio-settings__title" id="audio-settings-title">Audio settings</h2>
          <p className="audio-settings__lead">Tune the mix for menus and battles. Your choices stay on this device.</p>
        </div>
        <button
          type="button"
          className={`audio-settings__toggle${masterMuted ? " audio-settings__toggle--muted" : ""}`}
          aria-pressed={masterMuted}
          onClick={() => {
            if (masterMuted) {
              context.setPreferences({ masterMuted: false });
              void context.unlock({ fromGesture: true });
              return;
            }
            // A zero-volume or all-channel-muted mix is an intentional silent
            // choice. The top affordance must not silently rewrite it.
            if (soundOff) return;
            if (!context.ready) {
              void context.unlock({ fromGesture: true });
              return;
            }
            context.setPreferences({ masterMuted: !masterMuted });
          }}
        >
          {status}
        </button>
      </div>
      <div className="audio-settings__controls">
        {CHANNELS.map((channel) => {
          const value = Math.max(0, Math.min(1, channelValue(context, channel)));
          const muted = context.preferences[channel.mutedKey];
          return (
            <div className="audio-settings__row" key={channel.id}>
              <span className="audio-settings__label">
                <span>{channel.label}</span>
                <span className="audio-settings__controls-inline">
                  <span className="audio-settings__value">{Math.round(value * 100)}%</span>
                  <button
                    type="button"
                    className={`audio-settings__channel-toggle${muted ? " audio-settings__channel-toggle--muted" : ""}`}
                    aria-pressed={muted}
                    aria-label={`${muted ? "Unmute" : "Mute"} ${channel.label}`}
                    onClick={() => {
                      context.setPreferences({ [channel.mutedKey]: !muted });
                      if (muted) void context.unlock({ fromGesture: true });
                    }}
                  >
                    {muted ? "Muted" : "On"}
                  </button>
                </span>
              </span>
              <span className="audio-settings__description">{channel.description}</span>
              <input
                className="audio-settings__range"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={value}
                aria-label={`${channel.label} volume`}
                onChange={(event) => context.setPreferences({ [channel.volumeKey]: Number(event.target.value) })}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
