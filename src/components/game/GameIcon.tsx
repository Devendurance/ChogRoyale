"use client";

import { useId } from "react";
import Image from "next/image";
import "./game-icon.css";

export type GameIconKind = "crown" | "trophy" | "victory" | "defeat" | "ready" | "deck";

/** Official crown artwork, with original hardware for the other game symbols. */
export function GameIcon({ kind, size = 24, className = "", label }: { kind: GameIconKind; size?: number; className?: string; label?: string }) {
  const id = useId();
  const gold = `${id}-gold`;
  const jewel = `${id}-jewel`;
  const glint = `${id}-glint`;
  const crown = kind === "crown" || kind === "victory" || kind === "defeat";
  if (crown) return <Image src="/assets/brand/v1/chog-royale-crown.webp" width={size} height={Math.round(size * 236 / 256)} unoptimized className={`game-icon game-icon--brand game-icon--${kind} ${className}`} alt={label ?? ""} aria-hidden={label ? undefined : true} draggable={false} />;
  return (
    <svg className={`game-icon game-icon--${kind} ${className}`} width={size} height={size} viewBox="0 0 64 64" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="#fff3a3" /><stop offset=".42" stopColor="#ffc740" /><stop offset="1" stopColor="#ce7417" /></linearGradient>
        <linearGradient id={jewel} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#edbdff" /><stop offset=".44" stopColor="#a060ed" /><stop offset="1" stopColor="#45227d" /></linearGradient>
        <clipPath id={glint}><path d="M17 9h30v17c0 12-6 18-15 18s-15-6-15-18ZM28 43h8v9h10v7H18v-7h10Z" /></clipPath>
      </defs>
      <g stroke="#211039" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round">
        {kind === "trophy" && <>
          <path d="M18 15H7v12c0 10 9 13 17 11m22-23h11v12c0 10-9 13-17 11" fill="none" stroke="#e8a230" strokeWidth="6" />
          <path d="M17 9h30v17c0 12-6 18-15 18s-15-6-15-18Z" fill={`url(#${gold})`} />
          <path d="M22 14h18M22 19v9" stroke="#fff1a9" strokeWidth="3" />
          <path d="M28 43h8v9h10v7H18v-7h10Z" fill={`url(#${gold})`} />
          <path d="m32 19 7 9-7 9-7-9Z" fill={`url(#${jewel})`} strokeWidth="2.5" />
        </>}
        {kind === "ready" && <>
          <path d="m32 5 23 9v18c0 12-13 22-23 27C22 54 9 44 9 32V14Z" fill={`url(#${gold})`} />
          <path d="m32 12 16 6v14c0 8-9 17-16 21-7-4-16-13-16-21V18Z" fill={`url(#${jewel})`} strokeWidth="2.5" />
          <path d="m22 31 7 8 14-17" fill="none" stroke="#fff5b0" strokeWidth="5" />
        </>}
        {kind === "deck" && <>
          <rect x="6" y="14" width="34" height="44" rx="5" fill="#7950b6" transform="rotate(-9 23 36)" />
          <rect x="19" y="6" width="36" height="46" rx="5" fill={`url(#${gold})`} />
          <path d="M25 12h24v33H25Z" fill={`url(#${jewel})`} strokeWidth="2.5" />
          <path d="m37 19 8 10-8 10-8-10Z" fill="#f5cc6f" strokeWidth="2" />
        </>}
      </g>
      {kind === "trophy" && <g clipPath={`url(#${glint})`} aria-hidden="true"><path className="game-icon-glint" d="M-18 0H-9L13 64H4Z" fill="#fff9d9" /></g>}
    </svg>
  );
}
