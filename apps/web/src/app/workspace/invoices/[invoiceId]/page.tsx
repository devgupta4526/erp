import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { readInvoice } from "@/server/invoices";
import { saveInvoice } from "../actions";
import { invoiceMessage, money } from "../presentation";

export default async function InvoicePage({ params, searchParams }: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { invoiceId } = await params;
  const invoice = await readInvoice(session.organizationId, invoiceId);
  if (!invoice) notFound();
  const result = invoiceMessage((await searchParams).result);
  const balance = BigInt(invoice.total) - BigInt(invoice.paid);
  const canWrite = session.role !== "member";
  const save = saveInvoice.bind(null, session.organizationId, invoice.id);
  const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

  return <>
    <header className="page-heading">
      <Link href="/workspace/invoices">Sales invoices</Link>
      <h1>{invoice.number ? `Invoice ${invoice.number}` : "Draft invoice"}</h1>
      <p>{invoice.customer_name}{invoice.issued_at ? ` · Issued ${date.format(invoice.issued_at)} UTC` : ""}</p>
    </header>
    {result && <p className="notice" role="status">{result}</p>}
    <section className="panel">
      <h2>Line items</h2>
      {invoice.lines.length ? <div className="table-scroll"><table aria-label="Invoice line items">
        <thead><tr><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th>
          {!invoice.number && canWrite && <th scope="col">Actions</th>}</tr></thead>
        <tbody>{invoice.lines.map((line) => <tr key={line.id}>
          <th scope="row">{line.description}</th><td>{line.quantity}</td><td>{money(line.unit_minor, invoice.currency)}</td>
          {!invoice.number && canWrite && <td><form action={save}>
            <input type="hidden" name="operation" value="remove" />
            <input type="hidden" name="lineId" value={line.id} />
            <button type="submit">Remove</button>
          </form></td>}
        </tr>)}</tbody>
      </table></div> : <p>No line items.</p>}
      <dl className="details">
        <div><dt>Total</dt><dd>{money(invoice.total, invoice.currency)}</dd></div>
        {invoice.number && <><div><dt>Received</dt><dd>{money(invoice.paid, invoice.currency)}</dd></div>
          <div><dt>Balance due</dt><dd>{money(balance.toString(), invoice.currency)}</dd></div></>}
      </dl>
      {!invoice.number && canWrite && <>
        <form className="fields" action={save}>
          <input type="hidden" name="operation" value="line" />
          <label>Description<input name="description" maxLength={160} required /></label>
          <label>Quantity<input name="quantity" type="number" min="1" max="10000" step="1" required /></label>
          <label>Unit price ({invoice.currency})<input name="price" inputMode="decimal" required /></label>
          <button type="submit">Add line</button>
        </form>
        {invoice.lines.length > 0 && <form action={save}>
          <input type="hidden" name="operation" value="issue" />
          <button type="submit">Issue and lock invoice</button>
        </form>}
      </>}
    </section>
    {invoice.number && <section className="panel">
      <h2>Payment receipts</h2>
      {canWrite && balance > 0n && <form className="fields" action={save}>
        <input type="hidden" name="operation" value="receipt" />
        <label>Payment reference<input name="reference" maxLength={100} required /></label>
        <label>Amount received ({invoice.currency})<input name="amount" inputMode="decimal" required /></label>
        <button type="submit">Record payment received</button>
      </form>}
      {invoice.receipts.length ? <ul>{invoice.receipts.map((receipt) => <li key={receipt.reference}>
        {receipt.reference} · {money(receipt.amount_minor, invoice.currency)} · {date.format(new Date(receipt.received_at))} UTC
      </li>)}</ul> : <p>No payments recorded.</p>}
    </section>}
  </>;
}
