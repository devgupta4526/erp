CREATE TABLE physio_packages (
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  sessions smallint NOT NULL CHECK (sessions BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, patient_id, id),
  UNIQUE (organization_id, invoice_id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES physio_patients (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES sales_invoices (organization_id, id)
);

ALTER TABLE physio_visits ADD COLUMN package_id uuid,
  ADD FOREIGN KEY (organization_id, patient_id, package_id) REFERENCES physio_packages (organization_id, patient_id, id),
  ADD CONSTRAINT physio_prepaid_or_single_invoice CHECK (package_id IS NULL OR (status = 'completed' AND invoice_id IS NULL));
CREATE INDEX physio_package_punches ON physio_visits (organization_id, patient_id, package_id) WHERE package_id IS NOT NULL;
