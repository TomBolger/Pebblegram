$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path data | Out-Null
docker compose up --build -d
Write-Host "Pebblegram helper is running at http://localhost:8765"
Write-Host "Open http://localhost:8765/config.html to configure the watch app."
