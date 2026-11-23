import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { createProduct, inventoryPageSize, readInventory, recordMovement } from "@/server/inventory";

export const metadata = { title: "Inventory" };

const feedback: Record<string, string> = {
  "product-created": "Product added.",
  "movement-recorded": "Stock movement recorded.",
  "invalid-product": "Enter a product name and an SKU made of letters, numbers, periods, underscores or hyphens.",
  "duplicate-sku": "That SKU is already in use.",
  "invalid-movement": "Enter a valid product, quantity and reference.",
  "duplicate-reference": "A movement already uses that reference for this product.",
  "insufficient-stock": "There is insufficient stock for this issue.",
  "stock-limit": "This receipt would exceed the stock limit of 1 billion units.",
  forbidden: "You do not have permission to manage inventory.",
  "workspace-changed": "Your active workspace changed. Review the workspace before submitting again.",
};

const pageLimit = 10000;
const quantityFormatter = new Intl.NumberFormat("en");
const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function parsePage(value: string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= pageLimit ? parsed : 1;
}

function inventoryUrl(products: number, movements: number, result?: string) {
  const search = new URLSearchParams({ products: String(products), movements: String(movements) });
  if (result) search.set("result", result);
  return `/workspace/inventory?${search}`;
}

async function changeInventory(organizationId: string, form: FormData) {
  "use server";
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.organizationId !== organizationId) redirect(inventoryUrl(1, 1, "workspace-changed"));
  const field = (name: string) => String(form.get(name) ?? "");
  const action = field("action");
  const products = parsePage(field("products"));

  if (action === "product") {
    const result = await createProduct(organizationId, { sku: field("sku"), name: field("name") });
    redirect(inventoryUrl(products, parsePage(field("movements")), result));
  }

  if (action === "movement") {
    const result = await recordMovement(organizationId, {
      productId: field("productId"),
      kind: field("kind"),
      quantity: field("quantity"),
      reference: field("reference"),
    });
    redirect(inventoryUrl(products, result === "movement-recorded" ? 1 : parsePage(field("movements")), result));
  }

  redirect(inventoryUrl(products, 1, "invalid-movement"));
}

function Pagination({ current, hasMore, href, label }: {
  current: number;
  hasMore: boolean;
  href: (page: number) => string;
  label: string;
}) {
  const nextPage = hasMore && current < pageLimit;
  if (current === 1 && !nextPage) return null;
  return <nav className="pagination" aria-label={label}>
    {current > 1 && <Link href={href(current - 1)}>Previous</Link>}
    <span>Page {current}</span>
    {nextPage && <Link href={href(current + 1)}>Next</Link>}
  </nav>;
}

export default async function Inventory({ searchParams }: {
  searchParams: Promise<{ products?: string; movements?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const productsPage = parsePage(params.products);
  const movementsPage = parsePage(params.movements);
  const inventory = await readInventory(session.organizationId, productsPage, movementsPage);
  const mutate = changeInventory.bind(null, session.organizationId);
  const message = params.result && Object.hasOwn(feedback, params.result) ? feedback[params.result] : undefined;
  const success = params.result === "product-created" || params.result === "movement-recorded";

  return <>
    <header className="page-heading"><h1>Inventory</h1><p>Manage products and track stock receipts and issues in whole units.</p></header>
    {!inventory.allowed ? <p className="notice">Your workspace subscription does not currently include inventory.</p> : <>
      {message && <p className={success ? "notice" : "notice error"} role={success ? "status" : "alert"}>{message}</p>}
      {inventory.can_write && <section className="panel">
        <h2>Add product</h2>
        <form className="fields contact-form" action={mutate}>
          <input type="hidden" name="action" value="product" />
          <input type="hidden" name="products" value={productsPage} />
          <input type="hidden" name="movements" value={movementsPage} />
          <label>SKU<input name="sku" maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" required /></label>
          <label>Product name<input name="name" maxLength={120} required /></label>
          <button type="submit">Add product</button>
        </form>
      </section>}
      <section className="panel" id="products">
        <h2>Products</h2>
        {inventory.products.length ? <div className="table-scroll"><table aria-label="Inventory products">
          <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">On hand</th>{inventory.can_write && <th scope="col">Action</th>}</tr></thead>
          <tbody>{inventory.products.slice(0, inventoryPageSize).map((product) => <tr key={product.id}>
            <th scope="row">{product.name}</th><td>{product.sku}</td><td>{quantityFormatter.format(product.on_hand)}</td>
            {inventory.can_write && <td><details>
              <summary aria-label={`Adjust stock for ${product.name}`}>Adjust stock</summary>
              <form className="fields" action={mutate}>
                <input type="hidden" name="action" value="movement" />
                <input type="hidden" name="productId" value={product.id} />
                <input type="hidden" name="products" value={productsPage} />
                <input type="hidden" name="movements" value={movementsPage} />
                <label>Movement<select name="kind"><option value="receipt">Receipt</option><option value="issue">Issue</option></select></label>
                <label>Quantity<input name="quantity" type="number" min={1} max={1000000000} step={1} required /></label>
                <label>Reference<input name="reference" maxLength={120} required /></label>
                <button type="submit">Record movement</button>
              </form>
            </details></td>}
          </tr>)}</tbody>
        </table></div> : <p>{productsPage === 1 ? "No products yet." : "No products on this page."}</p>}
        <Pagination current={productsPage} hasMore={inventory.products.length > inventoryPageSize}
          href={(page) => `${inventoryUrl(page, movementsPage)}#products`} label="Product pages" />
      </section>
      <section className="panel" id="movements">
        <h2>Stock movements</h2>
        {inventory.movements.length ? <div className="table-scroll"><table aria-label="Stock movements">
          <thead><tr><th scope="col">UTC date and time</th><th scope="col">Product</th><th scope="col">Type</th><th scope="col">Quantity</th><th scope="col">Balance</th><th scope="col">Reference</th></tr></thead>
          <tbody>{inventory.movements.slice(0, inventoryPageSize).map((movement) => <tr key={movement.id}>
            <td><time dateTime={movement.recorded_at}>{dateFormatter.format(new Date(movement.recorded_at))}</time></td>
            <th scope="row">{movement.product_name} ({movement.sku})</th>
            <td>{movement.kind === "receipt" ? "Receipt" : "Issue"}</td>
            <td>{quantityFormatter.format(movement.quantity)}</td>
            <td>{quantityFormatter.format(movement.balance_after)}</td>
            <td>{movement.reference}</td>
          </tr>)}</tbody>
        </table></div> : <p>{movementsPage === 1 ? "No stock movements yet." : "No movements on this page."}</p>}
        <Pagination current={movementsPage} hasMore={inventory.movements.length > inventoryPageSize}
          href={(page) => `${inventoryUrl(productsPage, page)}#movements`} label="Stock movement pages" />
      </section>
    </>}
  </>;
}
