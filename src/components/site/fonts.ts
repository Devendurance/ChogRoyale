import { Georama, Lilita_One } from "next/font/google";
import localFont from "next/font/local";

// Satoshi is self-hosted from the unmodified official Fontshare variable
// WOFF2 under the ITF Free Font License (font-files/Satoshi-FFL.txt), which
// permits self-hosting for our own websites. Do not subset or convert it.
export const satoshi = localFont({
  src: "./font-files/Satoshi-Variable.woff2",
  weight: "300 900",
  style: "normal",
  variable: "--font-satoshi",
  display: "swap",
});

// Georama (labels/data) and Lilita One (game display) are self-hosted by next/font.
export const georama = Georama({ subsets: ["latin"], variable: "--font-georama", display: "swap" });
export const lilitaOne = Lilita_One({ subsets: ["latin"], weight: "400", variable: "--font-lilita", display: "swap" });
