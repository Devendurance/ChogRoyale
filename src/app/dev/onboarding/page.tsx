"use client";

import { useCallback, useEffect, useState } from "react";
import { PrivyProvider, usePrivy, useWallets, useCreateWallet, useLogin } from "@privy-io/react-auth";
import { defineChain } from "viem";

const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monad Explorer", url: "https://monadscan.com" } },
});

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return (await res.json()) as ApiEnvelope<T>;
}

type LoginStage =
  | "idle"
  | "login-started"
  | "authenticating"
  | "authenticated"
  | "login-cancelled"
  | "login-error";

function sanitizeLoginError(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 200);
  if (typeof e === "string") return e.slice(0, 200);
  try {
    return JSON.stringify(e).slice(0, 200);
  } catch {
    return "unknown error";
  }
}

function OnboardingPanel() {
  const { ready, authenticated, logout, linkWallet, getAccessToken, user } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [log, setLog] = useState<string[]>([]);
  const push = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 30));
  }, []);
  const [profile, setProfile] = useState<unknown>(null);
  const [username, setUsername] = useState("");
  const [avatarId, setAvatarId] = useState("chog-ember");
  const [avatars, setAvatars] = useState<Array<{ id: string; name: string; assetUrl: string }>>([]);

  const [stage, setStage] = useState<LoginStage>("idle");
  const [method, setMethod] = useState<string>("none");
  const [lastError, setLastError] = useState<string | null>(null);
  const [tokenAvailable, setTokenAvailable] = useState<boolean | null>(null);
  const [serverAccepted, setServerAccepted] = useState<boolean | null>(null);

  const { login } = useLogin({
    onComplete: () => {
      setStage("authenticated");
      setLastError(null);
      push("login complete");
    },
    onError: (e: unknown) => {
      const message = sanitizeLoginError(e);
      setLastError(message);
      setStage(/cancel|dismiss|close|exit/i.test(message) ? "login-cancelled" : "login-error");
      push(`login failed: ${message}`);
    },
  });

  const startLogin = useCallback(
    (loginMethod: string) => {
      setMethod(loginMethod);
      setLastError(null);
      setStage("login-started");
      push(`login started (${loginMethod})`);
      try {
        login();
        setStage("authenticating");
      } catch (e: unknown) {
        const message = sanitizeLoginError(e);
        setLastError(message);
        setStage("login-error");
        push(`login initiation failed: ${message}`);
      }
    },
    [login, push]
  );

  const probeToken = useCallback(async () => {
    try {
      const token = await getAccessToken();
      setTokenAvailable(!!token);
      push(token ? "access token available" : "no access token");
    } catch (e: unknown) {
      setTokenAvailable(false);
      push(`token probe failed: ${sanitizeLoginError(e)}`);
    }
  }, [getAccessToken, push]);

  useEffect(() => {
    fetch("/api/players/avatars")
      .then((r) => r.json())
      .then((j: ApiEnvelope<{ avatars: Array<{ id: string; name: string; assetUrl: string }> }>) => {
        if (j.success && j.data) setAvatars(j.data.avatars);
      })
      .catch(() => push("avatar catalog unreachable"));
  }, [push]);

  const authed = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      if (!token) {
        push("no access token (logged out?)");
        return null;
      }
      return api(path, token, init);
    },
    [getAccessToken, push]
  );

  const doBootstrap = useCallback(async () => {
    const j = await authed("/api/auth/bootstrap", { method: "POST" });
    if (!j) return;
    push(j.success ? "bootstrap ok" : `bootstrap failed: ${j.error?.code} ${j.error?.message}`);
    setServerAccepted(j.success);
    if (j.success) setProfile(j.data);
  }, [authed, push]);

  const doSync = useCallback(async () => {
    const j = await authed("/api/players/me/wallets/sync", { method: "POST", body: "{}" });
    if (!j) return;
    push(j.success ? `sync ok: ${JSON.stringify(j.data)}` : `sync failed: ${j.error?.code} ${j.error?.message}`);
  }, [authed, push]);

  const doOnboard = useCallback(async () => {
    const j = await authed("/api/players/onboard", {
      method: "POST",
      body: JSON.stringify({ ...(username ? { username } : {}), avatarId }),
    });
    if (!j) return;
    push(j.success ? `onboard ok: ${JSON.stringify(j.data)}` : `onboard failed: ${j.error?.code} ${j.error?.message}`);
    if (j.success) setProfile(j.data);
  }, [authed, push, username, avatarId]);

  const doRefresh = useCallback(async () => {
    const j = await authed("/api/players/me");
    if (!j) return;
    push(j.success ? "profile refreshed" : `profile failed: ${j.error?.code}`);
    if (j.success) setProfile(j.data);
  }, [authed, push]);

  if (!ready) return <p>Loading Privy…</p>;
  if (!APP_ID) return <p>Missing NEXT_PUBLIC_PRIVY_APP_ID.</p>;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <section>
        <h2>Login diagnostics</h2>
        <ul style={{ fontSize: 12 }}>
          <li>stage: {stage}</li>
          <li>method: {method}</li>
          <li>ready: {String(ready)}</li>
          <li>authenticated: {String(authenticated)}</li>
          <li>wallets connected: {wallets.length} (connection is not login)</li>
          <li>user id present: {String(!!user?.id)}</li>
          <li>access token available: {tokenAvailable === null ? "unknown" : String(tokenAvailable)}</li>
          <li>server accepted auth: {serverAccepted === null ? "unknown" : String(serverAccepted)}</li>
          {lastError && <li>last error: {lastError}</li>}
        </ul>
        {(stage === "login-error" || stage === "login-cancelled") && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => startLogin(method === "none" ? "privy-modal" : method)}>Retry login</button>
            <span style={{ fontSize: 12 }}>
              {stage === "login-cancelled"
                ? "Login was closed before finishing. Retrying is safe."
                : "Check that this origin is allowed in the Privy dashboard, then retry."}
            </span>
          </div>
        )}
      </section>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!authenticated ? (
          <button onClick={() => startLogin("privy-modal")}>Log in with Privy</button>
        ) : (
          <>
            <button onClick={() => logout().then(() => { setProfile(null); setStage("idle"); setMethod("none"); setTokenAvailable(null); setServerAccepted(null); push("logged out"); })}>
              Log out
            </button>
            <button onClick={() => linkWallet()}>Link external wallet</button>
            <button
              onClick={() =>
                createWallet()
                  .then((w) => push(`embedded wallet created: ${w.address}`))
                  .catch((e: unknown) => push(`create wallet failed: ${e instanceof Error ? e.message : e}`))
              }
            >
              Create embedded wallet
            </button>
          </>
        )}
      </div>

      <section>
        <h2>Wallets (Privy session)</h2>
        <ul>
          {wallets.map((w: { address: string; walletClientType: string }) => (
            <li key={w.address}>
              {w.address} ({w.walletClientType})
            </li>
          ))}
        </ul>
      </section>

      {authenticated && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={doBootstrap}>1. Bootstrap player</button>
            <button onClick={doSync}>2. Sync wallets</button>
            <button onClick={doRefresh}>Refresh profile</button>
            <button onClick={probeToken}>Check access token</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ color: "#000" }}
            />
            <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} style={{ color: "#000" }}>
              {avatars.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button onClick={doOnboard}>3. Claim + avatar</button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {avatars.map((a) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={a.id}
                src={a.assetUrl}
                alt={a.name}
                width={48}
                height={48}
                style={{ outline: avatarId === a.id ? "2px solid #38bdf8" : "none", cursor: "pointer" }}
                onClick={() => setAvatarId(a.id)}
              />
            ))}
          </div>
          <section>
            <h2>Persisted player</h2>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(profile, null, 2)}</pre>
          </section>
        </>
      )}

      <section>
        <h2>Log</h2>
        <ul>
          {log.map((line, i) => (
            <li key={i} style={{ fontSize: 12 }}>
              {line}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function DevOnboardingPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Dev onboarding (B0 verification surface)</h1>
      <p>Functional test UI only. Not the game.</p>
      <PrivyProvider
        appId={APP_ID}
        config={{
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
          supportedChains: [monadMainnet],
          defaultChain: monadMainnet,
        }}
      >
        <OnboardingPanel />
      </PrivyProvider>
    </main>
  );
}
