# Part A Technical Note

## Build Summary

The migration code is packaged as a private-extension-compatible Node.js project. It can run as a CLI for local validation and dry-run payload generation, and it exposes `registerNorthwindCatalogRoutes(fdkExtension)` so the same logic can be mounted inside the FDK boilerplate.

## Transformer Behavior

- Normalizes inconsistent product field names such as `Product Name`, `name`, `title`, `SKU`, `sku_code`, and `seller_identifier`.
- Parses prices with currency symbols and stray characters, including `₹1,299.00`, `Rs. 1,399`, `INR 2,499/-`, and `$24.99`.
- Splits jammed size fields such as `S/M/L`, `32,34,36`, and `S | M | L | XL`.
- Requires name, SKU, size, positive price, and absolute `http` or `https` image URL.
- Reports duplicate SKUs, missing mandatory fields, malformed rows, invalid prices, and invalid image URLs.
- Produces Fynd-oriented payloads mapped to `Others` category and `Supplementary` template.

## Edge Cases Covered

| Edge case | Sample row | Behavior |
|---|---:|---|
| Duplicate SKU | 2 | Rejected with `DUPLICATE_SKU` |
| Missing SKU | 3 | Rejected with `MISSING_SKU` |
| Missing name | 4 | Rejected with `MISSING_NAME` |
| Bad image URL | 6 | Rejected with `INVALID_IMAGE_URL` |
| Malformed row | 7 | Rejected with `MALFORMED_ROW` |
| Bad price | 8 | Rejected with `INVALID_PRICE` |
| Missing size | 11 | Rejected with `MISSING_SIZE` |

## Ingestion Design

The live ingestion command uses the Fynd JavaScript SDK when credentials are available. It creates a `PlatformClient`, obtains a client-credentials token when the SDK supports it, and creates products through `catalog.createProduct({ body })`. If that helper is unavailable, it falls back to `platformClient.request(...)`.

The runner is checkpointed by SKU. Successful products are skipped on re-run, failed products are retried, and the request cadence defaults to 100 requests/minute.

## Could Not Complete Locally

I could not create the Fynd Partners account, development company, private extension registration, or real product-ingestion evidence from this machine because those steps require the candidate's authenticated Fynd access. Once credentials are available, run `npm run ingest`, capture screenshots/API responses, and add them to `evidence/`.

