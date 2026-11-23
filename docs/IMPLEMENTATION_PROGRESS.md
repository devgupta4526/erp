# Implementation progress

Use the [progress checklist](PROGRESS_CHECKLIST.md) to track individual modules and release criteria.

| Work | Status | Current scope |
|---|---|---|
| Source discovery | IN_PROGRESS | All 27 revisions pinned and indexed, initial mappings completed and gym workflows sampled. Deeper source and license review remains open. |
| App and database foundation | IMPLEMENTED | Next.js application, PostgreSQL pool, migrations and database connectivity endpoint. |
| Identity and tenancy | IMPLEMENTED | Organization registration, login, logout, password hashing, session expiry, membership lookup and auth audit events. MFA, account recovery, verification and member administration remain open. |
| Workspace administration | IN_PROGRESS | Branches, account-bound invitation codes with revocation, workspace switching, owner-managed member roles, and recent audit history. Invitation delivery and account lifecycle remain open. |
| Plans and access | IN_PROGRESS | Four plans, Starter trial, module access checks, branch and seat limits, and owner-only local checkout and cancellation simulation. Live payments, invoicing and operator pricing controls remain open. |
| CRM | IN_PROGRESS | Contacts, companies, lead conversion, fixed opportunity stages and due-dated tasks. Custom pipelines, automation and existing-contact linking remain open. |
| Gym | IN_PROGRESS | Member registration, configurable plans, manual receipts and renewals, check-in and attendance reports. Provider integration and verification remain open. |
| Hotel | IN_PROGRESS | Rooms, reservations, overlap checks, check-in/out, cancellation, booking-based reports and lodging invoice drafts generated from completed stays. Multi-property support and tax handling remain open. |
| Scheduling | IN_PROGRESS | Staff appointments with overlap checks, day view, cancellation and completion. Domain-specific calendars and notifications remain open. |
| Inventory | IN_PROGRESS | SKU catalog, stock receipts and issues and a movement ledger. Warehouse, valuation and batch tracking remain open. |
| Sales invoices | IN_PROGRESS | Drafts, line items, sequential issuance, balances and manual receipts. Tax, credit notes, exports and provider settlement remain open. |
| Courier | IN_PROGRESS | Consignments with tracking references, pickup, transit, delivery recipient and tracking history. Routing, public tracking and billing remain open. |
| Learning | IN_PROGRESS | Published text courses, enrollment and ordered lesson completion. Assessments, certificates and multimedia remain open. |
| Car Rental | IN_PROGRESS | Vehicle registration, date-based availability and reservations, booked-rate quotes, and pickup and return inspections. Chauffeurs, adjustments and settlement remain open. |
| Events | IN_PROGRESS | Venue availability, event capacity, schedules, guest lists and staff-recorded RSVPs. Invitation delivery, budgeting and tickets remain open. |
| Construction | IN_PROGRESS | Costed BOQ lines, estimate totals and authenticated CSV export. Takeoff, cost catalogs and estimate versioning remain open. |
| Accounting Practice | IN_PROGRESS | CRM-linked engagements, owner/admin approval separate from the assignee, checklist tasks, completion references and restricted PDF or text attachments. Client portal, billing links, retention controls and file security verification remain open. |
| Fleet and Driver Workspace | IN_PROGRESS | Vehicle registration, staff profiles, exclusive assignments, driver-only stop lists and delivery confirmation. Mapping, live location and maintenance remain open. |
| Coaching | IN_PROGRESS | Adult prospect and batch management, capacity-limited admissions and attendance. Fees, tests and certificates remain open. |
| Graphic Design | IN_PROGRESS | Saved canvas projects, text and rectangle layers, stacking, preview and PNG download. Assets, templates and direct manipulation remain open. |
| Other industry modules | NOT_STARTED | See the feature register for scope. |
| Deployment packaging | IMPLEMENTED | Container and Compose files, reverse proxy, operations scripts and documentation. |
| Verification | NOT_STARTED | Initial Playwright scenarios, additional rental and practice cases, and Gym verification cases are written. Execution is deferred. |
