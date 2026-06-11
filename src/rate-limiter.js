"use strict";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RateLimiter {
  constructor({ requestsPerMinute = 100 } = {}) {
    if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) {
      throw new Error("requestsPerMinute must be a positive number.");
    }
    this.intervalMs = Math.ceil(60000 / requestsPerMinute);
    this.nextAllowedAt = 0;
  }

  async wait() {
    const now = Date.now();
    if (now < this.nextAllowedAt) {
      await sleep(this.nextAllowedAt - now);
    }
    this.nextAllowedAt = Date.now() + this.intervalMs;
  }
}

module.exports = {
  RateLimiter,
  sleep
};

