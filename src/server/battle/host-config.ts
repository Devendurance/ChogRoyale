// P7a production-safe host configuration for the Colyseus battle server.
// Pure and dependency-free: resolves string env into a validated config or
// a list of refusal reasons. Never includes secret values in errors.

export interface BattleHostConfig {
  /** Interface to bind, e.g. 127.0.0.1 or 0.0.0.0 behind a reverse proxy. */
  host: string;
  port: number;
  /** Public player-facing endpoint, e.g. wss://battle.example.com. */
  publicUrl: string;
  /** Approved frontend origins that may open the player-facing site. */
  allowedOrigins: string[];
  hostingEnabled: boolean;
  isProduction: boolean;
}

export type HostConfigResult = { ok: true; config: BattleHostConfig } | { ok: false; errors: string[] };

function isLoopback(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function publicHostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolve battle hosting config. Development (NODE_ENV != production,
 * BATTLE_HOSTING_ENABLED unset) keeps the historical localhost defaults and
 * never refuses. Strict mode (hosting enabled, or any production env)
 * requires explicit host, port, public URL, and allowed origins, and
 * refuses otherwise. Production without BATTLE_HOSTING_ENABLED=1 always
 * refuses: NODE_ENV alone never enables public hosting.
 */
export function resolveBattleHostConfig(env: Record<string, string | undefined>): HostConfigResult {
  const isProduction = env.NODE_ENV === "production";
  const hostingEnabled = env.BATTLE_HOSTING_ENABLED === "1";
  const strict = hostingEnabled || isProduction;
  const errors: string[] = [];

  if (isProduction && !hostingEnabled) {
    return {
      ok: false,
      errors: [
        "battle server refuses to run with NODE_ENV=production unless BATTLE_HOSTING_ENABLED=1; set it explicitly with BATTLE_SERVER_HOST, BATTLE_SERVER_PORT, BATTLE_PUBLIC_URL, and BATTLE_ALLOWED_ORIGINS",
      ],
    };
  }

  const rawHost = (env.BATTLE_SERVER_HOST ?? "").trim();
  const rawPort = (env.BATTLE_SERVER_PORT ?? "").trim();
  const rawPublicUrl = (env.BATTLE_PUBLIC_URL ?? "").trim();
  const rawOrigins = (env.BATTLE_ALLOWED_ORIGINS ?? "").trim();

  if (!strict) {
    const port = rawPort === "" ? 2567 : Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, errors: ["BATTLE_SERVER_PORT must be an integer 1-65535"] };
    }
    const host = rawHost === "" ? "127.0.0.1" : rawHost;
    return {
      ok: true,
      config: {
        host,
        port,
        publicUrl: rawPublicUrl === "" ? `ws://${host}:${port}` : rawPublicUrl,
        allowedOrigins: rawOrigins === "" ? [] : rawOrigins.split(",").map((s) => s.trim()).filter(Boolean),
        hostingEnabled: false,
        isProduction: false,
      },
    };
  }

  if (rawHost === "") errors.push("BATTLE_SERVER_HOST is required when hosting is enabled");
  const port = Number(rawPort);
  if (rawPort === "" || !Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push("BATTLE_SERVER_PORT is required when hosting is enabled and must be an integer 1-65535");
  }
  if (rawPublicUrl === "") {
    errors.push("BATTLE_PUBLIC_URL is required when hosting is enabled (the public wss:// endpoint players connect to)");
  } else if (!rawPublicUrl.startsWith("wss://")) {
    const host = publicHostOf(rawPublicUrl);
    const localPublic = host !== null && (host === "localhost" || host === "127.0.0.1" || host === "::1");
    if (!(localPublic && rawPublicUrl.startsWith("ws://"))) {
      errors.push("BATTLE_PUBLIC_URL must use wss:// (ws:// is accepted only for localhost acceptance)");
    }
  }
  const allowedOrigins = rawOrigins === "" ? [] : rawOrigins.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowedOrigins.length === 0) {
    errors.push("BATTLE_ALLOWED_ORIGINS is required when hosting is enabled (comma-separated frontend origins)");
  } else {
    for (const o of allowedOrigins) {
      let u: URL | null = null;
      try {
        u = new URL(o);
      } catch {
        u = null;
      }
      if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) {
        errors.push(`BATTLE_ALLOWED_ORIGINS entry is not an http(s) origin: ${o.slice(0, 80)}`);
      } else if (isProduction && u.protocol !== "https:") {
        const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
        if (!local) errors.push(`BATTLE_ALLOWED_ORIGINS entry must be https:// in production: ${o.slice(0, 80)}`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      host: rawHost,
      port,
      publicUrl: rawPublicUrl,
      allowedOrigins,
      hostingEnabled: true,
      isProduction,
    },
  };
}

/** One-line boot summary with no secrets: hosts, ports, origins, gates. */
export function describeBattleHostConfig(config: BattleHostConfig): string {
  const origins = config.allowedOrigins.length > 0 ? config.allowedOrigins.join(",") : "(none configured)";
  const loopbackNote = isLoopback(config.host) ? " (loopback: reverse proxy must run on the same host)" : "";
  return `battle host=${config.host}${loopbackNote} port=${config.port} public=${config.publicUrl} origins=${origins}`;
}
