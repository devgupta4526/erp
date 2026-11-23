import "server-only";
import { Pool, type PoolClient } from "pg";

const runtime = globalThis as typeof globalThis & { businessosPool?: Pool };

export const pool = runtime.businessosPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 3000,
  statement_timeout: 10000,
});

if (!runtime.businessosPool) {
  pool.on("error", (error) => {
    console.error("Idle PostgreSQL connection failed", "code" in error ? error.code : error.name);
  });
  runtime.businessosPool = pool;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let connectionError: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      connectionError = new Error("PostgreSQL rollback failed");
    }
    throw error;
  } finally {
    client.release(connectionError);
  }
}
