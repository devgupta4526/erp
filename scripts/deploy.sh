#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/compose-prod.sh"

businessos_compose up -d --build --wait --wait-timeout 180
