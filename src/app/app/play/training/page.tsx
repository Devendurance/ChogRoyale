import TrainingCampScreen from "@/components/app/TrainingCampScreen";

// Auth-gated client surface. Keep it blocking rather than prerendering a
// shell that cannot know the signed-in player's progress.
export const instant = false;

export default function TrainingCampPage() {
  return <TrainingCampScreen />;
}
