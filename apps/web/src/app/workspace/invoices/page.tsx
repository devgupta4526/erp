import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { invoiceCurrencies, listInvoices } from "@/server/invoices";
import { saveInvoice } from "./actions";
import { invoiceMessage, money } from "./presentation";

export const metadata = { title: "Sales invoices" };

export default async function Invoices({ searchParams }: { searchParams: Promise<{ page?: string; result?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const rawPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1;
  const { allowed, invoices } = await listInvoices(session.organizationId, page);
  const message = invoiceMessage(params.result);

  return <>
    <header className="page-heading"><h1>Sales invoices</h1><p>Track line items and payments received. Tax calculation is unavailable.</p></header>
    {!allowed ? <p className="notice">Your subscription does not currently include sales invoices.</p> : <>
      {message && <p className="notice" role="status">{message}</p>}
      {session.role !== "member" && <section className="panel">
        <h2>Start a draft</h2>
        <form className="fields" action={saveInvoice.bind(null, session.organizationId, null)}>
          <input type="hidden" name="operation" value="create" />
          <label>Customer name<input name="customerName" maxLength={120} required /></label>
          <label>Currency<select name="currency">{invoiceCurrencies.map((currency) =>
            <option key={currency} value={currency}>{currency}</option>,
          )}</select></label>
          <button type="submit">Create draft</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Invoice directory</h2>
        {invoices.length ? <div className="table-scroll"><table aria-label="Sales invoices">
          <thead><tr><th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Status</th></tr></thead>
          <tbody>{invoices.slice(0, 25).map((invoice) => <tr key={invoice.id}>
            <th scope="row"><Link href={`/workspace/invoices/${invoice.id}`}>{invoice.number ? `Invoice ${invoice.number}` : "Draft"}</Link></th>
            <td>{invoice.customer_name}</td><td>{money(invoice.total, invoice.currency)}</td>
            <td>{invoice.number ? (invoice.paid === invoice.total ? "Paid" : "Outstanding") : "Draft"}</td>
          </tr>)}</tbody>
        </table></div> : <p>No invoices on this page.</p>}
        {(page > 1 || (invoices.length > 25 && page < 10000)) && <nav className="pagination" aria-label="Invoice pages">
          {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
          <span>Page {page}</span>
          {invoices.length > 25 && page < 10000 && <Link href={`?page=${page + 1}`}>Next</Link>}
        </nav>}
      </section>
    </>}
  </>;
}
