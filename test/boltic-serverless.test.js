"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sampleRows = require("../data/northwind_legacy_export.json");
const generatedHandler = require("../handler");
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
  const response = await rootHandler.handler({ httpMethod: "GET", path: "/health" });
  const body = parse(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.service, "northwind-catalog-serverless");
});

test("root handler exports Boltic's handler.handler entrypoint", async () => {
  assert.equal(typeof generatedHandler.handler, "function");
  const response = await generatedHandler.handler({ httpMethod: "GET", path: "/" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.body, /Northwind Catalog Tool/);
  assert.match(response.body, /Download Prototype Extension/);
});

test("root handler keeps JSON health endpoint", async () => {
  const response = await generatedHandler.handler({ httpMethod: "GET", path: "/health" });
  const body = parse(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "northwind-catalog-serverless");
  assert.ok(body.endpoints.includes("GET /download"));
});

test("root handler returns downloadable prototype extension metadata", async () => {
  const response = await generatedHandler.handler({
    httpMethod: "GET",
    path: "/extension-package",
    headers: { host: "catalogue-demo.example.com", "x-forwarded-proto": "https" }
  });
  const body = parse(response);
  const archive = Buffer.from(body.base64, "base64");

  assert.equal(response.statusCode, 200);
  assert.equal(body.filename, "northwind-catalog-extension-prototype.zip");
  assert.equal(body.mimeType, "application/zip");
  assert.equal(body.baseUrl, "https://catalogue-demo.example.com");
  assert.ok(body.files.includes("northwind-catalog-extension-prototype/manifest.json"));
  assert.ok(body.files.includes("northwind-catalog-extension-prototype/popup.js"));
  assert.equal(archive.subarray(0, 2).toString("utf8"), "PK");
});

test("root handler returns direct ZIP download response", async () => {
  const response = await generatedHandler.handler({ httpMethod: "GET", path: "/download" });
  const archive = Buffer.from(response.body, "base64");

  assert.equal(response.statusCode, 200);
  assert.equal(response.isBase64Encoded, true);
  assert.match(response.headers["content-type"], /application\/zip/);
  assert.match(response.headers["content-disposition"], /northwind-catalog-extension-prototype\.zip/);
  assert.equal(archive.subarray(0, 2).toString("utf8"), "PK");
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
