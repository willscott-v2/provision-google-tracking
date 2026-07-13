import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chmod, mkdir } from "node:fs/promises";
import { oauthClientFingerprint, tokenPathForClient } from "../auth.js";
import { parseSiteConfigForTest } from "../config.js";
import { saveCloudflareToken } from "../credentials.js";
import { runDoctor } from "../doctor.js";
import { createState, saveState } from "../state.js";
import { googleTagSnippet } from "../tag.js";
import { validateProvisioning } from "../validation.js";
import {
  desktopClient,
  tempDirectory,
  validConfig,
  writeJson,
} from "./helpers.js";

test("doctor accepts a ready local client and valid public site responses", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = path.join(root, "credentials");
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const client = desktopClient();
  const clientPath = await writeJson(path.join(root, "desktop.json"), client);
  const tokenPath = tokenPathForClient(
    "owner@example.com",
    client.installed.client_id,
  );
  await mkdir(path.dirname(tokenPath), { recursive: true });
  await writeJson(
    tokenPath,
    {
      version: 2,
      accessToken: "TEST_ONLY_NOT_A_SECRET_ACCESS_TOKEN",
      refreshToken: "TEST_ONLY_NOT_A_SECRET_REFRESH_TOKEN",
      expiresAt: Date.now() + 60_000,
      email: "owner@example.com",
      clientFingerprint: oauthClientFingerprint(client.installed.client_id),
      scopes: ["openid", "email"],
    },
  );
  await saveCloudflareToken({
    domain: "example.com",
    token: "TEST_ONLY_NOT_A_SECRET_CLOUDFLARE_TOKEN_12345",
  });
  const fetchImpl = async (url) => {
    if (String(url).endsWith("sitemap.xml")) {
      return new Response('<?xml version="1.0"?><urlset></urlset>', {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    }
    return new Response("<!doctype html><html></html>", { status: 200 });
  };
  const report = await runDoctor({
    config,
    oauthClientPath: clientPath,
    online: true,
    fetchImpl,
  });
  assert.equal(report.failed, false);
  assert.equal(report.pending, false);
  assert.equal(report.checks.find((item) => item.id === "oauth-client").status, "pass");
  assert.equal(report.checks.find((item) => item.id === "sitemap-url").status, "pass");
  assert.equal(report.checks.find((item) => item.id === "oauth-token").status, "pass");
  assert.equal(report.checks.find((item) => item.id === "cloudflare-token").status, "pass");
});

test("doctor fails an OAuth client from another configured project", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = path.join(root, "credentials");
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const clientPath = await writeJson(
    path.join(root, "desktop.json"),
    desktopClient({ project_id: "wrong-project" }),
  );
  const report = await runDoctor({ config, oauthClientPath: clientPath, online: false });
  assert.equal(report.failed, true);
  assert.match(
    report.checks.find((item) => item.id === "oauth-client").summary,
    /does not match/,
  );
});

test("doctor reports missing and permissive OAuth prerequisites without exposing values", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = path.join(root, "credentials");
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const missing = await runDoctor({ config, online: false });
  assert.equal(
    missing.checks.find((item) => item.id === "oauth-client").status,
    "pending",
  );
  const clientPath = await writeJson(path.join(root, "desktop.json"), desktopClient());
  await chmod(clientPath, 0o644);
  const permissive = await runDoctor({
    config,
    oauthClientPath: clientPath,
    online: false,
  });
  const permission = permissive.checks.find(
    (item) => item.id === "oauth-client-permissions",
  );
  assert.equal(permission.status, "pending");
  assert.doesNotMatch(JSON.stringify(permissive), /TEST_ONLY_NOT_A_SECRET_CLIENT_VALUE/);
});

test("doctor rejects malformed OAuth JSON and a non-XML sitemap", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = path.join(root, "credentials");
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const malformedPath = path.join(root, "desktop.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(malformedPath, "not-json\n", { mode: 0o600 });
  const report = await runDoctor({
    config,
    oauthClientPath: malformedPath,
    online: true,
    fetchImpl: async (url) =>
      new Response(String(url).endsWith("sitemap.xml") ? "<html></html>" : "<html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
  });
  assert.equal(report.checks.find((item) => item.id === "oauth-client").status, "fail");
  assert.equal(report.checks.find((item) => item.id === "sitemap-url").status, "fail");
});

test("doctor does not require Cloudflare credentials for manual DNS", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = path.join(root, "credentials");
  const config = parseSiteConfigForTest(
    validConfig({ verification: { provider: "manual" } }),
    path.join(root, "site.json"),
  );
  const report = await runDoctor({ config, online: false });
  const provider = report.checks.find((item) => item.id === "dns-provider");
  assert.equal(provider.status, "pass");
  assert.equal(
    report.checks.some((item) => item.id === "cloudflare-token"),
    false,
  );
});

class ValidationGoogle {
  async getProperty() {
    return { name: "properties/100", parent: "accounts/123456789" };
  }

  async listDataStreams() {
    return [
      {
        name: "properties/100/dataStreams/200",
        webStreamData: {
          defaultUri: "https://example.com/",
          measurementId: "G-ABCDE12345",
        },
      },
    ];
  }

  async getVerifiedResource() {
    return {
      id: "dns://example.com",
      site: { type: "INET_DOMAIN", identifier: "example.com" },
      owners: ["owner@example.com"],
    };
  }

  async listSearchConsoleSites() {
    return [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }];
  }

  async listSitemaps() {
    return [
      {
        path: "https://example.com/sitemap.xml",
        isPending: false,
        errors: 0,
        warnings: 0,
      },
    ];
  }
}

async function validationFixture() {
  const root = await tempDirectory();
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const state = createState("example.com");
  Object.assign(state, {
    googleEmail: "owner@example.com",
    gaAccountId: "123456789",
    gaPropertyName: "properties/100",
    gaDataStreamName: "properties/100/dataStreams/200",
    measurementId: "G-ABCDE12345",
    verificationToken: "google-site-verification=TEST_ONLY_PUBLIC_VERIFICATION_VALUE",
    verificationResourceId: "dns://example.com",
    cloudflareZoneId: "zone-1",
    cloudflareDnsRecordId: "record-1",
    searchConsoleProperty: "sc-domain:example.com",
    sitemapSubmitted: true,
    completed: true,
  });
  await saveState(config.statePath, state);
  return config;
}

test("validation reports verified API, DNS, sitemap, and live-tag evidence", async () => {
  const config = await validationFixture();
  const html = `<!doctype html><html><head>${googleTagSnippet("G-ABCDE12345")}</head></html>`;
  const report = await validateProvisioning({
    config,
    google: new ValidationGoogle(),
    fetchImpl: async () => new Response(html, { status: 200 }),
    resolveTxtImpl: async () => [
      ["google-site-verification=TEST_ONLY_PUBLIC_VERIFICATION_VALUE"],
    ],
  });
  assert.equal(report.failed, 0);
  assert.equal(report.pending, 0);
  assert.equal(report.checks.find((item) => item.id === "live-tag").status, "pass");
  assert.equal(
    report.checks.find((item) => item.id === "ga4-search-console-link").status,
    "skipped",
  );
});

test("validation fails a missing live measurement ID", async () => {
  const config = await validationFixture();
  const report = await validateProvisioning({
    config,
    google: new ValidationGoogle(),
    fetchImpl: async () => new Response("<!doctype html><html></html>", { status: 200 }),
    resolveTxtImpl: async () => [
      ["google-site-verification=TEST_ONLY_PUBLIC_VERIFICATION_VALUE"],
    ],
  });
  assert.equal(report.failed, 1);
  assert.equal(report.checks.find((item) => item.id === "live-tag").status, "fail");
});

test("validation distinguishes a pending sitemap from skipped optional checks", async () => {
  const config = await validationFixture();
  class PendingValidationGoogle extends ValidationGoogle {
    async listSitemaps() {
      return [{ path: "https://example.com/sitemap.xml", isPending: true }];
    }
  }
  const html = `<!doctype html><html><head>${googleTagSnippet("G-ABCDE12345")}</head></html>`;
  const report = await validateProvisioning({
    config,
    google: new PendingValidationGoogle(),
    fetchImpl: async () => new Response(html, { status: 200 }),
    resolveTxtImpl: async () => [
      ["google-site-verification=TEST_ONLY_PUBLIC_VERIFICATION_VALUE"],
    ],
  });
  assert.equal(report.pending, 1);
  assert.equal(report.checks.find((item) => item.id === "sitemap").status, "pending");
  assert.equal(
    report.checks.find((item) => item.id === "cloudflare-record").status,
    "skipped",
  );
});
