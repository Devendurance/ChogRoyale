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
    // The chime marks the moment a crown reaches its counter. Reduced motion
    // has no flight, so it sounds with the confirmed score change instead.
    let chimed = false;
    const chime = () => { if (!chimed) { chimed = true; onAudioCue("crown-earned"); } };
    if (cues.length && reduced) chime();
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
      // Per-segment easing on a linear timeline: pop up from the rubble, hang
      // for a beat, then accelerate along an arc and land solid on the counter.
      const dx = dest.x - origin.x;
      const dy = dest.y - origin.y;
      const animation = sprite.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
        { transform: "translate(-50%,-50%) scale(.15) rotate(-20deg)", opacity: 0, offset: 0, easing: "cubic-bezier(.2,1.5,.4,1)" },
        { transform: `translate(calc(-50% + ${spread}px),calc(-50% - 46px)) scale(1.35) rotate(6deg)`, opacity: 1, offset: .2, easing: "ease-in-out" },
        { transform: `translate(calc(-50% + ${spread}px),calc(-50% - 54px)) scale(1.08) rotate(-3deg)`, opacity: 1, offset: .42, easing: "cubic-bezier(.5,0,.9,.6)" },
        { transform: `translate(calc(-50% + ${spread + (dx - spread) * .45}px),calc(-50% + ${dy * .4 - 80}px)) scale(.9) rotate(0deg)`, opacity: 1, offset: .74, easing: "cubic-bezier(.2,.6,.4,1)" },
        { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.5)`, opacity: 1, offset: 1 },
      ], { duration: reduced ? 180 : 1300, delay: reduced ? 0 : index * 170, easing: "linear", fill: "both" });
      let pulse: Animation | null = null;
      let plus: HTMLElement | null = null;
      const dispose = () => { animation.onfinish = null; animation.cancel(); pulse?.cancel(); sprite.remove(); plus?.remove(); };
      cleanup.current.add(dispose);
      animation.onfinish = () => {
        sprite.remove();
        if (reduced) { cleanup.current.delete(dispose); return; }
        chime();
        pulse = target.animate([
          { transform: "scale(1)", filter: "brightness(1)" },
          { transform: "scale(1.45) rotate(-4deg)", filter: "brightness(1.7)", offset: .3 },
          { transform: "scale(.94)", filter: "brightness(1.15)", offset: .65 },
          { transform: "scale(1)", filter: "brightness(1)" },
        ], { duration: 480, easing: "ease-out" });
        plus = document.createElement("b");
        plus.className = "chud-crown-plus";
        plus.dataset.team = sprite.dataset.team;
        plus.textContent = "+1";
        plus.style.left = `${dest.x}px`;
        plus.style.top = `${arrival.bottom + 4}px`;
        host.current?.appendChild(plus);
        const rise = plus.animate([
          { transform: "translate(-50%, 6px) scale(.6)", opacity: 0 },
          { transform: "translate(-50%, 0) scale(1.15)", opacity: 1, offset: .25 },
          { transform: "translate(-50%, -14px) scale(1)", opacity: 0 },
        ], { duration: 900, easing: "ease-out" });
        let settled = 0;
        const done = () => { if (++settled === 2) { plus?.remove(); cleanup.current.delete(dispose); } };
        pulse.onfinish = done;
        rise.onfinish = done;
      };
    });
  }, [frame, me, boardRef, mineRef, theirsRef, onAudioCue]);

  return <div className="chud-crown-layer" ref={host} aria-hidden="true"><span className="chud-crown-template" ref={art}><GameIcon kind="crown" size={70} /></span></div>;
}
