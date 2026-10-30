"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const OPENING_MS = 1480;

export default function AppOpening() {
  const pathname = usePathname();
  const skipRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (pathname !== "/app") {
      const close = window.setTimeout(() => setActive(false), 0);
      return () => window.clearTimeout(close);
    }

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const open = window.setTimeout(() => setActive(true), 0);
    const timeout = window.setTimeout(() => setActive(false), reducedMotion ? 0 : OPENING_MS);
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(timeout);
    };
  }, [pathname]);

  useEffect(() => {
    if (!active || pathname !== "/app") return;
    const focused = document.activeElement;
    restoreFocusRef.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    skipRef.current?.focus();
    return () => {
      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [active, pathname]);

  useEffect(() => {
    if (!active || pathname !== "/app") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setActive(false);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        skipRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, pathname]);

  if (!active || pathname !== "/app") return null;

  return (
    <div
      className="app-opening"
      role="dialog"
      aria-modal="true"
      aria-label="Opening Chog Royale"
      onClick={() => setActive(false)}
    >
      <div className="app-opening__brand" aria-hidden="true">
        <Image
          src="/assets/brand/v1/chog-royale-stacked.webp"
          alt=""
          fill
          priority
          sizes="(max-width: 639px) 72vw, 340px"
          className="app-opening__logo"
        />
      </div>
      <p className="app-sr" role="status">Entering Chog Royale</p>
      <button
        type="button"
        ref={skipRef}
        className="app-btn app-btn--ghost app-opening__skip"
        onClick={() => setActive(false)}
      >
        Skip intro
      </button>
    </div>
  );
}
