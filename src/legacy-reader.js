"use strict";

const fs = require("node:fs");
const path = require("node:path");

function parseCsv(text) {
  const rows = [];
  let cell = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((csvRow) =>
    csvRow.some((value) => String(value).trim() !== "")
  );
  if (!nonEmptyRows.length) return [];

  const headers = nonEmptyRows[0].map((header) => String(header).trim());
  return nonEmptyRows.slice(1).map((csvRow) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = csvRow[index] === undefined ? "" : csvRow[index].trim();
    });
    return obj;
  });
}

function readLegacyExport(filePath) {
  const absolutePath = path.resolve(filePath);
  const text = fs.readFileSync(absolutePath, "utf8");
  const ext = path.extname(absolutePath).toLowerCase();

  if (ext === ".json") {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.products)) return parsed.products;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    throw new Error("JSON export must be an array or contain a products/rows array.");
  }

  if (ext === ".jsonl" || ext === ".ndjson") {
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  if (ext === ".csv") {
    return parseCsv(text);
  }

  throw new Error(`Unsupported export type: ${ext || "unknown"}. Use JSON, JSONL, or CSV.`);
}

module.exports = {
  parseCsv,
  readLegacyExport
};

