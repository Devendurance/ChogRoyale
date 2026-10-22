"use client";

// The authenticated lobby route (A1). The shell and the ruleset catalog live
// in the route layout; this route renders the lobby itself.

import GameLobby from "@/components/app/GameLobby";

export default function AppPage() {
  return <GameLobby />;
}
