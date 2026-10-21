import { COMMANDER_COMBAT_PROFILE_V1 } from "@/lib/combat";
import { CLASS_ROSTER, COMMANDER_CLASSES, type CommanderClass } from "@/lib/commanders";
import type { SiteCard } from "./site-cards";

// Commander class cards for the Collect scene. Cost comes from the class-keyed
// combat profile (free and NFT commanders share it), role and active ability
// from the B1 class roster. Art is the approved READY_STATIC presentation-kit
// v001 class template, which is shared by every commander of the class and is
// never the likeness of a specific NFT.

export interface SiteCommander {
  id: CommanderClass;
  card: SiteCard;
  /** Second sentence of the authored class role, e.g. "Dives the frontline...". */
  blurb: string;
}

const ART: Record<CommanderClass, { src: string; width: number; height: number }> = {
  bulwark: { src: "/assets/site/commanders/bulwark.png", width: 531, height: 690 },
  reaver: { src: "/assets/site/mascots/reaver-commander-class.png", width: 547, height: 634 },
  deadeye: { src: "/assets/site/commanders/deadeye.png", width: 569, height: 628 },
  scout: { src: "/assets/site/commanders/scout.png", width: 472, height: 665 },
  warden: { src: "/assets/site/commanders/warden.png", width: 533, height: 690 },
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function commanderClasses(): SiteCommander[] {
  return COMMANDER_CLASSES.map((id) => {
    const profile = CLASS_ROSTER[id];
    const [head = "", ...rest] = profile.role.split(". ");
    const active = profile.abilities.find((a) => a.trigger === "active");
    return {
      id,
      card: {
        id: `cmdr-${id}`,
        name: titleCase(id),
        cost: COMMANDER_COMBAT_PROFILE_V1[id].cost,
        type: "Commander",
        traits: [head.split(" / ")[0]!, active?.name].filter((t): t is string => !!t),
        art: ART[id],
      },
      blurb: rest.join(". "),
    };
  });
}
