"use client";

import { useEffect } from "react";

type NavigatorWithConnection = Navigator & { connection?: { saveData?: boolean } };

/**
 * Document-level hooks for the public site, applied only while the site is
 * mounted. Cache Components keeps hidden routes in the DOM, so html-level
 * rules must follow effect lifetime rather than a :has() selector.
 */
export default function SiteDocumentFlags({ target }: { target: string }) {
  useEffect(() => {
    const html = document.documentElement;
    const el = document.getElementById(target);
    html.classList.add("site-doc");
    // Tells Next.js 16 to drop smooth scrolling during route transitions, so
    // leaving the site (e.g. Play) jumps to the top instead of animating.
    html.dataset.scrollBehavior = "smooth";
    if ((navigator as NavigatorWithConnection).connection?.saveData) el?.setAttribute("data-save-data", "");
    return () => {
      html.classList.remove("site-doc");
      delete html.dataset.scrollBehavior;
      el?.removeAttribute("data-save-data");
    };
  }, [target]);
  return null;
}
