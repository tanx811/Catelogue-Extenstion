#!/usr/bin/env node
"use strict";

const { createFyndSdkClientFromEnv, DryRunClient } = require("../src/fynd-client");
const { runMigration } = require("../src/ingest");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function usage() {
  console.log(`Northwind catalog migration

Usage:
  node ./bin/catalog-migrate.js validate --input ./data/northwind_legacy_export.json
  node ./bin/catalog-migrate.js dry-run --input ./data/northwind_legacy_export.json --out ./reports/fynd-product-payloads.json
  node ./bin/catalog-migrate.js ingest --input ./data/northwind_legacy_export.json --checkpoint ./reports/ingest-checkpoint.json

Options:
  --input <path>       Legacy JSON, JSONL, or CSV export.
  --report <path>      Validation report JSON path.
  --markdown <path>    Validation report Markdown path.
  --out <path>         Dry-run payload JSON path.
  --checkpoint <path>  Resumable ingest checkpoint path.
  --rate-limit <n>     Requests per minute. Default: 100.
  --strict             Exit non-zero when validation finds invalid rows.
`);
}

function printValidationSummary(result) {
  console.log("Validation summary");
  console.log(`  Total rows:     ${result.summary.total_rows}`);
  console.log(`  Valid products: ${result.summary.valid_products}`);
  console.log(`  Invalid rows:   ${result.summary.invalid_rows}`);
  console.log(`  Warnings:       ${result.summary.warning_count}`);

  if (result.invalidRows.length) {
    console.log("");
    console.log("Invalid rows:");
    result.invalidRows.forEach((row) => {
      const codes = row.errors.map((error) => error.code).join(", ");
      console.log(`  Row ${row.source_row}${row.sku ? ` (${row.sku})` : ""}: ${codes}`);
    });
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const command = args._[0];

  if (!command || args.help || args.h) {
    usage();
    return;
  }

  const inputPath = args.input || "./data/northwind_legacy_export.json";
  const reportPath = args.report;
  const markdownPath = args.markdown;
  const requestsPerMinute = Number(args["rate-limit"] || 100);

  if (command === "validate") {
    const result = await runMigration({
      inputPath,
      reportPath,
      markdownPath,
      validateOnly: true
    });
    printValidationSummary(result);
    if (args.strict && result.summary.invalid_rows > 0) process.exitCode = 1;
    return;
  }

  if (command === "dry-run") {
    const result = await runMigration({
      inputPath,
      reportPath,
      markdownPath,
      outPath: args.out || "./reports/fynd-product-payloads.json",
      checkpointPath: args.checkpoint,
      requestsPerMinute,
      client: new DryRunClient(),
      dryRun: true
    });
    printValidationSummary(result);
    console.log("");
    console.log("Dry-run ingest summary");
    console.log(`  Attempted: ${result.ingestion.summary.attempted}`);
    console.log(`  Succeeded: ${result.ingestion.summary.succeeded}`);
    console.log(`  Failed:    ${result.ingestion.summary.failed}`);
    console.log("  No Fynd API call was made.");
    return;
  }

  if (command === "ingest") {
    const client = await createFyndSdkClientFromEnv();
    const result = await runMigration({
      inputPath,
      reportPath,
      markdownPath,
      checkpointPath: args.checkpoint || "./reports/ingest-checkpoint.json",
      requestsPerMinute,
      client,
      dryRun: false
    });
    printValidationSummary(result);
    console.log("");
    console.log("Fynd ingest summary");
    console.log(`  Attempted: ${result.ingestion.summary.attempted}`);
    console.log(`  Succeeded: ${result.ingestion.summary.succeeded}`);
    console.log(`  Failed:    ${result.ingestion.summary.failed}`);
    console.log(`  Skipped:   ${result.ingestion.summary.skipped}`);
    if (result.ingestion.summary.failed > 0) process.exitCode = 1;
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

