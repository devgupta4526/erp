#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/compose-prod.sh"

if [[ $# -ne 2 || ! -f $1 || ! $2 =~ ^businessos_recovery_[a-z0-9_]{1,40}$ ]]; then
  printf 'Usage: bash scripts/restore.sh BACKUP_FILE businessos_recovery_NAME\n' >&2
  exit 2
fi

backup=$1
target=$2
businessos_compose exec -T db createdb --username=postgres --owner=businessos --template=template0 "$target"
if ! businessos_compose exec -T db pg_restore --single-transaction --exit-on-error \
  --no-owner --no-acl --username=businessos --dbname="$target" < "$backup"; then
  businessos_compose exec -T db dropdb --username=postgres "$target"
  exit 1
fi

businessos_compose exec -T db psql --username=businessos --dbname="$target" \
  --set=ON_ERROR_STOP=1 --command="SELECT current_database(), count(*) AS public_tables FROM pg_tables WHERE schemaname = 'public';"
