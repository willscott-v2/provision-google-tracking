import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ApiError } from "../http.js";
import { parseSiteConfigForTest } from "../config.js";
import {
  applyProvisioning,
  buildPlan,
  PendingProvisioningError,
} from "../provisioner.js";
import { access } from "node:fs/promises";
import { tempDirectory, validConfig, jsonResponse } from "./helpers.js";

class FakeGoogle {
  constructor() {
    this.properties = [];
    this.streams = new Map();
    this.resources = [];
    this.sites = [];
    this.sitemaps = [];
    this.verifyFailures = 0;
    this.counts = {
      property: 0,
      stream: 0,
      verificationToken: 0,
      site: 0,
      sitemap: 0,
    };
  }

  async listProperties() {
    return this.properties;
  }

  async createProperty(input) {
    this.counts.property += 1;
    const property = {
      name: `properties/${100 + this.counts.property}`,
      parent: `accounts/${input.accountId}`,
      displayName: input.displayName,
    };
    this.properties.push(property);
    return property;
  }

  async getProperty(name) {
    const property = this.properties.find((candidate) => candidate.name === name);
    if (!property) throw new Error(`Missing property ${name}`);
    return property;
  }

  async listDataStreams(propertyName) {
    return this.streams.get(propertyName) ?? [];
  }

  async createWebDataStream(input) {
    this.counts.stream += 1;
    const stream = {
      name: `${input.propertyName}/dataStreams/${200 + this.counts.stream}`,
      displayName: input.displayName,
      webStreamData: {
        defaultUri: input.defaultUri,
        measurementId: "G-ABCDE12345",
      },
    };
    this.streams.set(input.propertyName, [
      ...(this.streams.get(input.propertyName) ?? []),
      stream,
    ]);
    return stream;
  }

  async listVerifiedResources() {
    return this.resources;
  }

  async getDomainVerificationToken() {
    this.counts.verificationToken += 1;
    return "google-site-verification=TEST_ONLY_PUBLIC_VERIFICATION_VALUE";
  }

  async verifyDomain(domain) {
    if (this.verifyFailures > 0) {
      this.verifyFailures -= 1;
      throw new ApiError("not visible", 400, "not visible");
    }
    const resource = {
      id: `dns://${domain}`,
      site: { type: "INET_DOMAIN", identifier: domain },
      owners: ["owner@example.com"],
    };
    this.resources = [resource];
    return resource;
  }

  async getVerifiedResource(id) {
    const resource = this.resources.find((candidate) => candidate.id === id);
    if (!resource) throw new Error(`Missing resource ${id}`);
    return resource;
  }

  async listSearchConsoleSites() {
    return this.sites;
  }

  async addSearchConsoleSite(siteUrl) {
    this.counts.site += 1;
    this.sites.push({ siteUrl, permissionLevel: "siteOwner" });
  }

  async listSitemaps() {
    return this.sitemaps;
  }

  async submitSitemap(siteUrl, sitemapUrl) {
    this.counts.sitemap += 1;
    this.sitemaps.push({ path: sitemapUrl, isPending: false, errors: 0, warnings: 0 });
  }
}

function fakeCloudflare() {
  let record;
  let createCount = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/client/v4/zones" && init.method === "GET") {
      return jsonResponse({ success: true, result: [{ id: "zone-1", name: "example.com" }] });
    }
    if (
      url.pathname === "/client/v4/zones/zone-1/dns_records" &&
      init.method === "GET"
    ) {
      return jsonResponse({ success: true, result: record ? [record] : [] });
    }
    if (
      url.pathname === "/client/v4/zones/zone-1/dns_records" &&
      init.method === "POST"
    ) {
      createCount += 1;
      const body = JSON.parse(init.body);
      record = { id: "record-1", ...body };
      return jsonResponse({ success: true, result: record });
    }
    if (
      url.pathname === "/client/v4/zones/zone-1/dns_records/record-1" &&
      init.method === "GET"
    ) {
      return jsonResponse({ success: true, result: record });
    }
    throw new Error(`Unexpected Cloudflare request ${init.method} ${url.pathname}`);
  };
  return { fetchImpl, get createCount() { return createCount; } };
}

test("resumes an interrupted run without duplicate resources", async () => {
  const root = await tempDirectory();
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const google = new FakeGoogle();
  const cloudflare = fakeCloudflare();
  google.verifyFailures = 1;
  await assert.rejects(
    () =>
      applyProvisioning({
        config,
        google,
        accountId: "123456789",
        accountName: "Example Analytics",
        googleEmail: "owner@example.com",
        cloudflareToken: "TEST_ONLY_NOT_A_SECRET_CLOUDFLARE_TOKEN_12345",
        fetchImpl: cloudflare.fetchImpl,
        verificationAttempts: 1,
        verificationDelayMs: 0,
      }),
    PendingProvisioningError,
  );
  const partialPlan = await buildPlan(config);
  assert.equal(partialPlan.completed, false);
  const state = await applyProvisioning({
    config,
    google,
    accountId: "123456789",
    accountName: "Example Analytics",
    googleEmail: "owner@example.com",
    cloudflareToken: "TEST_ONLY_NOT_A_SECRET_CLOUDFLARE_TOKEN_12345",
    fetchImpl: cloudflare.fetchImpl,
    verificationAttempts: 1,
    verificationDelayMs: 0,
  });
  assert.equal(state.completed, true);
  assert.equal(state.measurementId, "G-ABCDE12345");
  assert.deepEqual(google.counts, {
    property: 1,
    stream: 1,
    verificationToken: 1,
    site: 1,
    sitemap: 1,
  });
  assert.equal(cloudflare.createCount, 1);
  await applyProvisioning({
    config,
    google,
    accountId: "123456789",
    accountName: "Example Analytics",
    googleEmail: "owner@example.com",
    cloudflareToken: "TEST_ONLY_NOT_A_SECRET_CLOUDFLARE_TOKEN_12345",
    fetchImpl: cloudflare.fetchImpl,
  });
  assert.equal(google.counts.property, 1);
  assert.equal(google.counts.stream, 1);
  assert.equal(cloudflare.createCount, 1);
});

test("stops when multiple streams match the canonical URL", async () => {
  const root = await tempDirectory();
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const google = new FakeGoogle();
  google.properties = [
    { name: "properties/1", parent: "accounts/123456789", displayName: "One" },
    { name: "properties/2", parent: "accounts/123456789", displayName: "Two" },
  ];
  google.streams.set("properties/1", [
    { name: "streams/1", webStreamData: { defaultUri: "https://example.com/" } },
  ]);
  google.streams.set("properties/2", [
    { name: "streams/2", webStreamData: { defaultUri: "https://example.com/" } },
  ]);
  await assert.rejects(
    () =>
      applyProvisioning({
        config,
        google,
        accountId: "123456789",
        accountName: "Example Analytics",
        googleEmail: "owner@example.com",
      }),
    /More than one GA4 web stream matches/,
  );
});

test("buildPlan is a no-write operation", async () => {
  const root = await tempDirectory();
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const plan = await buildPlan(config);
  assert.equal(plan.completed, false);
  await assert.rejects(() => access(config.statePath), (error) => error?.code === "ENOENT");
});

test("marks only an authenticated plan as approval-ready", async () => {
  const root = await tempDirectory();
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const preliminary = await buildPlan(config);
  assert.equal(preliminary.approvalReady, false);
  assert.equal(preliminary.oauthProjectId, "example-project");
  const exact = await buildPlan(config, {
    googleEmail: "owner@example.com",
    oauthProjectId: "example-project",
    oauthClientFingerprint: "client-fingerprint",
    gaAccountName: "Example Analytics",
    gaAccountId: "123456789",
  });
  assert.equal(exact.approvalReady, true);
  assert.equal(exact.gaAccountName, "Example Analytics");
  assert.equal(exact.dnsProvider, "cloudflare");
  assert.equal(exact.canonicalUrl, "https://example.com/");
});

test("resumes a manual DNS handoff without requiring Cloudflare", async () => {
  const root = await tempDirectory();
  const config = parseSiteConfigForTest(
    validConfig({ verification: { provider: "manual" } }),
    path.join(root, "site.json"),
  );
  const google = new FakeGoogle();
  google.verifyFailures = 1;
  const reports = [];
  await assert.rejects(
    () =>
      applyProvisioning({
        config,
        google,
        accountId: "123456789",
        accountName: "Example Analytics",
        googleEmail: "owner@example.com",
        report: (message) => reports.push(message),
        verificationAttempts: 1,
        verificationDelayMs: 0,
      }),
    PendingProvisioningError,
  );
  assert.ok(reports.some((message) => message.includes("Manual DNS TXT content")));
  const state = await applyProvisioning({
    config,
    google,
    accountId: "123456789",
    accountName: "Example Analytics",
    googleEmail: "owner@example.com",
    verificationAttempts: 1,
    verificationDelayMs: 0,
  });
  assert.equal(state.completed, true);
  assert.equal(state.cloudflareZoneId, undefined);
  assert.equal(state.cloudflareDnsRecordId, undefined);
  assert.equal(google.counts.verificationToken, 1);
});
