# endy-vps Cutover Runbook (execute once `ssh endy-vps` works)

## 0. Unblock SSH (owner action, one time)

From this machine, the offered key is rejected for both `endy` and
`ubuntu` on 38.49.217.165. On endy-vps, as the target user, append the
client public key:

```sh
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILfb3oupiNuZDwjFMkCgHX9JcT8yfHCcQimE1T8m0vua endy-vps' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

## 1. Inspect (read-only, touch nothing else)

```sh
hostname; uname -a; nproc; free -h | head -n 2; df -h / | tail -n 1
node --version; npm --version
which caddy nginx; ss -tlnp | head
```

## 2. Transfer release code (from the dev machine, after SSH works)

```sh
# dev machine: tarball of pushed 65e19e4 (excludes node_modules/.git/secrets)
tar -cz --exclude=node_modules --exclude=.git --exclude=.next \
  --exclude=.battle-replays -f /tmp/chog-deploy.tgz -C <repo> .
scp /tmp/chog-deploy.tgz endy-vps:/tmp/
ssh endy-vps "mkdir -p ~/apps/chog-royale && tar -xzf /tmp/chog-deploy.tgz -C ~/apps/chog-royale && rm /tmp/chog-deploy.tgz"
```

## 3. Install + pre-settlement service (settlement OFF for health checks)

```sh
cd ~/apps/chog-royale && npm ci --prefer-offline --no-audit --no-fund
```

Write `~/apps/chog-royale/battle.env` (mode 600) with the PROD values
already used on aws-hermes, **minus settlement for now**:

```sh
NODE_ENV=production
BATTLE_HOSTING_ENABLED=1
BATTLE_SERVER_HOST=127.0.0.1
BATTLE_SERVER_PORT=2567
BATTLE_PUBLIC_URL=wss://<final-host>
BATTLE_ALLOWED_ORIGINS=https://chogroyale.xyz,https://chogroyale.vercel.app
DATABASE_URL=<prod direct>
PRIVY_APP_SECRET=<prod secret>
```

systemd unit `/etc/systemd/system/chog-royale-battle.service` (same shape
as aws-hermes), then `daemon-reload`, `enable --now`, verify
`curl http://127.0.0.1:2567/healthz` and the boot log gates.

## 4. Reverse proxy

Reuse Caddy/nginx if present and suitable without touching unrelated
sites. Otherwise install Caddy and proxy `<final-host>` to
127.0.0.1:2567. `<final-host>` is `battle.chogroyale.xyz` once DNS points
at endy-vps, else a nip.io name for the verified endy-vps IP (no guessing:
take the IP from the SSH connection itself).

## 5. Controlled cutover (zero real players expected)

1. Confirm endy-vps `/healthz` + WSS handshake + gates (ranked closed,
   legacy/scaling off, settlement still off).
2. `sudo systemctl stop chog-royale-battle` on aws-hermes (SIGTERM drain;
   do NOT shut down the host, delete files, or touch other services).
3. Add `BATTLE_SETTLEMENT=1` to endy-vps `battle.env`, restart its
   service, confirm `settlement enabled` in the boot log.
4. `sudo systemctl disable chog-royale-battle` on aws-hermes (stays
   installed but inert until further instruction).
5. Update Vercel `NEXT_PUBLIC_BATTLE_SERVER_URL` to the new host and
   redeploy; never point back at 63-183-2-78.nip.io.

## 6. Rollback

Re-enable aws-hermes (`enable --now`, it still has settlement on and
healthy code) and point the frontend var back. No data migration is
involved: both hosts share the same Neon PROD branch.
