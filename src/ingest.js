"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readLegacyExport } = require("./legacy-reader");
const { transformCatalog, toFyndProductPayload } = require("./normalizer");
const { writeReports } = require("./report");
const { DryRunClient } = require("./fynd-client");
const { RateLimiter } = require("./rate-limiter");

function ensureParent(filePath) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function loadCheckpoint(checkpointPath) {
  if (!checkpointPath || !fs.existsSync(checkpointPath)) {
    return { products: {} };
  }
  return JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
}

function saveCheckpoint(checkpointPath, checkpoint) {
  if (!checkpointPath) return;
  ensureParent(checkpointPath);
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function prepareRows(rows, options = {}) {
  const report = transformCatalog(rows);
  const payloads = report.products.map((product) =>
    toFyndProductPayload(product, options.payloadOverrides)
  );
  return {
    ...report,
    payloads
  };
}

function prepareCatalog(inputPath, options = {}) {
  const rows = readLegacyExport(inputPath);
  return prepareRows(rows, options);
}

async function ingestProducts(products, options = {}) {
  const client = options.client || new DryRunClient();
  const dryRun = options.dryRun !== false && client instanceof DryRunClient;
  const checkpoint = loadCheckpoint(options.checkpointPath);
  const limiter = new RateLimiter({
    requestsPerMinute: options.requestsPerMinute || 100
  });
  const results = [];

  for (const product of products) {
    const prior = checkpoint.products[product.sku];
    if (prior && prior.status === "success") {
      results.push({
        sku: product.sku,
        status: "skipped",
        reason: "Already succeeded in checkpoint."
      });
      continue;
    }

    const payload = toFyndProductPayload(product, options.payloadOverrides);

    if (!dryRun) {
      await limiter.wait();
    }

    try {
      const response = await client.createProduct(payload, product);
      const record = {
        sku: product.sku,
        source_row: product.source_row,
        status: "success",
        response
      };
      checkpoint.products[product.sku] = {
        status: "success",
        source_row: product.source_row,
        updated_at: new Date().toISOString()
      };
      saveCheckpoint(options.checkpointPath, checkpoint);
      results.push(record);
    } catch (error) {
      const record = {
        sku: product.sku,
        source_row: product.source_row,
        status: "failed",
        error: error.message
      };
      checkpoint.products[product.sku] = {
        status: "failed",
        source_row: product.source_row,
        error: error.message,
        updated_at: new Date().toISOString()
      };
      saveCheckpoint(options.checkpointPath, checkpoint);
      results.push(record);

      if (options.stopOnError) {
        throw error;
      }
    }
  }

  return {
    dry_run: dryRun,
    summary: {
      attempted: results.filter((result) => result.status !== "skipped").length,
      succeeded: results.filter((result) => result.status === "success").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length
    },
    results
  };
}

async function runMigration(options) {
  const prepared = prepareCatalog(options.inputPath, {
    payloadOverrides: options.payloadOverrides
  });

  writeReports(prepared, {
    jsonPath: options.reportPath,
    markdownPath: options.markdownPath
  });

  if (options.outPath) {
    ensureParent(options.outPath);
    fs.writeFileSync(options.outPath, `${JSON.stringify(prepared.payloads, null, 2)}\n`);
  }

  if (options.validateOnly) {
    return prepared;
  }

  const client = options.client || new DryRunClient();
  const ingestion = await ingestProducts(prepared.products, {
    client,
    dryRun: options.dryRun,
    checkpointPath: options.checkpointPath,
    requestsPerMinute: options.requestsPerMinute,
    payloadOverrides: options.payloadOverrides,
    stopOnError: options.stopOnError
  });

  return {
    ...prepared,
    ingestion
  };
}

module.exports = {
  ingestProducts,
  loadCheckpoint,
  prepareCatalog,
  prepareRows,
  runMigration,
  saveCheckpoint
};

