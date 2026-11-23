export const messages: Record<string, string> = {
  done: "Invoice updated.",
  forbidden: "Your workspace, role, or subscription does not allow this action.",
  invalid: "Check the invoice details and try again.",
  locked: "Issued invoices cannot be edited.",
  empty: "Add at least one line before issuing the invoice.",
  limit: "An invoice can contain up to 100 lines.",
  draft: "Issue the invoice before recording a receipt.",
  over: "The amount exceeds the remaining balance.",
  duplicate: "This receipt reference is already in use.",
};

export function invoiceMessage(result?: string) {
  return result && Object.hasOwn(messages, result) ? messages[result] : undefined;
}

export function money(minor: string | number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code" }).format(Number(minor) / 100);
}
