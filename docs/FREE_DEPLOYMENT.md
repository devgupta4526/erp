# Free local development

The core stack uses Node.js and PostgreSQL. It can run on a local machine without infrastructure subscriptions. A publicly reachable VPS, domain renewal, and external services can incur costs.

## Lean local development after the deferred verification phase begins

Copy `.env.example` to `.env`. The default PostgreSQL URL targets localhost. If you already have PostgreSQL, provision a private development database and role, configure the URL, and use the Node commands below. A development PostgreSQL container is another option.

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db
```

Provide the variables from `.env` to your Node process. For example, in PowerShell using the sample local settings:

```powershell
$env:DATABASE_URL = 'postgresql://businessos:local_development_only@localhost:5432/businessos'
$env:APP_ORIGIN = 'http://localhost:3000'
$env:SECURE_COOKIES = 'false'
npm install
npm run migrate
npm run dev
```

Use the Compose app when you need a local production-mode demo. It builds the app and publishes it on the loopback interface.

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build --wait
```

Open `http://localhost:3000`. The demo profile uses development credentials and loopback ports.

To exercise subscription changes, set `BUSINESSOS_SANDBOX_BILLING=true` in the local application environment before starting it. The owner’s Billing page can then simulate checkout, renewal and cancellation. Sandbox actions require a loopback HTTP origin and never contact a payment provider.
