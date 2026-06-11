"use strict";

const { FyndSdkCatalogClient } = require("./fynd-client");
const { ingestProducts, prepareRows } = require("./ingest");

function getRowsFromRequest(req) {
  if (Array.isArray(req.body)) return req.body;
  if (Array.isArray(req.body?.rows)) return req.body.rows;
  if (Array.isArray(req.body?.products)) return req.body.products;
  throw new Error("Request body must be an array or contain rows/products array.");
}

async function getPlatformClient(fdkExtension, req) {
  if (req.platformClient) return req.platformClient;

  const companyId = req.query?.company_id || req.body?.company_id;
  if (!companyId) {
    throw new Error("company_id is required to create a platform client.");
  }

  if (typeof fdkExtension.getPlatformClient !== "function") {
    throw new Error("fdkExtension.getPlatformClient(company_id) is not available.");
  }

  return fdkExtension.getPlatformClient(companyId);
}

function registerNorthwindCatalogRoutes(fdkExtension) {
  const router = fdkExtension.platformApiRoutes || fdkExtension.apiRoutes;
  if (!router || typeof router.post !== "function") {
    throw new Error("FDK extension router not found. Expected platformApiRoutes or apiRoutes.");
  }

  router.post("/northwind/catalog/preview", async (req, res, next) => {
    try {
      const prepared = prepareRows(getRowsFromRequest(req));
      res.json({
        summary: prepared.summary,
        invalidRows: prepared.invalidRows,
        warnings: prepared.warnings,
        payloads: prepared.payloads
      });
    } catch (error) {
      if (next) next(error);
      else res.status(400).json({ error: error.message });
    }
  });

  router.post("/northwind/catalog/ingest", async (req, res, next) => {
    try {
      const prepared = prepareRows(getRowsFromRequest(req));
      const platformClient = await getPlatformClient(fdkExtension, req);
      const catalogClient = new FyndSdkCatalogClient(platformClient, {
        companyId: req.query?.company_id || req.body?.company_id
      });
      const ingestion = await ingestProducts(prepared.products, {
        client: catalogClient,
        dryRun: false,
        requestsPerMinute: Number(req.body?.requestsPerMinute || 100)
      });

      res.json({
        summary: prepared.summary,
        invalidRows: prepared.invalidRows,
        warnings: prepared.warnings,
        ingestion
      });
    } catch (error) {
      if (next) next(error);
      else res.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = {
  registerNorthwindCatalogRoutes
};

