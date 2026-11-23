#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/compose-prod.sh"

if [[ $# -ne 1 || $1 != https://* ]]; then
  printf 'Usage: bash scripts/verify-deployment.sh https://erp.example.com\n' >&2
  exit 2
fi

businessos_compose ps
for service in db app; do
  container_id=$(businessos_compose ps --quiet "$service")
  [[ -n $container_id ]]
  health=$(docker inspect --format '{{.State.Health.Status}}' "$container_id")
  if [[ $health != healthy ]]; then
    printf '%s health status: %s\n' "$service" "$health" >&2
    exit 1
  fi
done

migration_id=$(businessos_compose ps --all --quiet migrate)
[[ -n $migration_id ]]
[[ $(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$migration_id") == exited:0 ]]
curl --fail --silent --show-error --max-time 20 "${1%/}/api/health"
printf '\n'
