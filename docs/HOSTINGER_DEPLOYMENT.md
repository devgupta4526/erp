# Hostinger deployment

BusinessOS is configured for an Ubuntu VPS with Docker Engine and Docker Compose v2. The production Compose project uses Caddy to publish the application over HTTPS and attaches PostgreSQL to an internal network. The app becomes available after the migration job succeeds. These deployment files are pending execution and verification.

## First deployment

1. Provision a Hostinger Ubuntu VPS with Docker support. Configure SSH key access and SSH into the server. The project uses repository files and a local Docker build, so the commands below run over SSH. [Hostinger Docker template](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/)
2. Point the chosen hostname's A record at the VPS IPv4 address. Add AAAA only when the VPS serves that address. Permit TCP 80 and 443 and optionally UDP 443, plus the restricted SSH port you use. Caddy obtains and renews certificates automatically. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
3. Clone the BusinessOS project into a persistent path. Create a private environment file and generate a hexadecimal password, which can be embedded in the connection URL without escaping.

```bash
git clone YOUR_BUSINESSOS_REPOSITORY_URL businessos
cd businessos
umask 077
cp .env.production.example .env
openssl rand -hex 32
openssl rand -hex 32
```

Set separate generated values for `POSTGRES_PASSWORD` and `POSTGRES_ADMIN_PASSWORD`. Set `APP_DOMAIN` to the DNS hostname, `APP_ORIGIN` to its full HTTPS origin, and `SECURE_COOKIES=true`. Preserve both database credentials separately for recovery. Rotating a password on an existing volume requires changing the corresponding PostgreSQL role password in coordination with the environment update.

```bash
bash scripts/deploy.sh
bash scripts/verify-deployment.sh https://erp.example.com
```

## Operations

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -a
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 app proxy db migrate
docker compose -f docker-compose.yml -f docker-compose.prod.yml stats --no-stream
```

Database data and Caddy's certificate store persist across container replacement. Protect the database backups with the same access restrictions as the live database. See [backup and recovery](BACKUP_RECOVERY.md).

## Update and rollback

```bash
bash scripts/update.sh
bash scripts/verify-deployment.sh https://erp.example.com
```

The update takes a database backup and prints the previous Git revision before fast-forwarding. For a rollback compatible with the current database schema, check out that previous revision, run its deploy script, and verify its health. If a schema change is incompatible, pause writes and recover the pre-update database into a separate database first. Promote only after checking the archive, the old application version, and the expected data loss from restoring a point-in-time copy.
