import { PRACTICE_DIFFICULTIES, type PracticeDifficulty } from "@/lib/battle-protocol";

/** Player-facing copy for the server-owned Practice difficulty choices. */
export const PRACTICE_DIFFICULTY_OPTIONS = [
  {
    value: "medium",
    label: "Medium",
    tagline: "Learn the arena",
    description: "A balanced AI opponent that attacks, defends and manages its energy.",
  },
  {
    value: "hard",
    label: "Hard",
    tagline: "Sharpen your strategy",
    description: "A more tactical opponent with stronger counters, coordinated attacks and defense.",
  },
  {
    value: "ultimate",
    label: "Ultimate",
    tagline: "Face the master",
    description: "The strongest AI, with advanced lane pressure, commander timing and abilities.",
  },
] as const satisfies readonly {
  value: PracticeDifficulty;
  label: string;
  tagline: string;
  description: string;
}[];

export const DEFAULT_PRACTICE_DIFFICULTY: PracticeDifficulty = PRACTICE_DIFFICULTIES[0];

export function practiceDifficultyOption(value: PracticeDifficulty) {
  return PRACTICE_DIFFICULTY_OPTIONS.find((option) => option.value === value) ?? PRACTICE_DIFFICULTY_OPTIONS[0];
}
