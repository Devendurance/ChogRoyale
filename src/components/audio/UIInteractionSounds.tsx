"use client";

import { useEffect } from "react";
import type { AppAudioController, UiCue } from "@/lib/audio/audio-core";
import { UI_SOUND_CUES } from "./ui-interactions";

/**
 * The controls that participate in the app-wide fallback sound boundary.
 * React handlers that have a more meaningful cue mark their control with
 * data-audio-skip, so this listener only fills in ordinary interaction gaps.
 */
const SEMANTIC_CONTROL_SELECTOR = [
  "a[href]",
  "button",
  "summary",
  "[role=button]",
  "[role=tab]",
  "[role=menuitem]",
  "[data-audio-cue]",
  "[data-audio-modal=true]",
  "[data-audio-navigation=true]",
  "[data-audio-card-select=true]",
  "[data-card-select=true]",
  "[data-audio-drag=true]",
  "[draggable=true]",
].join(",");

const TEXT_ENTRY_SELECTOR = "input, textarea, select, option, [contenteditable=true]";

/** A small runtime guard keeps data attributes from widening the cue union. */
export function isUiCue(value: string | null): value is UiCue {
  return value !== null && (UI_SOUND_CUES as readonly string[]).includes(value);
}

/** Returns the nearest semantic control, never an outer control as a fallback. */
export function nearestSemanticControl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(SEMANTIC_CONTROL_SELECTOR);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_ENTRY_SELECTOR) !== null;
}

export function isDisabledSemanticControl(control: HTMLElement): boolean {
  if (control.getAttribute("aria-disabled") === "true") return true;
  if (control.closest("fieldset[disabled]") !== null) return true;
  return "disabled" in control && (control as HTMLButtonElement).disabled === true;
}

function isSkippedSemanticControl(control: HTMLElement): boolean {
  return control.closest("[data-audio-skip=true]") !== null;
}

type DelegatedClickLike = Pick<MouseEvent, "target" | "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

function isFrameworkNavigationAnchor(control: HTMLElement, event: DelegatedClickLike): boolean {
  if (!control.matches("a[href]")) return false;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (control.hasAttribute("download")) return false;
  const target = control.getAttribute("target");
  if (target && target.toLowerCase() !== "_self") return false;
  const href = control.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return false;
  if (typeof window === "undefined") return href.startsWith("/");
  try {
    return new URL(href, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Exposed for the regression test around Next Link's prevented click. */
export function shouldPlayDelegatedClick(event: DelegatedClickLike): boolean {
  const cue = cueForClickTarget(event.target);
  if (!cue) return false;
  if (!event.defaultPrevented) return true;
  if (cue !== "navigation") return false;
  const control = nearestSemanticControl(event.target);
  return control !== null && isFrameworkNavigationAnchor(control, event);
}

function hasCardSelectionSemantics(control: HTMLElement): boolean {
  return control.matches(
    ".app-slot, .app-tile, .lp-choice, .lp-nft, .app-cmdr, [data-card-select=true], [data-audio-card-select=true]",
  );
}

/** Maps ordinary controls to a restrained fallback cue. */
export function cueForSemanticControl(control: HTMLElement): UiCue | null {
  const explicitCue = control.getAttribute("data-audio-cue");
  if (isUiCue(explicitCue)) return explicitCue;
  if (control.matches("[data-audio-drag=true], [draggable=true]")) return "card-drag";
  if (control.getAttribute("data-audio-navigation") === "true") return "navigation";
  if (control.getAttribute("data-audio-modal") === "true") return "secondary";
  if (hasCardSelectionSemantics(control)) return "card-select";
  if (control.matches("a[href], summary, [role=tab], [role=menuitem]")) return "navigation";
  if (control.getAttribute("aria-haspopup") === "dialog" || control.getAttribute("aria-haspopup") === "menu") {
    return "secondary";
  }
  if (control.matches("button, [role=button]")) return "primary";
  return null;
}

/**
 * Pure event-to-cue boundary used by the delegated listener and DOM tests.
 * The target is checked before the nearest control so typing never leaks a
 * sound through a button or label that happens to contain an input.
 */
export function cueForClickTarget(target: EventTarget | null): UiCue | null {
  if (isTextEntryTarget(target)) return null;
  const control = nearestSemanticControl(target);
  if (!control || isDisabledSemanticControl(control) || isSkippedSemanticControl(control)) return null;
  return cueForSemanticControl(control);
}

export function cueForDragTarget(target: EventTarget | null): UiCue | null {
  if (isTextEntryTarget(target)) return null;
  const control = nearestSemanticControl(target);
  if (!control || isDisabledSemanticControl(control) || isSkippedSemanticControl(control)) return null;
  if (!control.matches("[data-audio-drag=true], [draggable=true]")) return null;
  return "card-drag";
}

/**
 * Start the unlock from the gesture's synchronous event turn. If resuming the
 * context is asynchronous, play the cue once the real context is running.
 * Neither path changes mute or volume preferences.
 */
export function unlockAndPlay(audio: Pick<AppAudioController, "unlock" | "playUi" | "getSnapshot">, cue: UiCue): void {
  const pending = audio.unlock();
  if (audio.getSnapshot().ready) {
    audio.playUi(cue);
    return;
  }
  void pending.then((ready) => {
    if (ready) audio.playUi(cue);
  }).catch(() => undefined);
}

function delegatedClick(event: MouseEvent, audio: AppAudioController): void {
  // React's root listener runs before this document bubble listener. A
  // semantic handler can therefore mark the control or prevent the event.
  // Next Link also prevents same-origin clicks before routing, so that case
  // remains eligible while canceled buttons and external links stay silent.
  if (!shouldPlayDelegatedClick(event)) return;
  const cue = cueForClickTarget(event.target);
  if (!cue) return;
  unlockAndPlay(audio, cue);
}

function delegatedDragStart(event: DragEvent, audio: AppAudioController): void {
  const cue = cueForDragTarget(event.target);
  if (!cue) return;
  unlockAndPlay(audio, cue);
}

/** Mount exactly once from AppAudioProvider. This component renders no UI. */
export default function UIInteractionSounds({ audio }: { audio: AppAudioController }): null {
  useEffect(() => {
    const onClick = (event: MouseEvent) => delegatedClick(event, audio);
    const onDragStart = (event: DragEvent) => delegatedDragStart(event, audio);
    document.addEventListener("click", onClick);
    document.addEventListener("dragstart", onDragStart);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("dragstart", onDragStart);
    };
  }, [audio]);

  return null;
}
