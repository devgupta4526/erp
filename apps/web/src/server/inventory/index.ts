import "server-only";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

const maxStock = 1_000_000_000;
export const inventoryPageSize = 25;

const inventoryAccess = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'inventory'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;

type Product = { id: string; sku: string; name: string; on_hand: number };
type Movement = {
  id: string;
  sku: string;
  product_name: string;
  kind: "receipt" | "issue";
  quantity: number;
  balance_after: number;
  reference: string;
  recorded_at: string;
};

export async function readInventory(organizationId: string, productsPage: number, movementsPage: number) {
  const session = await requireMembership(organizationId);
  const { rows } = await pool.query<{ allowed: boolean; can_write: boolean; products: Product[]; movements: Movement[] }>(`
    WITH access AS (SELECT m.role ${inventoryAccess}),
    products AS (
      SELECT id, sku, name, on_hand FROM inventory_products
      WHERE organization_id = $1 AND EXISTS (SELECT 1 FROM access)
      ORDER BY sku LIMIT $5 OFFSET $3
    ), movements AS (
      SELECT x.id, p.sku, p.name AS product_name, x.kind, x.quantity, x.balance_after, x.reference, x.recorded_at
      FROM inventory_movements x
      JOIN inventory_products p ON p.organization_id = x.organization_id AND p.id = x.product_id
      WHERE x.organization_id = $1 AND EXISTS (SELECT 1 FROM access)
      ORDER BY x.recorded_at DESC, x.id DESC LIMIT $5 OFFSET $4
    )
    SELECT EXISTS(SELECT 1 FROM access) AS allowed,
      EXISTS(SELECT 1 FROM access WHERE role IN ('owner', 'admin')) AS can_write,
      COALESCE((SELECT json_agg(products ORDER BY sku) FROM products), '[]') AS products,
      COALESCE((SELECT json_agg(movements ORDER BY recorded_at DESC, id DESC) FROM movements), '[]') AS movements
  `, [session.organizationId, session.userId,
    (productsPage - 1) * inventoryPageSize, (movementsPage - 1) * inventoryPageSize, inventoryPageSize + 1]);
  return rows[0];
}

async function lockWriteAccess(client: PoolClient, scope: [string, string]) {
  const result = await client.query(`
    SELECT 1 ${inventoryAccess} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m
  `, scope);
  return !!result.rowCount;
}

export async function createProduct(organizationId: string, input: { sku: string; name: string }) {
  const session = await requireMembership(organizationId);
  const scope: [string, string] = [session.organizationId, session.userId];
  const sku = input.sku.trim().toUpperCase();
  const name = input.name.trim();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku) || !name || name.length > 120 || name.includes("\0")) {
    return "invalid-product";
  }

  return transaction(async (client) => {
    if (!(await lockWriteAccess(client, scope))) return "forbidden";
    const { rows } = await client.query<{ id: string }>(`
      INSERT INTO inventory_products (organization_id, sku, name)
      VALUES ($1, $2, $3) ON CONFLICT (organization_id, sku) DO NOTHING RETURNING id
    `, [scope[0], sku, name]);
    if (!rows[0]) return "duplicate-sku";
    await client.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, 'inventory.product.created', 'inventory_product', $3)
    `, [...scope, rows[0].id]);
    return "product-created";
  });
}

type StockInput = { productId: string; kind: string; quantity: string; reference: string };

export async function recordMovement(organizationId: string, input: StockInput) {
  const session = await requireMembership(organizationId);
  const scope: [string, string] = [session.organizationId, session.userId];
  const reference = input.reference.trim();
  const quantity = Number(input.quantity);
  const { productId, kind } = input;
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(productId) ||
      (kind !== "receipt" && kind !== "issue") ||
      !/^\d{1,10}$/.test(input.quantity) || quantity < 1 || quantity > maxStock ||
      !reference || reference.length > 120 || reference.includes("\0")) return "invalid-movement";

  return transaction(async (client) => {
    if (!(await lockWriteAccess(client, scope))) return "forbidden";
    const item = [scope[0], productId];
    const stock = await client.query<{ on_hand: number }>(`
      SELECT on_hand FROM inventory_products
      WHERE organization_id = $1 AND id = $2 FOR UPDATE
    `, item);
    if (!stock.rows[0]) return "invalid-movement";
    const known = await client.query(`
      SELECT 1 FROM inventory_movements
      WHERE organization_id = $1 AND product_id = $2 AND reference = $3
    `, [...item, reference]);
    if (known.rowCount) return "duplicate-reference";

    const balance = stock.rows[0].on_hand + (kind === "receipt" ? quantity : -quantity);
    if (balance < 0) return "insufficient-stock";
    if (balance > maxStock) return "stock-limit";

    const { rows } = await client.query<{ id: string }>(`
      INSERT INTO inventory_movements (organization_id, product_id, kind, quantity, balance_after, reference)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [...item, kind, quantity, balance, reference]);
    await client.query(`
      UPDATE inventory_products SET on_hand = $3 WHERE organization_id = $1 AND id = $2
    `, [...item, balance]);
    await client.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, 'inventory.movement.recorded', 'inventory_movement', $3)
    `, [...scope, rows[0].id]);
    return "movement-recorded";
  });
}
