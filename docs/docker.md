# Pebblegram Bridge Docker

## One-command local setup

Run the bridge interactively once. It will ask for your Telegram API ID, API
hash, phone number, then generate and print a bridge token.

```bash
docker compose run --rm --service-ports bridge
```

The setup is saved to `./data/pebblegram.env`, and the Telegram session is
stored in `./data`. After the first login succeeds, keep it running with:

```bash
docker compose up -d
```

The bridge listens on `http://localhost:8765` on the host that runs Docker.
Open `http://localhost:8765/config.html` to configure Pebblegram, or use the
same page through your hosted HTTPS URL.

## Non-interactive setup

You can still provide settings through `.env`:

```bash
cp .env.example .env
# edit .env with your Telegram API values, phone number, and optional token
docker compose up --build -d
```

Pebblegram settings should point to a reachable URL, for example:

- `http://127.0.0.1:8765` for emulator testing on the same machine
- `http://192.168.1.50:8765` for an Android phone on the same LAN
- `http://host.docker.internal:8765` when that hostname is available from the phone-side app

The session is stored in `./data` through the compose volume mount.

Sending replies is enabled by default with `TELEGRAM_ALLOW_SEND=1`. Message deletion is disabled by default with `TELEGRAM_ALLOW_DELETE=0`.

## Hosted bridge

For personal use at home, the simplest reliable setup is:

1. Run this Docker compose service on a machine that stays on.
2. Use a dynamic DNS name for your home IP.
3. Forward only ports 80 and 443 to a reverse proxy such as Caddy.
4. Let Caddy terminate HTTPS and proxy to `http://bridge:8765` or `http://127.0.0.1:8765`.
5. Set `PEBBLEGRAM_TOKEN` in `.env`, then enter the same token in Pebblegram settings.

Do not expose port `8765` directly to the internet without a token. Telegram account access lives behind this bridge.

A VPS is cleaner for community users because it avoids home router port forwarding and ISP blocks. The same compose file works there; point Pebblegram settings at `https://your-domain.example`.

Tailscale is the easiest secure path for your own devices, but it is less friendly for app-store users because every user must join/configure a tailnet.

For a public HTTPS host, use the hosted compose file. First run it
interactively if you have not already created `./data/pebblegram.env`:

```bash
docker compose -f docker-compose.hosted.yml run --rm --service-ports bridge
```

Then set `PEBBLEGRAM_DOMAIN` in `.env` and start the hosted stack:

```bash
docker compose -f docker-compose.hosted.yml up --build -d
```

Then put `https://your-domain.example` and the same bridge token into Pebblegram settings.
