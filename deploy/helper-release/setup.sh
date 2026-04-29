#!/usr/bin/env sh
set -eu

mkdir -p data
docker compose run --rm --service-ports bridge
