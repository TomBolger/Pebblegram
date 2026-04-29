# Pebblegram Helper

This helper connects Pebblegram to your Telegram account. It runs locally in
Docker and stores your Telegram login session in the `data` folder.

## What You Need

- Docker Desktop or Docker Engine with Docker Compose
- A Telegram API ID and API hash from https://my.telegram.org/apps
- The phone number for your Telegram account

## Setup

macOS/Linux:

```bash
sh setup.sh
```

Windows PowerShell:

```powershell
.\setup.ps1
```

The setup script builds the helper, asks for your Telegram API ID, API hash,
and phone number, then prints a Pebblegram bridge token. Telegram may ask for a
login code during this step.

After login succeeds, leave the helper running or press `Ctrl+C` and start it
in the background:

macOS/Linux:

```bash
sh start.sh
```

Windows PowerShell:

```powershell
.\start.ps1
```

## Configure Pebblegram

Open the helper settings page:

```text
http://localhost:8765/config.html
```

Use the bridge token printed by setup.

For a real phone/watch, the bridge URL must be reachable from the phone. Common
examples:

- Same LAN: `http://YOUR-COMPUTER-LAN-IP:8765`
- Reverse proxy or VPS: `https://your-domain.example`

Do not expose the helper to the public internet without a bridge token.

## Stop Or Update

Stop:

```bash
docker compose down
```

Update after replacing these files with a newer release:

```bash
docker compose up --build -d
```

Your Telegram session and generated bridge token stay in `data/`.
