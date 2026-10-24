# P7a Production-Safe Battle Host

The Colyseus battle server is unchanged as a game server. This slice adds
a fail-closed hosting bootstrap around it. Nothing here deploys anything.

## 1. Existing host limitations (unchanged by this slice)

- `MatchCoordinator` is in-memory per process: queue, tickets, matched
  reservations, and activities die with a restart and cannot span replicas.
  Run exactly one battle-server replica until shared presence exists.
- Battles are in-memory: a restart drops active matches, queue state, and
  grace windows. Clients see the existing reconnect/abort stages, never a
  resumed match from before the restart.
- `gracefullyShutdown: false` stays off in the Colyseus constructor; the
  hosting path installs its own SIGTERM/SIGINT drain instead (Linux only;
  Windows termination bypasses handlers, so stopping there is abrupt).
- Room auth is transport-upgrade first, seat-verify second: a raw WebSocket
  upgrade gets 101 before `onAuth` runs, but no room can be joined, listed,
  or seated without a Privy-verified identity.

## 2. Required runtime config

Process command (persistent host, Node 20+):

```sh
NODE_ENV=production \
BATTLE_HOSTING_ENABLED=1 \
BATTLE_SERVER_HOST=127.0.0.1 \
BATTLE_SERVER_PORT=2567 \
BATTLE_PUBLIC_URL=wss://battle.example.com \
BATTLE_ALLOWED_ORIGINS=https://app.example.com \
DATABASE_URL='...' \
npm run battle:server
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `BATTLE_HOSTING_ENABLED=1` | yes in production | Explicit hosting activation. Production without it refuses to boot. |
| `BATTLE_SERVER_HOST` | yes in strict mode | Bind interface. Loopback is valid only when the TLS proxy runs on the same host. |
| `BATTLE_SERVER_PORT` | yes in strict mode | Integer 1-65535. No default in strict mode. |
| `BATTLE_PUBLIC_URL` | yes in strict mode | Player-facing endpoint, must be `wss://` (`ws://` accepted only for localhost acceptance). |
| `BATTLE_ALLOWED_ORIGINS` | yes in strict mode | Comma-separated frontend origins; `https://` enforced in production (localhost excepted). |
| `DATABASE_URL` | only with `BATTLE_SETTLEMENT=1` | Refused at boot when settlement is on but the URL is missing. |
| `BATTLE_SETTLEMENT`, `BATTLE_LEGACY`, `CARD_LEVEL_SCALING` | no | Existing opt-in gates, unchanged. Settlement additionally needs its tables (checked at boot). |

Missing or malformed values refuse startup with a named-variable error
and exit 1. No secret value ever appears in boot logs or errors; the boot
line prints host, port, public URL, and origins only.

## 3. Reverse proxy and WSS format

Terminate TLS at the proxy and forward plain WebSocket upgrades to the
battle process:

- Player URL: `wss://battle.example.com` (Colyseus SDK takes the https URL
  form and upgrades; path per room, e.g. the queue room route).
- Proxy must forward `Upgrade` and `Connection` headers verbatim with a
  long idle timeout (matches run up to ~30 minutes with 10s cadence).
- Sticky sessions are irrelevant while the replica count is 1; do not
  scale past 1 replica without shared presence (see §1).
- Health probe: `GET http(s)://<host>:<port>/healthz` answers
  `{"status":"ok","uptimeSec":N}`. Liveness only: no rooms, players, or
  secrets. Point the host's health check here, not at a room route.
- Restart behavior: new deploys start the replacement, then SIGTERM the
  old process, which drains rooms (up to a 15s cap) and exits. In-flight
  matches still end; clients reconnect to the new process and re-queue.

## 4. Frontend WSS integration

- `/app/play` and `/app/play/battle` already connect through the shared
  `BattlePanel`, which reads `NEXT_PUBLIC_BATTLE_SERVER_URL`. No code
  change was needed: set the variable to the public `https://` form of
  the battle host at web-build time (NEXT_PUBLIC values bake into the
  build; a URL change needs a rebuild, never a server secret).
- Localhost development is preserved: unset variable falls back to
  `http://127.0.0.1:2567`.
- The player route never mounts `/dev/battle`; it reuses only the shared
  `BattlePanel` component.
- Backend-unavailable behavior is existing: connecting/failed/closed
  stages, bounded resume retries inside the reconnect grace window, SDK
  auto-reconnect disabled. No endless loops, no fabricated readiness.

## 5. Auth and origin safety (verified, unchanged)

- Identity is Privy-verified server-side per connection (`onAuth` on every
  room, including resume). No client-selected identity, no forged seats:
  seats bind to the verified player id, reservations are one-shot server
  bearer keys, and matched rooms reject unknown/expired keys with 403.
- Queue integrity is coordinator-owned: one ticket per player (duplicate
  enqueue is 409), mode travels with the match key (no client promotion
  from unranked to ranked), cross-mode bypass rejected.
- Reconnect grace and match-start entitlement re-resolution are unchanged.
- Origins are defense-in-depth, not authentication: enforced as
  configured, but a correct origin never substitutes for the Privy check.
- Logging never carries tokens: auth failures log a static string, and
  `src/lib/logger.ts` redacts secret/token/password/authorization fields.
  No wallet secret exists in browser config (only the Privy app id).

## 6. Safe feature-gate defaults

| Capability | Production default | Gate |
| --- | --- | --- |
| Ranked matchmaking UI | Closed | `RANKED_PUBLIC_MATCHMAKING_ENABLED` (false) |
| Ranked trophies | Off unless migrated | `ranked_trophy_awards` presence + settlement lifecycle |
| Card XP / Gold | Off unless migrated | Table presence + settlement lifecycle |
| Legacy acceptance | Off unless opted in | `BATTLE_LEGACY=1` + `match_legacy_runs` presence |
| Card stat scaling | Off (Level 1 sim) | `CARD_LEVEL_SCALING=1`, fail-closed to L1 |
| Settlement writes | Off unless opted in | `BATTLE_SETTLEMENT=1` + tables presence |
| Gifting / $CHOG | Not served here | Next.js API surface, out of battle-server scope |

No new flag system was added. Migration-dependent features cannot arm on
an unmigrated database by construction.

## 7. Remaining deployment prerequisites (all owner-gated)

- [ ] Persistent host selected (single replica; Linux for signal drain).
- [ ] Public WSS domain provisioned.
- [ ] TLS + reverse-proxy with upgrade forwarding and `/healthz` checks.
- [ ] Production env values for §2, stored in the host secret manager.
- [ ] PROD migrations 0010-0022 reviewed and approved (PROD is at 0009).
- [ ] Privy production app config + allowlisted battle/origin URLs.
- [ ] Settlement worker activation decision (`BATTLE_SETTLEMENT=1`).
- [ ] Ranked abuse release policy (P6e.2 thresholds still unapproved).
- [ ] Live two-player acceptance with real accounts on the public URL.
- [ ] Real Genesis NFT-holder match for entitlement + legacy paths.

Recommended host characteristics: one always-on process, 512MB+ RAM,
WebSocket-friendly proxy (Caddy/nginx/equivalent), managed secret env,
log retention for the JSONL battle logs, and a deploy strategy that
SIGTERMs the old process after the replacement passes `/healthz`.
