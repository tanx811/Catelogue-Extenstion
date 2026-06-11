"use strict";

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

function normalizeKey(key) {
  return String(key).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compactString(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function lookup(row, aliases) {
  const normalized = new Map();
  for (const [key, value] of Object.entries(row)) {
    normalized.set(normalizeKey(key), value);
  }

  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias));
    if (value !== undefined && value !== null && compactString(value) !== "") {
      return value;
    }
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
    return {
      amount: Number(raw.toFixed(2)),
      currency: detectCurrency(raw, explicitCurrency)
    };
  }

  const text = compactString(raw);
  const match = text.match(/[0-9][0-9,]*(?:\.[0-9]+)?/);
  if (!match) return null;

  const amount = Number(match[0].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    amount: Number(amount.toFixed(2)),
    currency: detectCurrency(text, explicitCurrency)
  };
}

function canonicalSize(size) {
  const value = compactString(size);
  if (/^[a-z]{1,4}$/i.test(value)) return value.toUpperCase();
  return value;
}

function splitSizes(raw) {
  if (Array.isArray(raw)) {
    return raw.map(canonicalSize).filter(Boolean);
  }

  const text = compactString(raw);
  if (!text) return [];

  return text
    .split(/[\/,|;]+/)
    .map(canonicalSize)
    .filter(Boolean);
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
  const price = parsePrice(
    lookup(rawRow, FIELD_ALIASES.price),
    lookup(rawRow, FIELD_ALIASES.currency)
  );
  const imageUrl = compactString(lookup(rawRow, FIELD_ALIASES.imageUrl));
  const description =
    compactString(lookup(rawRow, FIELD_ALIASES.description)) ||
    `${name || "Northwind product"} migrated from the legacy catalog export.`;
  const color = compactString(lookup(rawRow, FIELD_ALIASES.color));
  const gender = compactString(lookup(rawRow, FIELD_ALIASES.gender));
  const department =
    compactString(lookup(rawRow, FIELD_ALIASES.department)) || DEFAULTS.department;

  if (!name) {
    errors.push(validationError("MISSING_NAME", "Product name/title is mandatory.", "name"));
  }

  if (!sku) {
    errors.push(validationError("MISSING_SKU", "SKU/seller identifier is mandatory.", "sku"));
  } else if (seenSkus.has(sku)) {
    errors.push(
      validationError(
        "DUPLICATE_SKU",
        `SKU ${sku} already appeared on row ${seenSkus.get(sku)}.`,
        "sku"
      )
    );
  } else {
    seenSkus.set(sku, sourceRow);
  }

  if (!sizes.length) {
    errors.push(
      validationError("MISSING_SIZE", "At least one size variant is required.", "sizes")
    );
  }

  if (!price) {
    errors.push(
      validationError("INVALID_PRICE", "Price could not be parsed as a positive number.", "price")
    );
  }

  if (!validateImageUrl(imageUrl)) {
    errors.push(
      validationError(
        "INVALID_IMAGE_URL",
        "Image URL must be an absolute http(s) URL.",
        "imageUrl"
      )
    );
  }

  if (sizes.length > 12) {
    warnings.push({
      code: "MANY_SIZE_VARIANTS",
      message: "Product has more than 12 size variants. Confirm this is intentional."
    });
  }

  const normalized = {
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
    raw: rawRow
  };

  return {
    ...normalized,
    errors,
    warnings
  };
}

function transformCatalog(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Legacy export must parse to an array of product rows.");
  }

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
  const slug = slugify(product.brand, product.name, product.sku);
  const price = {
    currency_code: product.currency,
    marked: product.price,
    effective: product.price
  };

  return {
    name: product.name,
    slug,
    brand: product.brand,
    item_code: product.sku,
    department: product.department,
    category: product.category_name,
    template: product.template_name,
    type: "standard",
    short_description: product.description.slice(0, 180),
    description: product.description,
    media: [
      {
        type: "image",
        url: product.image_url
      }
    ],
    images: [
      {
        type: "image",
        url: product.image_url
      }
    ],
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

module.exports = {
  DEFAULTS,
  FIELD_ALIASES,
  compactString,
  normalizeKey,
  normalizeRow,
  parsePrice,
  splitSizes,
  transformCatalog,
  toFyndProductPayload,
  validateImageUrl
};

