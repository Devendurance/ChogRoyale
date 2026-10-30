"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const OPENING_MS = 1480;

export default function AppOpening() {
  const pathname = usePathname();
  const initialPathnameRef = useRef(pathname);
  const leftInitialRouteRef = useRef(false);
  const attemptedRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (attemptedRef.current) return;

    const initialRoute = initialPathnameRef.current;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const attempt = window.setTimeout(() => {
      attemptedRef.current = true;
      if (initialRoute !== "/app" || leftInitialRouteRef.current || reducedMotion) return;
      setActive(true);
    }, 0);

    return () => window.clearTimeout(attempt);
  }, []);

  useEffect(() => {
    if (pathname !== initialPathnameRef.current) leftInitialRouteRef.current = true;
    if (!leftInitialRouteRef.current || !active) return;

    const close = window.setTimeout(() => setActive(false), 0);
    return () => window.clearTimeout(close);
  }, [active, pathname]);

  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(() => setActive(false), OPENING_MS);
    return () => window.clearTimeout(timeout);
  }, [active]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !active) return;

    const focused = document.activeElement;
    restoreFocusRef.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    dialog.showModal();
    skipRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [active]);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Opening Chog Royale"
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          skipRef.current?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        setActive(false);
      }}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        maxWidth: "none",
        maxHeight: "none",
        margin: 0,
        border: 0,
        padding: 0,
        background: "transparent",
        boxSizing: "border-box",
        color: "inherit",
      }}
    >
      <div className="app-opening" onClick={() => setActive(false)}>
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
    </dialog>
  );
}
