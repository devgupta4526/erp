CREATE TABLE hotel_invoice_links (
  organization_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  PRIMARY KEY (organization_id, reservation_id),
  UNIQUE (organization_id, invoice_id),
  FOREIGN KEY (organization_id, reservation_id) REFERENCES hotel_reservations(organization_id, id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES sales_invoices(organization_id, id)
);
