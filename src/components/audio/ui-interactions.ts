"use client";

import { uiSound as playUiSound, type UiCue } from "@/lib/audio/audio-core";

/**
 * Semantic UI sound boundary.
 *
 * Screens call this helper only for an intentional action or a confirmed
 * server result. The audio core owns the mixer and this import is safe from
 * SSR event handlers. Keeping the event boundary here lets unauthenticated
 * screens use the same cues without mounting a second audio engine.
 */
export const UI_SOUND_CUES = [
  "primary",
  "secondary",
  "navigation",
  "card-select",
  "card-drag",
  "placement",
  "success",
  "error",
  "friend-request",
  "notification",
  "invite",
  "ready",
  "upgrade",
  "reward",
  "confirm",
  "reveal",
] as const;

export type UiSoundCue = UiCue;

/** The only screen-level sound entry point. The core owns the mixer. */
export const uiSound = playUiSound;
