$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path data | Out-Null
docker compose run --rm --service-ports bridge
