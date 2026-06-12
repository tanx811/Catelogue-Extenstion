"use strict";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization"
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

function sendExpressResponse(res, response) {
  if (!res) return response;

  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(response.statusCode);
    Object.entries(response.headers).forEach(([key, value]) => {
      if (typeof res.setHeader === "function") res.setHeader(key, value);
    });
    return res.json(JSON.parse(response.body || "{}"));
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

  if (method === "GET") {
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
