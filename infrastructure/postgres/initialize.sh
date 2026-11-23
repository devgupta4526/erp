#!/usr/bin/env bash
set -euo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv businessos_password BUSINESSOS_DATABASE_PASSWORD
CREATE ROLE businessos LOGIN PASSWORD :'businessos_password';
ALTER DATABASE businessos OWNER TO businessos;
SQL
