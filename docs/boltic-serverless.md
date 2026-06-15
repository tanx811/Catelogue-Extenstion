# Boltic Serverless Usage

This project now has a serverless HTTP entrypoint at:

```text
serverless/boltic.js
```

The handler is intentionally portable because Boltic serverless public handler-shape documentation was not available during implementation. It supports the common Node.js serverless forms:

- `module.exports = async function(event, context)`
- `module.exports.handler = async function(event, context)`
- `module.exports.default = async function(event, context)`
- Express-like `(req, res)` handlers

## Deploy Settings

Use these settings in Boltic's serverless function screen:

| Setting | Value |
|---|---|
| Runtime | Node.js 20 |
| Entry file | `handler.js` |
| Handler | `handler` |
| Method | HTTP POST |
| Timeout | 30 seconds for validate/dry-run; longer for live ingest |

If Boltic asks for a handler string, use `handler.handler`. `index.handler` and `serverless/boltic.handler` also work as compatibility shims, but Boltic's Node.js docs list `handler.handler`.

The root `handler.js` file is self-contained. Boltic blueprint/code publish uploads only that handler file into `CodeOpts.Code`, so it cannot rely on local imports from `src/` or `serverless/`.

The deployed root URL renders a small browser UI for validation and dry-run payload generation. The JSON health endpoint is available at `/health`.

## Downloadable Prototype Extension

The root UI includes a **Download Prototype Extension** button. It generates a ZIP from the serverless handler itself, so it works without npm packages, Fynd OAuth, or a build step.

Demo flow:

1. Open the deployed Boltic serverless URL.
2. Click **Download Prototype Extension**.
3. Unzip `northwind-catalog-extension-prototype.zip`.
4. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
5. Select the unzipped `northwind-catalog-extension-prototype` folder.
6. Open the extension popup and run **Dry Run** or **Validate**.

The generated popup is configured to call the same deployed serverless origin for `/validate` and `/dry-run`.

Download routes:

| Route | Behavior |
|---|---|
| `GET /extension-package` or `GET ?download=package` | Returns JSON metadata with a base64 ZIP. Used by the UI. |
| `GET /download` or `GET ?download=zip` | Returns the ZIP directly. |

For large catalog loads, avoid sending all 60,000 SKUs in one request. Trigger the function in chunks, for example 500-1,000 rows per invocation. Serverless functions are not a good place to rely on local checkpoint files, so use chunk-level retry from the workflow/orchestrator.

## Environment Variables

Only required for live Fynd ingestion:

```text
FYND_COMPANY_ID=your-development-company-id
FYND_API_KEY=your-api-key
FYND_API_SECRET=your-api-secret
FYND_DOMAIN=https://api.fynd.com
```

Optional:

```text
FYND_PRODUCT_ENDPOINT=/service/platform/catalog/v1.0/company/<company_id>/products/
```

## Request Body

Send either an array of legacy rows directly or an object with `rows`.

```json
{
  "action": "dry-run",
  "rows": [
    {
      "Product Name": "Everyday Cotton Tee",
      "SKU": "NW-TSH-001",
      "Brand Name": "Northwind Apparel",
      "size variants": "S/M/L",
      "MRP": "₹1,299.00",
      "Image URL": "https://example.com/northwind/everyday-cotton-tee.jpg"
    }
  ]
}
```

Supported actions:

| Action | Behavior |
|---|---|
| `validate` | Normalizes rows and returns valid products plus invalid-row report. |
| `dry-run` or `preview` | Returns Fynd product payloads and a dry-run ingest summary. No Fynd API call is made. |
| `ingest` | Same as dry-run in the Boltic blueprint deployment. Use the repo CLI/FDK path for real Fynd API ingestion. |

## Example cURL

```bash
curl -X POST "$BOLTIC_FUNCTION_URL/dry-run" \
  -H "content-type: application/json" \
  --data @data/northwind_legacy_export.json
```

For live ingestion:

```bash
curl -X POST "$BOLTIC_FUNCTION_URL/ingest" \
  -H "content-type: application/json" \
  --data '{
    "live": true,
    "rows": [
      {
        "name": "Canvas Tote",
        "sku": "NW-ACC-010",
        "brand": "Northwind Apparel",
        "sizes": "One Size",
        "price": "₹699",
        "image": "https://example.com/northwind/canvas-tote.jpg"
      }
    ]
  }'
```

## Response Shape

```json
{
  "summary": {
    "total_rows": 1,
    "valid_products": 1,
    "invalid_rows": 0,
    "warning_count": 0
  },
  "invalidRows": [],
  "warnings": [],
  "payloads": [],
  "ingestion": {
    "dry_run": true,
    "summary": {
      "attempted": 1,
      "succeeded": 1,
      "failed": 0,
      "skipped": 0
    },
    "results": []
  }
}
```

## Operational Notes

- Keep `live` false until the validation report is clean and payloads are reviewed.
- Use chunked invocation for full-catalog loads.
- Store function logs and API responses as evidence for the case-study submission.
- Do not put API keys in the request body; keep them in Boltic environment variables.
