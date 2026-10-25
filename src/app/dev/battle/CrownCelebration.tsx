"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { BattleFrame, StartMessage } from "@/lib/battle-protocol";
import { GameIcon } from "@/components/game/GameIcon";
import type { BattleCue } from "./battle-audio";
import { crownCues, crownScreenPoint, unseenCrownCues } from "./crown-presentation";
import "./crown-celebration.css";

interface Props {
  frame: BattleFrame | null;
  start: StartMessage;
  me: number;
  boardRef: RefObject<HTMLElement | null>;
  mineRef: RefObject<HTMLElement | null>;
  theirsRef: RefObject<HTMLElement | null>;
  onAudioCue: (cue: BattleCue) => void;
}

/** All effects sit above the canvas and have no pointer or engine ownership. */
export default function CrownCelebration({ frame, start, me, boardRef, mineRef, theirsRef, onAudioCue }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLSpanElement>(null);
  const previous = useRef<BattleFrame | null>(null);
  const lastFrame = useRef<BattleFrame | null>(null);
  const staleFrame = useRef<BattleFrame | null>(null);
  const seen = useRef(new Set<string>());
  const cleanup = useRef(new Set<() => void>());
  const prime = useRef(true);
  const copyId = useRef(0);
  const primedStart = useRef<StartMessage | null>(null);

  useEffect(() => {
    // Effect setup runs twice in development StrictMode. Only a genuinely
    // new server start may discard an already observed initial baseline.
    if (primedStart.current !== start) {
      primedStart.current = start;
      previous.current = null;
      staleFrame.current = lastFrame.current;
      seen.current.clear();
      prime.current = true;
    }
    const clear = () => { for (const dispose of cleanup.current) dispose(); cleanup.current.clear(); };
    clear();
    const visibility = () => { prime.current = true; clear(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); clear(); };
  }, [start]);

  useEffect(() => {
    if (!frame) return;
    lastFrame.current = frame;
    // A resumed StartMessage may render once with the pre-disconnect frame.
    // Keep priming until an actual new server snapshot reaches this component.
    if (frame === staleFrame.current) return;
    const cues = unseenCrownCues(crownCues(frame, previous.current, prime.current || document.hidden), seen.current);
    previous.current = frame;
    prime.current = false;
    if (!host.current || !art.current) return;
    const canvas = boardRef.current?.querySelector("canvas") ?? boardRef.current?.querySelector('[data-testid="battle-board"]');
    const rect = canvas?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (cues.length) onAudioCue("crown-earned");
    cues.forEach((cue, index) => {
      const target = (cue.scorer === me ? mineRef : theirsRef).current;
      if (!target) return;
      const arrival = target.getBoundingClientRect();
      const origin = crownScreenPoint(cue.structure, rect, me);
      const dest = { x: arrival.left + arrival.width / 2, y: arrival.top + arrival.height / 2 };
      const sprite = document.createElement("div");
      sprite.className = "chud-crown-flight";
      sprite.dataset.team = cue.scorer === me ? "mine" : "theirs";
      sprite.style.left = `${origin.x}px`;
      sprite.style.top = `${origin.y}px`;
      const icon = art.current!.firstElementChild!.cloneNode(true) as SVGElement;
      const ids = new Map<string, string>();
      const suffix = `-flight-${copyId.current++}`;
      for (const definition of icon.querySelectorAll("[id]")) {
        const old = definition.id;
        ids.set(old, `${old}${suffix}`);
        definition.id = `${old}${suffix}`;
      }
      for (const element of icon.querySelectorAll("*")) {
        for (const attribute of ["fill", "stroke", "filter", "clip-path", "mask"]) {
          const value = element.getAttribute(attribute);
          if (!value) continue;
          for (const [old, replacement] of ids) {
            if (value === `url(#${old})`) element.setAttribute(attribute, `url(#${replacement})`);
          }
        }
      }
      sprite.appendChild(icon);
      const burst = document.createElement("i");
      burst.className = "chud-crown-burst";
      sprite.appendChild(burst);
      host.current!.appendChild(sprite);
      const spread = (index - (cues.length - 1) / 2) * 34;
      const animation = sprite.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
        { transform: "translate(-50%,-50%) scale(.12) rotate(-20deg)", opacity: 0, offset: 0 },
        { transform: `translate(calc(-50% + ${spread}px),calc(-50% - 35px)) scale(1.38) rotate(7deg)`, opacity: 1, offset: .2 },
        { transform: `translate(calc(-50% + ${spread}px),calc(-50% - 42px)) scale(1) rotate(-3deg)`, opacity: 1, offset: .42 },
        { transform: `translate(calc(-50% + ${(dest.x - origin.x) * .4}px),calc(-50% + ${(dest.y - origin.y) * .35 - 65}px)) scale(.9)`, opacity: 1, offset: .66 },
        { transform: `translate(calc(-50% + ${dest.x - origin.x}px),calc(-50% + ${dest.y - origin.y}px)) scale(.24)`, opacity: 0, offset: 1 },
      ], { duration: reduced ? 180 : 1250, delay: reduced ? 0 : index * 100, easing: "cubic-bezier(.2,.7,.3,1)", fill: "both" });
      let pulse: Animation | null = null;
      const dispose = () => { animation.onfinish = null; animation.cancel(); pulse?.cancel(); sprite.remove(); };
      cleanup.current.add(dispose);
      animation.onfinish = () => {
        sprite.remove();
        if (!reduced) {
          pulse = target.animate([{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.65)", filter: "brightness(1.8)" }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: 420, easing: "ease-out" });
          pulse.onfinish = () => cleanup.current.delete(dispose);
        } else cleanup.current.delete(dispose);
      };
    });
  }, [frame, me, boardRef, mineRef, theirsRef, onAudioCue]);

  return <div className="chud-crown-layer" ref={host} aria-hidden="true"><span className="chud-crown-template" ref={art}><GameIcon kind="crown" size={70} /></span></div>;
}
