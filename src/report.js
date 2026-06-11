"use strict";

const fs = require("node:fs");
const path = require("node:path");

function ensureParent(filePath) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push("# Northwind Catalog Validation Report");
  lines.push("");
  lines.push(`- Total rows: ${report.summary.total_rows}`);
  lines.push(`- Valid products: ${report.summary.valid_products}`);
  lines.push(`- Invalid rows: ${report.summary.invalid_rows}`);
  lines.push(`- Warnings: ${report.summary.warning_count}`);
  lines.push("");

  if (report.invalidRows.length) {
    lines.push("## Invalid Rows");
    lines.push("");
    lines.push("| Source row | SKU | Error codes | Details |");
    lines.push("|---:|---|---|---|");
    report.invalidRows.forEach((row) => {
      const codes = row.errors.map((error) => error.code).join(", ");
      const details = row.errors.map((error) => error.message).join(" ");
      lines.push(
        `| ${row.source_row} | ${row.sku || "-"} | ${codes} | ${details.replace(/\|/g, "\\|")} |`
      );
    });
    lines.push("");
  }

  if (report.warnings.length) {
    lines.push("## Warnings");
    lines.push("");
    lines.push("| Source row | SKU | Code | Details |");
    lines.push("|---:|---|---|---|");
    report.warnings.forEach((warning) => {
      lines.push(
        `| ${warning.source_row} | ${warning.sku || "-"} | ${warning.code} | ${warning.message.replace(/\|/g, "\\|")} |`
      );
    });
    lines.push("");
  }

  lines.push("## Valid Products");
  lines.push("");
  lines.push("| Source row | SKU | Name | Sizes | Price |");
  lines.push("|---:|---|---|---|---:|");
  report.products.forEach((product) => {
    lines.push(
      `| ${product.source_row} | ${product.sku} | ${product.name.replace(/\|/g, "\\|")} | ${product.sizes.join(", ")} | ${product.currency} ${product.price} |`
    );
  });
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function writeReports(report, options = {}) {
  const jsonPath = options.jsonPath || options.reportPath;
  const markdownPath = options.markdownPath;

  if (jsonPath) {
    ensureParent(jsonPath);
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (markdownPath) {
    ensureParent(markdownPath);
    fs.writeFileSync(markdownPath, renderMarkdownReport(report));
  }
}

module.exports = {
  renderMarkdownReport,
  writeReports
};

