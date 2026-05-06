# Pebblegram Helper

This helper connects Pebblegram to your Telegram account. It runs locally in
Docker and stores your Telegram login session in the `data` folder.

## What You Need

- Docker Desktop or Docker Engine with Docker Compose, or Python for Windows if
  you use `dockerless.bat`
- A Telegram API ID and API hash from https://my.telegram.org/apps
- The phone number for your Telegram account
- Optional for Windows without Docker: ngrok from https://ngrok.com/download
  and an ngrok authtoken for a public HTTPS bridge URL

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

## Windows Without Docker

Use `dockerless.bat` if you are logged into Windows as a standard user, cannot
install Docker Desktop, or do not want the helper to depend on Docker.

`dockerless.bat` does not request administrator access. It creates a Python
virtual environment in this folder, installs the helper dependencies there, and
stores Telegram settings/session files under `%LOCALAPPDATA%\Pebblegram`.
It installs a Pillow version compatible with older user-installed Python
versions, so it does not use the Docker image's exact pinned dependency set.

Double-click `dockerless.bat`, or run it from Command Prompt:

```bat
dockerless.bat
```

The first run asks for your Telegram API ID, API hash, and phone number, then
prints a Pebblegram bridge token. If `ngrok.exe` is next to `dockerless.bat` or
on `PATH`, the script also asks for your ngrok authtoken, signs ngrok in, starts
a public tunnel, and opens an ngrok window that shows the public bridge URL.
Leave the Command Prompt, bridge, and ngrok windows open while using Pebblegram.

If Windows Firewall blocks your phone from reaching port `8765` on this PC,
changing the firewall rule may require an administrator account. In that case,
use a tunnel/reverse proxy or run the helper on a machine where inbound access
is already allowed.

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
- ngrok from `dockerless.bat`: the `https://...ngrok-free.app` URL shown in the
  ngrok window or at `http://127.0.0.1:4040`

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
