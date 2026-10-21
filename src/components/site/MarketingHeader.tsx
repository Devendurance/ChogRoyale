"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export interface SiteNavLink {
  href: string;
  label: string;
}

interface Props {
  links: SiteNavLink[];
  play: SiteNavLink;
}

/** Transparent over the hero, white glass once the page scrolls. */
export default function MarketingHeader({ links, play }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => wide.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const state = open ? "open" : scrolled ? "scrolled" : "top";

  return (
    <>
      <div ref={sentinel} aria-hidden className="pointer-events-none absolute top-0 left-0 h-12 w-px" />
      <header data-site-header data-state={state} className="site-header fixed inset-x-0 top-0 z-50">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-6 px-5 md:px-10">
          <Link href="/" className="site-header__brand site-focus inline-flex h-11 items-center rounded-md font-game text-[22px] leading-none tracking-[0.01em]">
            Chog Royale
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="site-header__link site-focus rounded-md text-sm font-medium">
                {l.label}
              </a>
            ))}
            <Link href={play.href} className="site-header__play site-focus inline-flex h-11 items-center rounded-xl px-5 text-sm font-bold">
              {play.label}
            </Link>
          </nav>

          <button
            ref={toggle}
            type="button"
            className="site-header__toggle site-focus inline-flex size-11 items-center justify-center rounded-xl md:hidden"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <span aria-hidden className="site-burger" data-open={open} />
          </button>
        </div>

        <div id={panelId} hidden={!open} className="site-header__panel md:hidden">
          <nav aria-label="Primary mobile" className="mx-auto grid max-w-[1280px] gap-1 px-5 pt-2 pb-5">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="site-focus flex min-h-12 items-center rounded-xl px-3 text-base font-medium text-chog-ink hover:bg-chog-mist"
              >
                {l.label}
              </a>
            ))}
            <Link
              href={play.href}
              onClick={() => setOpen(false)}
              className="site-btn site-btn--primary site-focus mt-2 w-full"
            >
              {play.label}
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}
