# BusinessOS progress checklist

Updated 23 November 2026. The initial source review covers 27 repositories. Native slices are in progress across customer operations, learning, logistics, events, construction, graphic design and accounting. The [test results](TEST_RESULTS.md) record the workflows verified locally.

Check a module off after its agreed workflows are implemented, tested end to end, and reviewed for release. Record the implementation reference, test result, and license evidence in the [feature register](FEATURE_PARITY.md), [test results](TEST_RESULTS.md), and [license register](LICENSE_REGISTER.md).

## Shared platform

- [x] Initialize the Next.js workspace and PostgreSQL migration runner.
- [x] Write registration, sign-in, sign-out, organization membership, session and audit code.
- [x] Add trial initialization and server-side module access checks.
- [x] Write local and Hostinger deployment, backup and recovery files.
- [x] Write workspace switching, email-bound invitation codes, owner-managed roles and branch creation.
- [x] Write plan seat and branch enforcement and local subscription checkout, renewal and cancellation simulation.
- [ ] Add MFA, account recovery, invitation delivery and member administration.
- [ ] Implement live billing, webhook reconciliation, invoices and operator pricing controls.
- [x] Write shared staff appointment booking with overlap prevention and status transitions.
- [x] Write SKU catalog, receipts, stock issues and a movement ledger.
- [x] Write sales invoice drafting, numbering and offline payment recording.
- [x] Write Accounting Practice attachment storage with engagement-scoped access, upload limits and download audit records.
- [ ] Extend inventory and scheduling, and implement the shared document, employee, notification and reporting engines.
- [x] Install dependencies, generate the lockfile and run the production builds and Chromium suite.
- [ ] Verify tenant isolation, permissions, expired trials, migrations, HTTPS, backup restoration and resource usage.

## Source modules

All 27 have an initial source mapping and a pinned revision. The milestones below show what remains before each can be checked off.

- [ ] **01 Physiotherapy ERP.** Patients, rehabilitation plans, sessions, progress and billing.
- [ ] **02 Fertility Clinic ERP.** Consultations, cycle scheduling, diagnostics and protected records.
- [ ] **03 Child Therapy ERP.** Guardian access, therapist assignments, session notes and progress reports.
- [ ] **04 Hotel ERP. In progress.** Room setup, reservations, check-in, checkout, cancellation, booking reports and linked lodging invoice drafts are written. Add multi-property support and tax and payment workflows.
- [ ] **05 Dental ERP.** Patient chart, appointments, treatments and billing.
- [ ] **06 CRM. In progress.** Contacts, companies, lead conversion, opportunity stages and tasks are written. Add custom pipelines and automation.
- [ ] **07 LMS. In progress.** Text courses, enrollment and progress are written. Add multimedia, assessments and certificates.
- [ ] **08 Gym. In progress.** Members, plans, manual payment recording, renewal and attendance reporting are written. Verify the end-to-end workflow and review remaining parity.
- [ ] **09 Construction ERP. In progress.** Projects, BOQ lines, exact estimates and CSV export are written. Add cost catalogs, takeoff, versioning and scheduling.
- [ ] **10 Fleet Operations. In progress.** Vehicles, driver profiles, exclusive assignments and dispatch transitions are written. Add maintenance, routing and tracking.
- [ ] **11 Driver Navigation. In progress.** Driver-only assignment view, ordered stop details and delivery confirmation are written. Add mapping, route guidance and permission-based location features.
- [ ] **12 GST Billing.** Quotations, invoices, tax handling, credit notes and exports.
- [ ] **13 Video Editor.** Media import, timeline, preview, rendering and export.
- [ ] **14 Graphic Design. In progress.** Canvas projects, editable text and rectangle layers, stacking, preview and PNG export are written. Add assets, templates and direct manipulation.
- [ ] **15 School ERP.** Classes, attendance, fees, exams and timetables.
- [ ] **16 Pharmacy ERP.** Medicine batches, expiry, purchasing, sales and stock traceability.
- [ ] **17 Hospital ERP.** OPD, admissions, beds, prescriptions and clinical billing.
- [ ] **18 Payments. In progress.** Subscription sandbox is written. Finish the YouPI-PG workflow review and implement a supported live provider adapter and reconciliation.
- [ ] **19 Coaching ERP. In progress.** Adult prospects, batch admission with capacity limits and attendance are written. Add fee, assessment and certificate workflows.
- [ ] **20 Optical ERP.** Prescriptions, lens and frame inventory, orders and billing.
- [ ] **21 Car Rental ERP. In progress.** Vehicle inventory, booking overlap checks, booked rates and pickup and return inspections are written. Add chauffeur scheduling, adjustments, payments and settlement.
- [ ] **22 Courier ERP. In progress.** Consignments, pickup, tracking history and delivery receipt are written. Add routing, public tracking and billing.
- [ ] **23 Event ERP. In progress.** Venues, capacity, bookings, event schedules and staff-recorded RSVPs are written. Add invitation delivery, vendors, budgets, tickets and check-in.
- [ ] **24 College ERP.** Admissions, faculty, academic records, exams and fees.
- [ ] **25 Pathology LIS.** Accession, samples, barcode workflow, validation, quality control and reports.
- [ ] **26 Jewellery ERP.** Metal rates, hallmarked inventory, making charges, karigar workflows and POS.
- [ ] **27 Accounting Practice ERP. In progress.** Client engagements, staff tasks, independent approval, completion references and restricted attachments are written. Add portal, billing links and filing-service integration where applicable.

## License and release review

- [x] Record the observed upstream license status for all 27 pinned revisions.
- [x] Use original BusinessOS code, database migrations and UI for the initial slices. Upstream repositories serve as workflow references.
- [ ] Record source and asset provenance for each module and review any potential overlap with upstream material.
- [ ] For proposed third-party reuse, verify the exact file and version terms or obtain written permission for the intended use. Record approval before including the material.
- [ ] Review the locked direct and transitive dependencies, deployment images, fonts, templates and media. Record notices, attribution and any source-sharing obligations that apply.
- [ ] Record approval for the intended hosted and distribution models before release. License review for the assembled product is open.
