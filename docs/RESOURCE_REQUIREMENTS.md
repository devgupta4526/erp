# Resource requirements

Measured CPU, memory, disk, and throughput minimums are pending the deferred verification phase. The values below are initial capacity-planning budgets for the foundation and exclude media and other specialized processing.

| Mode | Services | Starting evaluation budget |
| --- | --- | --- |
| Local development | Host Node.js and one PostgreSQL instance | 2 CPU cores and 4 GB RAM for the whole machine, with room for development tools and the operating system |
| Loopback demo | Node.js and PostgreSQL containers | 2 vCPU, 4 GB RAM, 20 GB disk |
| Single VPS | Caddy, Node.js, and PostgreSQL | 2 vCPU, 4 GB RAM, 40 GB SSD plus an off-server backup destination |
| Higher capacity | Separate build runner and, if justified, a dedicated database host | Size via measurements of query load, concurrent sessions, and backup retention |

Measure Docker build peak memory separately from application runtime. Where on-server builds contend with traffic, build OCI images on a separate machine after the release is verified and deploy pinned images. Review database growth and reserve disk for backup creation, restoration, and Docker image layers.

Record idle and loaded `docker compose stats --no-stream`, host disk usage, database size, and response latency during verification. The current Compose files start only the application, database, proxy where needed, and a one-shot migration process.
