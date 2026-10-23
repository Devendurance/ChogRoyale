"use client";

// Development battle entry. The battle session itself lives in BattlePanel so
// the player-facing app route and this debugging route share one lifecycle.
import { PrivyProvider } from "@privy-io/react-auth";
import { BattlePanel } from "./BattlePanel";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export default function DevBattlePage() {
  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Chog Royale dev battle (B3.1 alpha)</h1>
      <PrivyProvider appId={APP_ID} config={{ embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } } }}>
        <BattlePanel />
      </PrivyProvider>
    </main>
  );
}
