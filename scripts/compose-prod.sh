#!/usr/bin/env bash

# Source this file from a maintenance script.
businessos_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

businessos_compose() {
  docker compose --project-directory "$businessos_root" \
    -f "$businessos_root/docker-compose.yml" \
    -f "$businessos_root/docker-compose.prod.yml" "$@"
}
