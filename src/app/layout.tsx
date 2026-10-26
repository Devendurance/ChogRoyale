import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chog Royale",
  description: "Chog Royale is a 1v1 card battler where a real Chog changes the match.",
  applicationName: "Chog Royale",
  appleWebApp: {
    capable: true,
    title: "Chog Royale",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d1458",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
