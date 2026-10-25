"use client";

// Card portrait image with a text-tile fallback when the imported art is
// missing or fails to decode. Plain <img> so arbitrary kit URLs work. A list
// of sources is tried in order, so new art can fall back to the v001 portrait.
import { useState } from "react";

export function Portrait({
  src,
  name,
  style,
  className,
}: {
  src: string | readonly string[] | null;
  name: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const url = (typeof src === "string" ? [src] : src ?? []).find((s) => !failed.includes(s)) ?? null;
  if (!url) {
    return (
      <div className={className} style={{ display: "grid", placeItems: "center", background: "#253041", color: "#cbd5e1", fontSize: 10, textAlign: "center", padding: 2, ...style }}>
        {name}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} onError={() => setFailed((f) => [...f, url])} draggable={false} className={className} style={{ objectFit: "cover", display: "block", ...style }} />;
}
