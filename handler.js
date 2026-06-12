"use strict";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization"
};

const HTML_HEADERS = {
  ...JSON_HEADERS,
  "content-type": "text/html; charset=utf-8"
};

const FIELD_ALIASES = {
  name: ["product name", "name", "title", "item_name", "product_title"],
  sku: ["sku", "sku_code", "item code", "seller_identifier", "item_code"],
  brand: ["brand", "brand name", "manufacturer"],
  sizes: ["size variants", "sizes", "available_sizes", "size", "variant_sizes"],
  price: ["price", "mrp", "selling_price", "list price", "list_price", "marked_price"],
  currency: ["currency", "currency_code"],
  imageUrl: ["image url", "image_url", "imageurl", "image", "primary_image"],
  description: ["description", "desc", "long_description"],
  color: ["color", "colour"],
  gender: ["gender"],
  department: ["department", "category"]
};

const DEFAULTS = {
  brand: "Northwind Apparel",
  department: "Apparel",
  categoryName: "Others",
  templateName: "Supplementary",
  currency: "INR"
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}

function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: HTML_HEADERS,
    body
  };
}

function sendExpressResponse(res, response) {
  if (!res) return response;

  const contentType = response.headers?.["content-type"] || "";

  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(response.statusCode);
    Object.entries(response.headers).forEach(([key, value]) => {
      if (typeof res.setHeader === "function") res.setHeader(key, value);
    });
    if (contentType.includes("json")) {
      return res.json(JSON.parse(response.body || "{}"));
    }
    if (typeof res.send === "function") return res.send(response.body);
    if (typeof res.end === "function") return res.end(response.body);
    return response;
  }

  if (typeof res.setHeader === "function") {
    Object.entries(response.headers).forEach(([key, value]) => res.setHeader(key, value));
  }

  if (typeof res.writeHead === "function") res.writeHead(response.statusCode);
  if (typeof res.end === "function") return res.end(response.body);
  return response;
}

function getHeader(headers = {}, name) {
  const target = name.toLowerCase();
  const match = Object.keys(headers).find((key) => key.toLowerCase() === target);
  return match ? headers[match] : undefined;
}

function getMethod(input = {}) {
  return (
    input.method ||
    input.httpMethod ||
    input.requestContext?.http?.method ||
    "POST"
  ).toUpperCase();
}

function getPath(input = {}) {
  const rawPath = input.path || input.rawPath || input.url || "/";
  try {
    return new URL(rawPath, "https://serverless.local").pathname;
  } catch (_error) {
    return "/";
  }
}

function parseQuery(input = {}) {
  if (input.queryStringParameters) return input.queryStringParameters;
  if (input.query) return input.query;
  try {
    return Object.fromEntries(new URL(input.url || "/", "https://serverless.local").searchParams);
  } catch (_error) {
    return {};
  }
}

function parseBody(input = {}) {
  if (input.body === undefined || input.body === null || input.body === "") return {};
  if (typeof input.body === "object" && !Buffer.isBuffer(input.body)) return input.body;

  const bodyText = input.isBase64Encoded
    ? Buffer.from(String(input.body), "base64").toString("utf8")
    : String(input.body);

  const contentType = getHeader(input.headers, "content-type") || "";
  if (
    !contentType.includes("json") &&
    !bodyText.trim().startsWith("{") &&
    !bodyText.trim().startsWith("[")
  ) {
    throw new Error("Request body must be JSON.");
  }

  return JSON.parse(bodyText);
}

function pickRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.rows)) return body.rows;
  if (Array.isArray(body.products)) return body.products;
  throw new Error("Body must be an array or contain a rows/products array.");
}

function resolveAction(path, body, query = {}) {
  const requested = body.action || body.mode || query.action || query.mode;
  if (requested) return String(requested).toLowerCase();
  if (path.endsWith("/validate")) return "validate";
  if (path.endsWith("/dry-run") || path.endsWith("/preview")) return "dry-run";
  if (path.endsWith("/ingest")) return "ingest";
  return "dry-run";
}

function normalizeKey(key) {
  return String(key).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compactString(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function lookup(row, aliases) {
  const normalized = new Map();
  Object.entries(row).forEach(([key, value]) => {
    normalized.set(normalizeKey(key), value);
  });

  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias));
    if (value !== undefined && value !== null && compactString(value) !== "") return value;
  }

  return undefined;
}

function normalizeSku(value) {
  return compactString(value).toUpperCase().replace(/\s+/g, "-");
}

function detectCurrency(raw, explicitCurrency) {
  const explicit = compactString(explicitCurrency).toUpperCase();
  if (explicit) return explicit;

  const text = compactString(raw);
  if (/₹|\bINR\b|\bRS\.?\b/i.test(text)) return "INR";
  if (/\$|\bUSD\b/i.test(text)) return "USD";
  if (/€|\bEUR\b/i.test(text)) return "EUR";
  return DEFAULTS.currency;
}

function parsePrice(raw, explicitCurrency) {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return { amount: Number(raw.toFixed(2)), currency: detectCurrency(raw, explicitCurrency) };
  }

  const text = compactString(raw);
  const match = text.match(/[0-9][0-9,]*(?:\.[0-9]+)?/);
  if (!match) return null;

  const amount = Number(match[0].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount: Number(amount.toFixed(2)), currency: detectCurrency(text, explicitCurrency) };
}

function canonicalSize(size) {
  const value = compactString(size);
  if (/^[a-z]{1,4}$/i.test(value)) return value.toUpperCase();
  return value;
}

function splitSizes(raw) {
  if (Array.isArray(raw)) return raw.map(canonicalSize).filter(Boolean);
  const text = compactString(raw);
  if (!text) return [];
  return text.split(/[\/,|;]+/).map(canonicalSize).filter(Boolean);
}

function validateImageUrl(raw) {
  const imageUrl = compactString(raw);
  if (!imageUrl) return false;

  try {
    const url = new URL(imageUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function slugify(...parts) {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function sizeSku(sku, size) {
  return `${sku}-${slugify(size).toUpperCase()}`;
}

function validationError(code, message, field) {
  return { code, message, field };
}

function renderWebPage() {
  const sampleRows = [
    {
      "Product Name": "Everyday Cotton Tee",
      SKU: "NW-TSH-001",
      "Brand Name": "Northwind Apparel",
      "size variants": "S/M/L",
      MRP: "INR 1299",
      "Image URL": "https://example.com/northwind/everyday-cotton-tee.jpg",
      Description: "Core cotton crew neck tee.",
      Color: "Navy"
    },
    {
      name: "Duplicate Tee",
      sku: "nw-tsh-001",
      brand: "Northwind Apparel",
      sizes: "XL",
      price: "Rs. 1399",
      image: "https://example.com/northwind/everyday-cotton-tee-xl.jpg"
    },
    {
      title: "Invalid Image Polo",
      sku_code: "NW-PLO-310",
      brand: "Northwind Apparel",
      size: "S/M",
      "list price": "INR 1899",
      image_url: "htp://bad url"
    }
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Northwind Catalog Tool</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17202a;
      --muted: #5d6673;
      --line: #d9dee7;
      --soft: #f6f8fb;
      --accent: #1264a3;
      --bad: #a83232;
      --good: #1f7a4d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--ink);
      background: #ffffff;
    }
    header {
      border-bottom: 1px solid var(--line);
      padding: 18px 24px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    main {
      display: grid;
      grid-template-columns: minmax(280px, 0.95fr) minmax(280px, 1.05fr);
      min-height: calc(100vh - 62px);
    }
    section {
      min-width: 0;
      padding: 20px 24px;
    }
    section + section {
      border-left: 1px solid var(--line);
      background: var(--soft);
    }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 12px;
    }
    button {
      border: 1px solid var(--line);
      background: #ffffff;
      color: var(--ink);
      min-height: 36px;
      padding: 0 12px;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
    }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #ffffff;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.68;
    }
    textarea, pre {
      width: 100%;
      min-height: 520px;
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.45;
      background: #ffffff;
      color: var(--ink);
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .status {
      min-height: 22px;
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 14px;
    }
    .status.good { color: var(--good); }
    .status.bad { color: var(--bad); }
    @media (max-width: 860px) {
      main { grid-template-columns: 1fr; }
      section + section {
        border-left: 0;
        border-top: 1px solid var(--line);
      }
      textarea, pre { min-height: 360px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Northwind Catalog Tool</h1>
  </header>
  <main>
    <section>
      <div class="toolbar">
        <button class="primary" data-action="dry-run">Dry Run</button>
        <button data-action="validate">Validate</button>
        <button id="sample" type="button">Sample</button>
        <button id="clear" type="button">Clear</button>
      </div>
      <textarea id="input" spellcheck="false" aria-label="Catalog JSON input"></textarea>
    </section>
    <section>
      <p id="status" class="status">Ready</p>
      <pre id="output" aria-live="polite">{}</pre>
    </section>
  </main>
  <script>
    const sampleRows = ${JSON.stringify(sampleRows, null, 2)};
    const input = document.getElementById("input");
    const output = document.getElementById("output");
    const status = document.getElementById("status");
    const buttons = Array.from(document.querySelectorAll("button[data-action]"));

    function setStatus(text, state) {
      status.textContent = text;
      status.className = "status" + (state ? " " + state : "");
    }

    function setBusy(isBusy) {
      buttons.forEach((button) => {
        button.disabled = isBusy;
      });
    }

    async function run(action) {
      setBusy(true);
      setStatus("Running " + action + "...");
      output.textContent = "{}";

      try {
        const parsed = JSON.parse(input.value);
        const body = Array.isArray(parsed) ? { action, rows: parsed } : { action, ...parsed };
        const response = await fetch(window.location.href, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await response.json();
        output.textContent = JSON.stringify(data, null, 2);
        setStatus(response.ok ? "Done" : "Request failed", response.ok ? "good" : "bad");
      } catch (error) {
        output.textContent = JSON.stringify({ error: error.message }, null, 2);
        setStatus("Invalid request", "bad");
      } finally {
        setBusy(false);
      }
    }

    document.getElementById("sample").addEventListener("click", () => {
      input.value = JSON.stringify(sampleRows, null, 2);
      output.textContent = "{}";
      setStatus("Ready");
    });

    document.getElementById("clear").addEventListener("click", () => {
      input.value = "";
      output.textContent = "{}";
      setStatus("Ready");
    });

    buttons.forEach((button) => {
      button.addEventListener("click", () => run(button.dataset.action));
    });

    input.value = JSON.stringify(sampleRows, null, 2);
  </script>
</body>
</html>`;
}

function normalizeRow(rawRow, index, seenSkus) {
  const sourceRow = index + 1;
  const errors = [];
  const warnings = [];

  if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
    return {
      source_row: sourceRow,
      raw: rawRow,
      errors: [
        validationError(
          "MALFORMED_ROW",
          "Row is not an object and cannot be mapped to catalog fields.",
          null
        )
      ],
      warnings
    };
  }

  const name = compactString(lookup(rawRow, FIELD_ALIASES.name));
  const sku = normalizeSku(lookup(rawRow, FIELD_ALIASES.sku));
  const brand = compactString(lookup(rawRow, FIELD_ALIASES.brand)) || DEFAULTS.brand;
  const sizes = splitSizes(lookup(rawRow, FIELD_ALIASES.sizes));
  const price = parsePrice(lookup(rawRow, FIELD_ALIASES.price), lookup(rawRow, FIELD_ALIASES.currency));
  const imageUrl = compactString(lookup(rawRow, FIELD_ALIASES.imageUrl));
  const description =
    compactString(lookup(rawRow, FIELD_ALIASES.description)) ||
    `${name || "Northwind product"} migrated from the legacy catalog export.`;
  const color = compactString(lookup(rawRow, FIELD_ALIASES.color));
  const gender = compactString(lookup(rawRow, FIELD_ALIASES.gender));
  const department = compactString(lookup(rawRow, FIELD_ALIASES.department)) || DEFAULTS.department;

  if (!name) errors.push(validationError("MISSING_NAME", "Product name/title is mandatory.", "name"));

  if (!sku) {
    errors.push(validationError("MISSING_SKU", "SKU/seller identifier is mandatory.", "sku"));
  } else if (seenSkus.has(sku)) {
    errors.push(
      validationError("DUPLICATE_SKU", `SKU ${sku} already appeared on row ${seenSkus.get(sku)}.`, "sku")
    );
  } else {
    seenSkus.set(sku, sourceRow);
  }

  if (!sizes.length) errors.push(validationError("MISSING_SIZE", "At least one size variant is required.", "sizes"));
  if (!price) errors.push(validationError("INVALID_PRICE", "Price could not be parsed as a positive number.", "price"));
  if (!validateImageUrl(imageUrl)) {
    errors.push(validationError("INVALID_IMAGE_URL", "Image URL must be an absolute http(s) URL.", "imageUrl"));
  }

  if (sizes.length > 12) {
    warnings.push({
      code: "MANY_SIZE_VARIANTS",
      message: "Product has more than 12 size variants. Confirm this is intentional."
    });
  }

  return {
    source_row: sourceRow,
    name,
    sku,
    brand,
    sizes,
    price: price ? price.amount : null,
    currency: price ? price.currency : DEFAULTS.currency,
    image_url: imageUrl,
    description,
    color,
    gender,
    department,
    category_name: DEFAULTS.categoryName,
    template_name: DEFAULTS.templateName,
    raw: rawRow,
    errors,
    warnings
  };
}

function transformCatalog(rows) {
  if (!Array.isArray(rows)) throw new Error("Legacy export must parse to an array of product rows.");

  const seenSkus = new Map();
  const products = [];
  const invalidRows = [];
  const warnings = [];

  rows.forEach((row, index) => {
    const result = normalizeRow(row, index, seenSkus);
    if (result.warnings.length) {
      warnings.push(
        ...result.warnings.map((warning) => ({
          ...warning,
          source_row: result.source_row,
          sku: result.sku || null
        }))
      );
    }

    if (result.errors.length) {
      invalidRows.push({
        source_row: result.source_row,
        sku: result.sku || null,
        raw: result.raw,
        errors: result.errors
      });
      return;
    }

    products.push({
      source_row: result.source_row,
      name: result.name,
      sku: result.sku,
      brand: result.brand,
      sizes: result.sizes,
      price: result.price,
      currency: result.currency,
      image_url: result.image_url,
      description: result.description,
      color: result.color,
      gender: result.gender,
      department: result.department,
      category_name: result.category_name,
      template_name: result.template_name
    });
  });

  return {
    products,
    invalidRows,
    warnings,
    summary: {
      total_rows: rows.length,
      valid_products: products.length,
      invalid_rows: invalidRows.length,
      warning_count: warnings.length
    }
  };
}

function toFyndProductPayload(product, overrides = {}) {
  const price = {
    currency_code: product.currency,
    marked: product.price,
    effective: product.price
  };

  return {
    name: product.name,
    slug: slugify(product.brand, product.name, product.sku),
    brand: product.brand,
    item_code: product.sku,
    department: product.department,
    category: product.category_name,
    template: product.template_name,
    type: "standard",
    short_description: product.description.slice(0, 180),
    description: product.description,
    media: [{ type: "image", url: product.image_url }],
    images: [{ type: "image", url: product.image_url }],
    price,
    attributes: {
      source_system: "northwind_legacy_export",
      legacy_sku: product.sku,
      color: product.color || undefined,
      gender: product.gender || undefined
    },
    variants: {
      size: product.sizes.map((size) => ({
        display: size,
        value: size,
        seller_identifier: sizeSku(product.sku, size),
        price
      }))
    },
    _migration: {
      source_row: product.source_row,
      assumptions: [
        "Mapped to Others category and Supplementary template per case-study brief.",
        "One catalog create request is assumed per normalized product."
      ]
    },
    ...overrides
  };
}

function prepareRows(rows, options = {}) {
  const report = transformCatalog(rows);
  const payloads = report.products.map((product) => toFyndProductPayload(product, options.payloadOverrides));
  return { ...report, payloads };
}

function dryRunIngest(products) {
  const results = products.map((product) => ({
    sku: product.sku,
    source_row: product.source_row,
    status: "success",
    response: {
      dry_run: true,
      item_code: product.sku,
      name: product.name,
      message: "Payload validated locally. No Fynd API call was made."
    }
  }));

  return {
    dry_run: true,
    summary: {
      attempted: results.length,
      succeeded: results.length,
      failed: 0,
      skipped: 0
    },
    results
  };
}

async function runServerless(input = {}) {
  const method = getMethod(input);
  const path = getPath(input);
  const query = parseQuery(input);

  if (method === "OPTIONS") return jsonResponse(204, {});

  if (method === "GET" && (path.endsWith("/health") || query.format === "json")) {
    return jsonResponse(200, {
      ok: true,
      service: "northwind-catalog-serverless",
      endpoints: ["POST /validate", "POST /dry-run", "POST /ingest"],
      body: {
        rows: "Legacy rows array",
        action: "validate | dry-run | ingest",
        live: "Live Fynd ingest is disabled in this single-file Boltic blueprint; use dry-run output as review evidence."
      }
    });
  }

  if (method === "GET") return htmlResponse(200, renderWebPage());

  if (method !== "POST") {
    return jsonResponse(405, {
      error: "METHOD_NOT_ALLOWED",
      message: "Use GET for health or POST for catalog validation/migration."
    });
  }

  const body = parseBody(input);
  const rows = pickRows(body);
  const action = resolveAction(path, body, query);
  const prepared = prepareRows(rows, { payloadOverrides: body.payloadOverrides });

  if (action === "validate") {
    return jsonResponse(200, {
      summary: prepared.summary,
      invalidRows: prepared.invalidRows,
      warnings: prepared.warnings,
      products: prepared.products
    });
  }

  if (action === "dry-run" || action === "preview" || action === "ingest") {
    return jsonResponse(200, {
      summary: prepared.summary,
      invalidRows: prepared.invalidRows,
      warnings: prepared.warnings,
      payloads: prepared.payloads,
      live: false,
      ingestion: dryRunIngest(prepared.products)
    });
  }

  return jsonResponse(400, {
    error: "UNKNOWN_ACTION",
    message: `Unsupported action: ${action}`
  });
}

async function handler(event = {}, res) {
  try {
    const response = await runServerless(event);
    return sendExpressResponse(res, response);
  } catch (error) {
    return sendExpressResponse(
      res,
      jsonResponse(400, {
        error: "REQUEST_FAILED",
        message: error.message
      })
    );
  }
}

module.exports.handler = handler;
module.exports.default = handler;
module.exports.runServerless = runServerless;
