# Northwind Apparel Migration and Go-Live Plan

## Assumptions

- Scope includes catalog migration, Store OS configuration, POS readiness, basic D2C catalog continuity, UAT, pilot, and launch support.
- Northwind has about 40 stores and a small D2C site.
- The first launch can proceed with an MVP if store-credit-on-exchange is not a legal, finance, or operational blocker.
- The catalog export contains about 60,000 SKUs and one normalized product create request is required per SKU/product.
- The catalog API rate limit is 100 requests/minute. The transformer can process 50 products/second locally, so the API is the bottleneck.

## B1. Migration Approach and Scoping

### Phase 0: Kickoff and Access, Days 1-2

- Confirm executive sponsor, Northwind project lead, Fynd TIM owner, engineering owner, store ops owner, finance owner, and escalation path.
- Collect Partner/development company access, API credentials, legacy export samples, tax/HSN expectations, image hosting rules, category/template decisions, store list, user roles, and launch blackout dates.
- Define acceptance criteria for catalog, POS, returns/exchanges, reporting, store operations, and D2C continuity.

Go-live meaning: project scope is baselined, owners are named, access is available, and launch risk log is open.

### Phase 1: Data Profiling and Solution Design, Days 2-6

- Profile the export for missing SKUs, duplicate SKUs, missing names, invalid prices, missing sizes, bad images, unsupported attributes, and category/template gaps.
- Agree on canonical field mapping, validation rules, rejection report format, and re-run strategy.
- Confirm whether `Others` category and `Supplementary` template are acceptable for launch or only for the case-study/development run.
- Scope store-credit-on-exchange gap with store ops and finance.

Go-live meaning: Northwind has signed off on mapping rules, mandatory fields, and the first-pass MVP.

### Phase 2: Build and Dry Runs, Days 5-15

- Build the transformer as a private extension with validation, reporting, dry-run payload output, checkpointed ingestion, and API error capture.
- Run dry-runs on progressively larger samples: 50 rows, 1,000 rows, then a full export.
- Return invalid-row reports to Northwind with required fixes and owner/date.
- Confirm platform validation blockers such as tax, HSN, description, template, image, or attribute requirements.

Go-live meaning: a repeatable migration run exists, catalog defects are visible, and the first successful products are created in the development company.

### Phase 3: System Configuration and Store Readiness, Days 12-28

- Configure stores, roles, catalog visibility, POS settings, payment tenders, return/exchange SOPs, receipts, and reporting.
- Complete Store OS workflow testing for sell, return, exchange, price lookup, item search, and offline/contingency handling if applicable.
- Prepare store training and helpdesk paths.

Go-live meaning: the platform is configured for a controlled pilot, with store users able to execute the supported workflows.

### Phase 4: UAT, Pilot, and Cutover Prep, Days 24-38

- Run UAT with Northwind store ops, finance, merchandising, and D2C stakeholders.
- Pilot 2-3 stores or a controlled sandbox store flow using a representative product and transaction set.
- Freeze catalog changes before final migration except for approved critical fixes.
- Prepare cutover checklist, rollback criteria, support rota, and launch communications.

Go-live meaning: Northwind signs off on MVP workflows and open issues are either closed, accepted, or explicitly moved to phase two.

### Phase 5: Launch and Hypercare, Days 39-45

- Run final catalog ingestion from a frozen export.
- Validate product counts, sample SKUs, images, prices, variants, and store visibility.
- Enable stores in waves if risk is high; otherwise launch all stores with an on-call bridge.
- Run daily hypercare for the first week, with defect triage and business-priority fixes.

Go-live meaning: stores transact on Store OS for the agreed MVP, critical defects have an owner, and Northwind has a support/escalation path.

## Store-Credit-on-Exchange Gap

Store credit on exchange should not be hidden or treated as a last-minute exception. I would handle it as a formal product gap with a business decision:

- If exchange credit is low-volume or can be managed operationally, launch MVP with a controlled workaround: issue a supported manual credit note, coupon, gift-card-like instrument, or finance-approved ledger entry, then reconcile daily.
- If exchange credit is high-volume or legally/accounting critical, it becomes a launch blocker for affected stores unless those stores are excluded from phase one.
- In parallel, raise a product/engineering request for native support, including expected transaction volume, accounting impact, required audit trail, and target phase-two timeline.

Client message: Store OS does not support native store-credit-on-exchange in the launch scope. We can either launch with a controlled manual workaround and reconcile daily, or defer stores/workflows where this is business-critical. I would recommend launching core POS and catalog first only if finance and store ops accept the workaround in writing.

## MVP for 30-45 Days

The 30-45 day MVP should include:

- Clean catalog ingestion for launch-approved SKUs.
- Product search, size variants, images, and price visibility.
- Core sale, return, and exchange workflows supported by Store OS.
- Store user setup, training, and launch support.
- Manual workaround for store-credit-on-exchange if accepted.
- Clear invalid-SKU backlog for phase two.

Phase two should include native or semi-automated store credit, long-tail data cleanup, richer category/template mapping, advanced reporting, and any non-critical D2C enhancements.

## B2. Analytical Sizing

Given:

- Catalog size: 60,000 SKUs/products.
- Transformer capacity: 50 products/second.
- API rate limit: 100 requests/minute.
- Assumption: one product create request per SKU/product.

Local transform time:

- 60,000 / 50 = 1,200 seconds = 20 minutes.

API-limited ingest time:

- 60,000 / 100 = 600 minutes = 10 hours.

The rate limit dominates. With retries, validation overhead, token refresh, API latency, and spot checks, I would plan for an 11-12 hour full run. If variants, inventory, price books, or images require separate API calls, the time multiplies by the number of requests per SKU.

Run design:

- Pre-validate the full file before calling Fynd.
- Use a checkpoint keyed by SKU so successful products are skipped on retry.
- Rate-limit below the hard ceiling, for example 95-100 requests/minute.
- Capture every API response and failure reason.
- Make the operation idempotent where possible: upsert if Fynd supports it, otherwise detect existing SKU before create.
- Chunk the file into batches, for example 1,000 SKUs per batch, with a summary after each batch.
- Retry transient 429/5xx errors with backoff, but do not retry deterministic validation errors.
- Reconcile counts after each run: source valid count, attempted count, success count, failure count, and product count in Fynd.

## B3. Client Kickoff Email

Subject: Northwind x Fynd Store OS kickoff: catalog migration, launch scope, and next steps

Hi [Project Lead],

Thanks again for partnering with us on the Store OS rollout. I will be owning the implementation path from Fynd's side and wanted to align on how we will take Northwind from the legacy catalog export to launch.

For the first 30-45 days, I propose we focus on a launchable MVP: clean catalog migration, core Store OS configuration, store user readiness, sale/return/exchange workflows that are supported today, UAT, and launch support. The first milestone is data profiling. We will need your latest product export, image URL rules, tax/HSN expectations, store list, user roles, return/exchange policies, and a contact from merchandising, finance, store ops, and D2C.

One important gap to flag early: the current Store OS launch scope does not support a native store-credit-on-exchange workflow out of the box. I do not want this to surprise the store teams late in UAT. My recommendation is that we assess transaction volume and finance requirements this week. If acceptable, we can launch with a documented manual workaround and daily reconciliation, while raising native support as a phase-two product request. If this is critical for certain stores, we should either defer those stores or treat the gap as a launch blocker for them.

By the end of week one, we should have confirmed field mappings, validation rules, the MVP scope, and the open risk list. I will share a simple tracker after kickoff showing owners, dates, risks, and decisions.

Could you please send the latest catalog export and confirm the Northwind owners for merchandising, finance, store ops, and D2C before our kickoff?

Best,
Rohit

## B3. Internal Engineering/Product Note

Subject: Store-credit-on-exchange gap for Northwind Store OS launch

Team,

Northwind's legacy flow supports issuing store credit during exchange. Store OS does not appear to support this natively in the current launch scope. This may affect go-live because exchange credit touches store operations, customer experience, finance reconciliation, and auditability.

Ask: Can we confirm whether any existing tender, coupon, credit note, or gift-card-like capability can be used as a controlled workaround? If not, I would like product/engineering input on effort, dependencies, and whether this can be prioritized for phase two.

Business context: Northwind has about 40 stores and sales has committed to a 30-45 day go-live. I am proposing the MVP launches only if Northwind accepts a documented workaround and finance signs off on reconciliation. If credit-on-exchange volume is high or compliance-critical, I will position it as a launch blocker for affected stores.

Needed this week: product feasibility, implementation estimate, workaround recommendation, and any known constraints.

## B4. Top Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Catalog data quality issues | Products fail validation or launch with wrong price/image/variant data. | Profile early, send invalid-row reports, freeze final export, run full dry-run before final ingest, reconcile counts. |
| API rate limits and ingestion interruptions | Full ingest misses launch window or creates partial catalog. | Use rate limiting, checkpointing, chunked runs, retries for transient errors, and count reconciliation after each batch. |
| Store-credit-on-exchange gap | UAT failure, store confusion, finance reconciliation risk. | Decide workaround vs phase-two request early, get finance/store ops sign-off, exclude affected stores if needed. |
| Store readiness and training gaps | Stores cannot transact confidently on day one. | Pilot representative stores, provide SOPs, train champions, run launch bridge and hypercare. |
| Platform validation blockers | HSN/tax/template/image requirements block product creation. | Test against development company early, document platform errors, agree required source-data fixes, escalate blockers immediately. |

## Day-40 QA Issue: 15% of SKUs Affected

I would not wait for Monday and hope the issue is small. I would run the incident like a launch-risk triage:

1. Freeze further catalog changes and stop any non-essential migration runs.
2. Quantify the issue: affected SKU count, categories, stores, revenue importance, and whether the issue is price, image, variant, tax, or discoverability.
3. Classify severity. Wrong price/tax/variant availability is launch-critical; cosmetic description issues may be phaseable.
4. Identify root cause in the source export, mapping logic, or Fynd validation.
5. Create a fix path: correct source data, patch transformer, rerun only affected SKUs through checkpoint/upsert flow, then reconcile counts.
6. Notify internal stakeholders immediately: implementation lead, engineering, product if platform behavior is involved, QA, support, and sales/account owner.
7. Notify Northwind with facts, not drama: what we found, impact, fix plan, decision point, and any risk to Monday.
8. Decide go/no-go by severity and SKU importance. If affected SKUs are business-critical and not fixed by cutover checkpoint, recommend delaying launch or launching a reduced catalog/store set.
9. After fix, run targeted regression plus sample checks from Northwind merchandising and store ops.
10. Document the incident and add a post-launch guardrail so the same data class is caught earlier next time.

