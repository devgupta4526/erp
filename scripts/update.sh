#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/compose-prod.sh"

cd "$businessos_root"
if [[ -n $(git status --porcelain) ]]; then
  printf 'Commit or stash local changes before updating.\n' >&2
  exit 1
fi

previous=$(git rev-parse HEAD)
printf 'Previous revision: %s\n' "$previous"
bash scripts/backup.sh
git pull --ff-only
bash scripts/deploy.sh
