import type { Metadata } from "next";
import PlayGuideScreen from "@/components/app/PlayGuideScreen";
import { buildPlayGuideData } from "@/components/app/play-guide-data";

export const metadata: Metadata = {
  title: "Play Guide | Chog Royale",
  description: "The live arena, deck, energy, commander and Chaos rules for Chog Royale.",
};

// Ruleset values are projected on the server, so the client never imports the
// combat or Chaos modules.
const guide = buildPlayGuideData();

export default function PlayGuidePage() {
  return <PlayGuideScreen guide={guide} />;
}
