"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  getAppAudio,
  type AppAudioController,
  type AppAudioSnapshot,
  type AppAudioPreferences,
  type BattlePhase,
  type UiCue,
} from "@/lib/audio/audio-core";
import "./app-audio.css";
import UIInteractionSounds from "./UIInteractionSounds";

export interface AppAudioContextValue extends AppAudioSnapshot {
  setPreferences: (patch: Partial<AppAudioPreferences>) => void;
  unlock: () => Promise<boolean>;
  playUi: (cue: UiCue) => boolean;
  duck: (cues: boolean | number | readonly UiCue[]) => void;
  setPageHidden: (hidden: boolean) => void;
  setBattlePhase: (phase: BattlePhase) => void;
  setBattleRouteActive: (active: boolean) => void;
  audio: AppAudioController;
}

const AppAudioContext = createContext<AppAudioContextValue | null>(null);

/**
 * One provider belongs in the shared /app layout. The layout survives client
 * navigation, so this provider and its WebAudio context survive with it.
 */
export default function AppAudioProvider({ children }: { children: React.ReactNode }) {
  const audio = getAppAudio();
  const pathname = usePathname();
  const snapshot = useSyncExternalStore(audio.subscribe, audio.getSnapshot, audio.getServerSnapshot);

  useEffect(() => {
    const release = audio.mount();
    return release;
  }, [audio]);

  useEffect(() => {
    audio.setBattleRouteActive(isBattlePath(pathname));
    const syncVisibility = () => audio.setPageHidden(document.hidden || !isAppPath(pathname));
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    // This is intentionally one best-effort attempt. Browsers that reject
    // autoplay leave needsUnlock true, and the settings affordance can call
    // unlock from a real user gesture. A muted preference is never overridden.
    if (!document.hidden && isAppPath(pathname)) void audio.attemptAutoplay();
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, [audio, pathname]);

  const value = useMemo<AppAudioContextValue>(() => ({
    ...snapshot,
    setPreferences: (patch) => audio.setPreferences(patch),
    unlock: () => audio.unlock(),
    playUi: (cue) => audio.playUi(cue),
    duck: (cues) => audio.duck(cues),
    setPageHidden: (hidden) => audio.setPageHidden(hidden),
    setBattlePhase: (phase) => audio.setBattlePhase(phase),
    setBattleRouteActive: (active) => audio.setBattleRouteActive(active),
    audio,
  }), [audio, snapshot]);

  return (
    <AppAudioContext.Provider value={value}>
      <UIInteractionSounds audio={audio} />
      {children}
      {snapshot.needsUnlock && (
        <button
          type="button"
          className="app-audio-unlock"
          data-audio-skip="true"
          onClick={() => { void audio.unlock().then((ready) => { if (ready) audio.playUi("primary"); }); }}
        >
          Enable Sound
        </button>
      )}
    </AppAudioContext.Provider>
  );
}

function isAppPath(pathname: string | null): boolean {
  return pathname === "/app" || pathname?.startsWith("/app/") === true;
}

function isBattlePath(pathname: string | null): boolean {
  return pathname === "/app/play/battle" || pathname?.startsWith("/app/play/battle?") === true;
}

/** Optional consumers can render outside a provider, such as /dev routes. */
export function useAppAudio(): AppAudioContextValue | null {
  return useContext(AppAudioContext);
}

export { uiSound } from "@/lib/audio/audio-core";
