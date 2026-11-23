# Backup and recovery

The backup script writes a PostgreSQL custom-format archive with permissions restricted to the executing user. It performs a consistent logical dump of the BusinessOS database. Archives exclude Compose secrets, Docker volumes outside PostgreSQL, and proxy certificates. Preserve production configuration separately through an encrypted backup.

```bash
bash scripts/backup.sh /var/backups/businessos
```

For daily automated backups, create a private archive directory writable by the production maintenance account and add an entry to its crontab. Adapt the repository path to your installation.

```cron
15 2 * * * /usr/bin/bash /srv/businessos/scripts/backup.sh /var/backups/businessos
```

Copy archives to encrypted off-server storage and apply retention there and on the VPS. Check that the scheduled jobs produce archives and that the off-server copies arrive.

## Restoration drill

Use an equivalent staging instance when verifying archives. The restore command creates a fresh database on the instance selected by the local Compose project. It rejects an existing target and runs the import in one transaction.

```bash
bash scripts/restore.sh /var/backups/businessos/ARCHIVE.dump businessos_recovery_drill
```

Review the restored table count and query representative records. To verify application behavior, point an isolated staging app at the recovered database, select the app revision compatible with the archive, and run sign-in and tenant-specific workflow checks. Rehearse before customer data is onboarded. Restoration verification remains pending.

## Disaster recovery

Recover the environment file and checked-out revision for the backup onto a fresh VPS or isolated Compose project. Start PostgreSQL, restore the archive into a recovery database, and verify its data. During a deliberate cutover, place the production app in maintenance and use a database connection aimed at the recovered database. The baseline Compose URL targets `businessos`. Configure a Compose override for the app and migration job if the recovery database retains its recovery name. Verify the recovered instance before switching DNS, then keep the prior database and the recovery archive until sign-off.
