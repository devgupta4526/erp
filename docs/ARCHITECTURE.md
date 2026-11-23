# Architecture

BusinessOS uses one Next.js App Router application and one PostgreSQL database. The application serves its UI and handles mutations through server actions. Each implemented domain owns its server directory and migration. Domain services hold business logic and use parameterized queries through a shared connection pool.

## Tenant and subscription boundaries

- Derive tenant identity from a revocable session that references a current organization membership. Browser forms supply business inputs and record IDs.
- Scope business data queries by organization. Use composite tenant keys for dependent records. The current modules enforce scoping in application SQL.
- Check subscription state and enabled modules for every business list or mutation. Recheck write permissions in the mutation transaction. Record changes in the audit table in the same transaction.
- Migrations are ordered, checksummed and applied under a PostgreSQL advisory lock. The current service account owns application tables. A separate migration role and database-enforced row security remain open for production.

## Deployment profile

The base stack runs PostgreSQL, a one-shot migration service and the web process. Local development uses loopback ports. Production routes public requests through Caddy. Optional processing languages, queues and private file storage enter the stack when their first workflow needs them. External payments would post verified and idempotent events through a provider adapter. That contract remains pending.

Accounting Practice stores small PDF and text attachments as private PostgreSQL records with tenant and engagement keys. Access is limited to staff managers and the assigned staff member, downloads use attachment disposition, and upload and authorized download events enter the audit log. The current quota is 512 KB per file, 25 files per engagement, and 20 MB per organization. Malware scanning and retention workflows are pending.

Driver Workspace reuses Fleet's job records and state transitions. It checks its own module entitlement and only lists the signed-in driver's assignments, including when the driver also has dispatch privileges.
