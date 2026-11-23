import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const directory = new URL("../apps/web/db/migrations/", import.meta.url);
const files = (await readdir(directory)).filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort();
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(85610001)");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await client.query("SELECT filename, checksum FROM schema_migrations");
  const applied = new Map(rows.map(({ filename, checksum }) => [filename, checksum]));
  const migrations = await Promise.all(files.map(async (file) => {
    const sql = await readFile(new URL(file, directory), "utf8");
    const checksum = createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
    return { file, sql, checksum };
  }));
  const available = new Map(migrations.map(({ file, checksum }) => [file, checksum]));
  for (const [file, checksum] of applied) {
    if (available.get(file) !== checksum) throw new Error(`Applied migration changed or is missing: ${file}`);
  }
  for (const { file, sql, checksum } of migrations) {
    if (applied.has(file)) continue;
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [file, checksum]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
