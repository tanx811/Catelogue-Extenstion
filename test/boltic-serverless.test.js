"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sampleRows = require("../data/northwind_legacy_export.json");
const rootHandler = require("../index");
const bolticHandler = require("../serverless/boltic");
const { runServerless } = bolticHandler;

function parse(response) {
  return JSON.parse(response.body);
}

test("serverless handler returns health metadata", async () => {
  const response = await runServerless({ httpMethod: "GET", path: "/" });
  const body = parse(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "northwind-catalog-serverless");
});

test("root index exports index.handler compatibility shim", async () => {
  assert.equal(typeof rootHandler.handler, "function");
  const response = await rootHandler.handler({ httpMethod: "GET", path: "/" });
  const body = parse(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.service, "northwind-catalog-serverless");
});

test("serverless validate action reports sample edge cases", async () => {
  const response = await runServerless({
    httpMethod: "POST",
    path: "/validate",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: sampleRows })
  });
  const body = parse(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.summary.total_rows, 12);
  assert.equal(body.summary.valid_products, 5);
  assert.equal(body.summary.invalid_rows, 7);
  assert.equal(body.products.length, 5);
});

test("serverless dry-run action returns Fynd payloads without live API calls", async () => {
  const response = await runServerless({
    httpMethod: "POST",
    path: "/dry-run",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: sampleRows })
  });
  const body = parse(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.payloads.length, 5);
  assert.equal(body.ingestion.dry_run, true);
  assert.equal(body.ingestion.summary.succeeded, 5);
});

test("serverless action rejects missing rows", async () => {
  const response = await bolticHandler({
    httpMethod: "POST",
    path: "/validate",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: "not-array" })
  });
  const body = parse(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.error, "REQUEST_FAILED");
});
