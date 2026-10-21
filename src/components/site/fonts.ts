import { Georama, Lilita_One } from "next/font/google";

// Georama (labels/data) and Lilita One (game display) are self-hosted by
// next/font. Satoshi is not on Google Fonts, so the site links its
// legitimate Fontshare stylesheet (see SiteFontLinks).
export const georama = Georama({ subsets: ["latin"], variable: "--font-georama", display: "swap" });
export const lilitaOne = Lilita_One({ subsets: ["latin"], weight: "400", variable: "--font-lilita", display: "swap" });

export const SATOSHI_CSS = "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap";
