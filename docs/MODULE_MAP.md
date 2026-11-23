# Module map

| Domain group | Native modules | Shared dependencies |
|---|---|---|
| Customer operations | CRM | Identity, subscriptions, audit |
| Fitness | Gym | Identity, subscriptions, audit, future billing |
| Clinical operations | Physiotherapy, fertility, child therapy, dental, hospital, pathology, pharmacy, optical | Scheduling, billing, restricted documents, domain-specific access |
| Education | LMS, school, coaching, college | Identity, organizational roles, scheduling, billing |
| Hospitality | Hotel | Guest records, billing, property-specific availability |
| Logistics | Fleet, driver navigation, car rental, courier | Dispatch, assignments, location permissions, billing |
| Retail and finance | GST billing, jewellery, accounting practice, experimental UPI workflow research | Finance, inventory, documents, payments |
| Projects | Construction, events | Projects, costs, vendors, scheduling |
| Creative | Graphic design, video editor | Private assets, quotas, jobs, export |

The CRM directory and gym attendance slice are linked from the workspace. See the [feature parity register](FEATURE_PARITY.md) for all 27 source mappings.
