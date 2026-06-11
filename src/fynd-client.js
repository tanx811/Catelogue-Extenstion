"use strict";

class DryRunClient {
  async createProduct(payload) {
    return {
      dry_run: true,
      item_code: payload.item_code,
      name: payload.name,
      message: "Payload validated locally. No Fynd API call was made."
    };
  }
}

class FyndSdkCatalogClient {
  constructor(platformClient, options = {}) {
    if (!platformClient) throw new Error("platformClient is required.");
    this.platformClient = platformClient;
    this.companyId = options.companyId || process.env.FYND_COMPANY_ID;
    this.productEndpoint = options.productEndpoint || process.env.FYND_PRODUCT_ENDPOINT;
  }

  async createProduct(payload) {
    if (
      this.platformClient.catalog &&
      typeof this.platformClient.catalog.createProduct === "function"
    ) {
      return this.platformClient.catalog.createProduct({ body: payload });
    }

    if (typeof this.platformClient.request === "function") {
      const url =
        this.productEndpoint ||
        `/service/platform/catalog/v1.0/company/${this.companyId}/products/`;
      return this.platformClient.request({
        method: "POST",
        url,
        body: payload
      });
    }

    throw new Error(
      "Platform client does not expose catalog.createProduct() or request(). Check FDK SDK version."
    );
  }
}

async function createFyndSdkClientFromEnv() {
  const missing = ["FYND_COMPANY_ID", "FYND_API_KEY", "FYND_API_SECRET"].filter(
    (key) => !process.env[key]
  );
  if (missing.length) {
    throw new Error(`Missing required Fynd environment variables: ${missing.join(", ")}`);
  }

  let sdk;
  try {
    sdk = require("@gofynd/fdk-client-javascript");
  } catch (_scopedError) {
    try {
      sdk = require("fdk-client-javascript");
    } catch (_unscopedError) {
      throw new Error(
        "Install dependencies first: npm install. Could not load Fynd's JavaScript SDK."
      );
    }
  }

  const PlatformClient = sdk.PlatformClient || sdk.default?.PlatformClient;
  if (!PlatformClient) {
    throw new Error("The installed FDK client package does not export PlatformClient.");
  }

  const platformClient = new PlatformClient({
    companyId: process.env.FYND_COMPANY_ID,
    apiKey: process.env.FYND_API_KEY,
    apiSecret: process.env.FYND_API_SECRET,
    domain: process.env.FYND_DOMAIN || "https://api.fynd.com",
    useAutoRenewTimer: false
  });

  if (typeof platformClient.getAccesstokenObj === "function") {
    const token = await platformClient.getAccesstokenObj({
      grant_type: "client_credentials"
    });
    if (typeof platformClient.setToken === "function") {
      platformClient.setToken(token);
    }
  }

  return new FyndSdkCatalogClient(platformClient, {
    companyId: process.env.FYND_COMPANY_ID,
    productEndpoint: process.env.FYND_PRODUCT_ENDPOINT
  });
}

module.exports = {
  DryRunClient,
  FyndSdkCatalogClient,
  createFyndSdkClientFromEnv
};
