"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { readLegacyExport } = require("../src/legacy-reader");
const {
  parsePrice,
  splitSizes,
  toFyndProductPayload,
  transformCatalog,
  validateImageUrl
} = require("../src/normalizer");

const samplePath = path.join(__dirname, "..", "data", "northwind_legacy_export.json");

test("sample export captures valid products and required edge-case failures", () => {
  const rows = readLegacyExport(samplePath);
  const report = transformCatalog(rows);

  assert.equal(report.summary.total_rows, 12);
  assert.equal(report.summary.valid_products, 5);
  assert.equal(report.summary.invalid_rows, 7);

  const codes = report.invalidRows.flatMap((row) => row.errors.map((error) => error.code));
  assert.ok(codes.includes("DUPLICATE_SKU"));
  assert.ok(codes.includes("MISSING_SKU"));
  assert.ok(codes.includes("MISSING_NAME"));
  assert.ok(codes.includes("INVALID_IMAGE_URL"));
  assert.ok(codes.includes("MALFORMED_ROW"));
  assert.ok(codes.includes("INVALID_PRICE"));
  assert.ok(codes.includes("MISSING_SIZE"));
});

test("price parser strips currency symbols and stray characters", () => {
  assert.deepEqual(parsePrice("₹1,299.00"), { amount: 1299, currency: "INR" });
  assert.deepEqual(parsePrice("INR 2,499/-"), { amount: 2499, currency: "INR" });
  assert.deepEqual(parsePrice("$24.99"), { amount: 24.99, currency: "USD" });
  assert.equal(parsePrice("₹ --"), null);
});

test("size splitter handles delimited strings and arrays", () => {
  assert.deepEqual(splitSizes("S/M/L"), ["S", "M", "L"]);
  assert.deepEqual(splitSizes("32,34,36"), ["32", "34", "36"]);
  assert.deepEqual(splitSizes(["xs", "S", "M"]), ["XS", "S", "M"]);
  assert.deepEqual(splitSizes("One Size"), ["One Size"]);
});

test("image URL validation requires absolute http(s) URL", () => {
  assert.equal(validateImageUrl("https://example.com/image.jpg"), true);
  assert.equal(validateImageUrl("http://example.com/image.jpg"), true);
  assert.equal(validateImageUrl("htp://bad url"), false);
  assert.equal(validateImageUrl("/relative/image.jpg"), false);
});

test("Fynd payload preserves category/template assumptions and variants", () => {
  const rows = readLegacyExport(samplePath);
  const report = transformCatalog(rows);
  const payload = toFyndProductPayload(report.products[0]);

  assert.equal(payload.item_code, "NW-TSH-001");
  assert.equal(payload.category, "Others");
  assert.equal(payload.template, "Supplementary");
  assert.equal(payload.variants.size.length, 3);
  assert.deepEqual(
    payload.variants.size.map((size) => size.seller_identifier),
    ["NW-TSH-001-S", "NW-TSH-001-M", "NW-TSH-001-L"]
  );
});

