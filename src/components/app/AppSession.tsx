"use client";

// The authenticated session for the whole game section.
//
// The Privy provider lives here, in the shared /app layout, so the lobby and
// the deck screen run on one session. A route change inside the game never
// tears the provider down and never starts a second one.

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export default function AppSession({ children }: { children: ReactNode }) {
  if (!APP_ID) {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate">
            <h1 className="app-gate__title">Chog Royale</h1>
            <p className="app-gate__lead">
              This build is missing NEXT_PUBLIC_PRIVY_APP_ID, so the game cannot sign anyone in.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <PrivyProvider appId={APP_ID} config={{ embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } } }}>
      {children}
    </PrivyProvider>
  );
}
