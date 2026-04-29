#!/usr/bin/env sh
set -eu

mkdir -p data
docker compose up --build -d
echo "Pebblegram helper is running at http://localhost:8765"
echo "Open http://localhost:8765/config.html to configure the watch app."
