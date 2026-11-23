# Render test deployment

The [Render Blueprint](../render.yaml) defines a free Node.js web service and a private PostgreSQL 17 database in Singapore. The app uses Render's HTTPS endpoint, listens on `PORT`, and gets `DATABASE_URL` from the database's internal connection string. Render checks `/api/health`, which queries PostgreSQL before returning success.

1. Push the repository to a private Git repository that the intended Render workspace can access.
2. In Render, create a Blueprint from that repository and review the proposed web service and database before applying it.
3. After the first deploy succeeds, open the web service URL and check `/api/health`. Register a test workspace and confirm that signing in, signing out, and saving a record work over HTTPS.

The start command applies pending migrations before starting the app. It also runs after restarts, and the migration runner skips migrations already recorded in PostgreSQL. Use the service's manual deploy action for later code changes.

Use synthetic records for this environment. Free Render PostgreSQL expires after 30 days and has no managed backups. [Render free instance limits](https://render.com/docs/free)
