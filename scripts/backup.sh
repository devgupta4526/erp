#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/compose-prod.sh"

umask 077
destination=${1:-"$businessos_root/backups"}
mkdir -p -- "$destination"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary=$(mktemp "$destination/.businessos-$timestamp.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT

businessos_compose exec -T db pg_dump --format=custom --no-owner --no-acl \
  --username=businessos businessos > "$temporary"
backup="$destination/businessos-$timestamp-${temporary##*.}.dump"
mv -- "$temporary" "$backup"
printf '%s\n' "$backup"
