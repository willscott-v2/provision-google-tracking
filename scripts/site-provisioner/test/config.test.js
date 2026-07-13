import test from "node:test";
import assert from "node:assert/strict";
import { parseSiteConfigForTest } from "../config.js";
import { validConfig } from "./helpers.js";

test("normalizes a valid reusable configuration", () => {
  const config = parseSiteConfigForTest(
    validConfig({ domain: "EXAMPLE.com.", currencyCode: "usd" }),
    "/operations/site.json",
  );
  assert.equal(config.domain, "example.com");
  assert.equal(config.currencyCode, "USD");
  assert.equal(config.expectedGoogleCloudProjectId, "example-project");
  assert.equal(config.statePath, "/operations/.state/example.com.json");
});

test("rejects URLs outside the configured root domain", () => {
  assert.throws(
    () =>
      parseSiteConfigForTest(
        validConfig({ sitemapUrl: "https://other.example.net/sitemap.xml" }),
      ),
    /outside example\.com/,
  );
});

test("rejects unsupported DNS providers", () => {
  assert.throws(
    () =>
      parseSiteConfigForTest(
        validConfig({ verification: { provider: "other-provider" } }),
      ),
    /must be "cloudflare"/,
  );
});

test("accepts an explicit manual DNS handoff", () => {
  const config = parseSiteConfigForTest(
    validConfig({ verification: { provider: "manual" } }),
    "/tmp/example/site.json",
  );
  assert.equal(config.verification.provider, "manual");
});

test("resolves static and state paths relative to the config", () => {
  const config = parseSiteConfigForTest(
    validConfig({ staticSiteDirectory: "./public", stateFile: "./state.json" }),
    "/operations/config/site.json",
  );
  assert.equal(config.staticSiteDirectory, "/operations/config/public");
  assert.equal(config.statePath, "/operations/config/state.json");
});
