"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHydrated, useMedia, useSaveData } from "./use-media";
import "./opening.css";

const REAVER = {
  src: "/assets/site/mascots/reaver-commander-class.png",
  width: 547,
  height: 634,
};

/** Length of the whole sequence, in ms. The CSS uses the same number through
 *  the --opening-cycle custom property, so the fade and the teardown agree. */
const CYCLE = 2520;
const REDUCED_CYCLE = 1200;
const SAVE_CYCLE = 1900;

type Phase = "playing" | "leaving" | "done";

/**
 * L8. The seasonal opening. A short violet atmosphere, the Reaver arriving
 * and the Chog Royale wordmark, then a dissolve into the pagoda hero that is
 * already rendered underneath.
 *
 * It plays on every genuine visit to the landing page: a fresh tab, a
 * reload, and a return from another route. Nothing is stored, so there is
 * no flag that could suppress it. It never restarts for an ordinary
 * re-render, for scrolling or for an in-page anchor, because the only thing
 * it watches is the pathname.
 */
export default function SeasonOpening() {
  const pathname = usePathname();
  const reduceMotion = useMedia("(prefers-reduced-motion: reduce)");
  const saveData = useSaveData();

  const [phase, setPhase] = useState<Phase>("playing");
  const [playId, setPlayId] = useState(0);
  const lastPath = useRef<string | null>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const cycle = reduceMotion ? REDUCED_CYCLE : saveData ? SAVE_CYCLE : CYCLE;

  // The overlay is server rendered, so it paints before React hydrates. The
  // skip control only appears once its handler can actually run, so it is
  // never a visible button that does nothing.
  const ready = useHydrated();

  // A genuine visit to the landing page. The first mount needs nothing: the
  // server already rendered the overlay and its animation is running. Coming
  // back from another route is the only case that has to start it again.
  useEffect(() => {
    const prev = lastPath.current;
    lastPath.current = pathname;
    if (pathname !== "/") return;
    if (prev === null || prev === "/") return;
    setPlayId((n) => n + 1);
    setPhase("playing");
  }, [pathname]);

  // Take focus, and remember where to give it back.
  useEffect(() => {
    if (phase !== "playing" || !ready) return;
    const active = document.activeElement;
    restoreTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
    skipRef.current?.focus();
  }, [phase, ready]);

  // No scrolling behind the intro, and no scrollbar jump when it locks.
  useEffect(() => {
    if (phase !== "playing") return;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    const padding = root.style.paddingRight;
    const gap = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (gap > 0) root.style.paddingRight = `${gap}px`;
    return () => {
      root.style.overflow = overflow;
      root.style.paddingRight = padding;
    };
  }, [phase]);

  // Backstop in case the animation never reports its end.
  useEffect(() => {
    if (phase === "done") return;
    const t = window.setTimeout(() => setPhase("done"), cycle + 1500);
    return () => window.clearTimeout(t);
  }, [phase, cycle]);

  // Give the focus back to wherever it came from. With no previous target the
  // tab order has to be reset to the top of the document, otherwise it starts
  // where the overlay used to sit and the skip link is skipped.
  useEffect(() => {
    if (phase !== "done") return;
    const el = restoreTo.current;
    restoreTo.current = null;
    if (el && document.contains(el)) {
      el.focus();
      return;
    }
    const body = document.body;
    body.setAttribute("tabindex", "-1");
    body.focus();
    body.removeAttribute("tabindex");
  }, [phase]);

  const skip = useCallback(() => {
    setPhase((p) => (p === "playing" ? "leaving" : p));
  }, []);

  // Escape dismisses. Tab stays inside the overlay, which holds one control.
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
        return;
      }
      if (e.key === "Tab" && ready) {
        e.preventDefault();
        skipRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, ready, skip]);

  if (phase === "done") return null;

  return (
    <div
      key={playId}
      className="site-opening"
      data-state={phase}
      data-reduced={reduceMotion ? "true" : undefined}
      data-save-data={saveData ? "true" : undefined}
      style={{ "--opening-cycle": `${cycle}ms` } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Chog Royale"
      /* The overlay is a real modal: it takes the pointer, so the background
         is inert for the mouse as well as for assistive tech. A click that
         lands on it dismisses the intro, so nothing feels dead. */
      onClick={skip}
      onAnimationEnd={(e) => {
        // Only the overlay's own cycle counts. The children animate too.
        if (e.animationName === "site-opening-cycle" || e.animationName === "site-opening-leave") {
          setPhase("done");
        }
      }}
    >
      <div aria-hidden className="site-opening__haze site-opening__haze--a" />
      <div aria-hidden className="site-opening__haze site-opening__haze--b" />
      <div aria-hidden className="site-opening__aura" />
      <div aria-hidden className="site-opening__ground" />

      <div aria-hidden className="site-opening__reaver">
        <Image
          src={REAVER.src}
          alt=""
          width={REAVER.width}
          height={REAVER.height}
          sizes="(min-width: 768px) 420px, 260px"
          priority
          className="site-opening__reaver-img"
        />
      </div>

      <p aria-hidden className="site-opening__mark font-game">
        Chog Royale
        <span className="site-opening__rule" />
      </p>

      {ready && (
        <button type="button" ref={skipRef} className="site-opening__skip site-focus" onClick={skip}>
          Skip
        </button>
      )}
    </div>
  );
}
