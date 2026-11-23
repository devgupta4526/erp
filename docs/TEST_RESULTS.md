# Test results

## 23 November 2026

- The Next.js production build and Linux Docker image build passed. The npm production dependency audit reported zero known vulnerabilities.
- All 25 migrations applied to a fresh PostgreSQL 17 database. A repeat run exited successfully without applying any migration again.
- Local Docker Compose reported the database and app healthy, and the migration container exited successfully. `GET /api/health` returned HTTP 200 with `{"status":"ok"}`.
- All seven Playwright Chromium scenarios passed. They cover authentication, contact isolation, invitations, branch limits, Gym payment and attendance, invoice installments, scheduling conflicts, rental overlap, and private Accounting Practice attachments and separation of approval.
- A Chromium smoke check rendered all 20 workspace navigation routes for a newly registered owner.
- A separate Gym smoke check expired a synthetic trial with the registration form open. The app rejected the stale submission, hid the roster, and stored no new member.
- The backup and restore scripts restored the local test database into a separate database with 59 public tables, 25 migration records, and 19 test organizations.
- The Hostinger Compose configuration passed `docker compose config`. The Render Blueprint passed Render CLI and schema validation. Its start command ran migrations and returned HTTP 200 from `/api/health` on port 10000 in a local container.
- A public deployment, production HTTPS, resource usage, legacy migration fixtures, and the remaining module workflows still require verification.

To repeat the browser verification, install dependencies and Chromium, apply migrations to a disposable test database, and start BusinessOS against that database. Set `BUSINESSOS_E2E_URL` to the running loopback origin and run `npm run test:e2e`. The scenarios create test organizations and records.
