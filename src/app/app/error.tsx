"use client";

// Last-resort recovery inside the game shell. It keeps the shared session and
// reports the failure instead of leaving the player on the framework page.

import { useEffect } from "react";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("app route error", error);
  }, [error]);
  return (
    <main className="app-stage app-stage--gate">
      <div className="app-column app-column--gate">
        <div className="app-panel app-gate" data-testid="app-route-error">
          <h1 className="app-gate__title">Something went wrong</h1>
          <p className="app-gate__lead" role="alert">This screen hit a problem. Your account and progress are safe.</p>
          <button type="button" className="app-btn app-btn--battle" onClick={() => retry()}>Try again</button>
        </div>
      </div>
    </main>
  );
}
