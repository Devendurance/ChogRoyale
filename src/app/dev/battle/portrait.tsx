"use client";

// Card portrait image with a text-tile fallback when the imported art is
// missing or fails to decode. Plain <img> so arbitrary kit URLs work.
import { useState } from "react";

export function Portrait({
  src,
  name,
  style,
  className,
}: {
  src: string | null;
  name: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className={className} style={{ display: "grid", placeItems: "center", background: "#253041", color: "#cbd5e1", fontSize: 10, textAlign: "center", padding: 2, ...style }}>
        {name}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={name} onError={() => setErr(true)} draggable={false} className={className} style={{ objectFit: "cover", display: "block", ...style }} />;
}
