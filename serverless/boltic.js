"use strict";

const { createFyndSdkClientFromEnv, DryRunClient } = require("../src/fynd-client");
const { ingestProducts, prepareRows } = require("../src/ingest");

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization"
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
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

function parseBody(input = {}) {
  if (input.body === undefined || input.body === null || input.body === "") {
    return {};
  }

  if (typeof input.body === "object" && !Buffer.isBuffer(input.body)) {
    return input.body;
  }

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

function parseQuery(input = {}) {
  if (input.queryStringParameters) return input.queryStringParameters;
  if (input.query) return input.query;
  try {
    return Object.fromEntries(new URL(input.url || "/", "https://serverless.local").searchParams);
  } catch (_error) {
    return {};
  }
}

async function runServerless(input = {}) {
  const method = getMethod(input);
  const path = getPath(input);
  const query = parseQuery(input);

  if (method === "OPTIONS") {
    return jsonResponse(204, {});
  }

  if (method === "GET") {
    return jsonResponse(200, {
      ok: true,
      service: "northwind-catalog-serverless",
      endpoints: ["POST /validate", "POST /dry-run", "POST /ingest"],
      body: {
        rows: "Legacy rows array",
        action: "validate | dry-run | ingest",
        live: "Set true only for real Fynd ingestion"
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
  const prepared = prepareRows(rows, {
    payloadOverrides: body.payloadOverrides
  });

  if (action === "validate") {
    return jsonResponse(200, {
      summary: prepared.summary,
      invalidRows: prepared.invalidRows,
      warnings: prepared.warnings,
      products: prepared.products
    });
  }

  if (action === "dry-run" || action === "preview") {
    const ingestion = await ingestProducts(prepared.products, {
      client: new DryRunClient(),
      dryRun: true,
      payloadOverrides: body.payloadOverrides,
      requestsPerMinute: Number(body.requestsPerMinute || 100)
    });

    return jsonResponse(200, {
      summary: prepared.summary,
      invalidRows: prepared.invalidRows,
      warnings: prepared.warnings,
      payloads: prepared.payloads,
      ingestion
    });
  }

  if (action === "ingest") {
    const live = body.live === true || query.live === "true";
    const client = live ? await createFyndSdkClientFromEnv() : new DryRunClient();
    const ingestion = await ingestProducts(prepared.products, {
      client,
      dryRun: !live,
      payloadOverrides: body.payloadOverrides,
      requestsPerMinute: Number(body.requestsPerMinute || 100)
    });

    return jsonResponse(200, {
      summary: prepared.summary,
      invalidRows: prepared.invalidRows,
      warnings: prepared.warnings,
      live,
      ingestion
    });
  }

  return jsonResponse(400, {
    error: "UNKNOWN_ACTION",
    message: `Unsupported action: ${action}`
  });
}

async function bolticHandler(input, res) {
  try {
    const response = await runServerless(input);

    if (res && typeof res.status === "function" && typeof res.json === "function") {
      res.status(response.statusCode);
      Object.entries(response.headers).forEach(([key, value]) => {
        if (typeof res.setHeader === "function") res.setHeader(key, value);
      });
      return res.json(JSON.parse(response.body || "{}"));
    }

    return response;
  } catch (error) {
    const response = jsonResponse(400, {
      error: "REQUEST_FAILED",
      message: error.message
    });

    if (res && typeof res.status === "function" && typeof res.json === "function") {
      res.status(response.statusCode);
      return res.json(JSON.parse(response.body));
    }

    return response;
  }
}

module.exports = bolticHandler;
module.exports.handler = bolticHandler;
module.exports.default = bolticHandler;
module.exports.runServerless = runServerless;
