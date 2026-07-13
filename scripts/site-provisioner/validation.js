import { resolveTxt } from "node:dns/promises";
import { CloudflareClient } from "./cloudflare.js";
import { loadState } from "./state.js";
import { inspectGoogleTags } from "./tag.js";

function result(id, status, summary, details) {
  return { id, status, summary, ...(details ? { details } : {}) };
}

async function capture(id, operation) {
  try {
    return await operation();
  } catch (error) {
    return result(id, "fail", `${id} check failed`, error.message);
  }
}

export async function validateProvisioning(options) {
  const { config, google } = options;
  const state = await loadState(config.statePath, config.domain);
  const checks = [];
  checks.push(
    await capture("ga4-property", async () => {
      if (!state.gaPropertyName) return result("ga4-property", "fail", "No GA4 property is saved");
      const property = await google.getProperty(state.gaPropertyName);
      if (property.parent !== `accounts/${state.gaAccountId}`) {
        return result("ga4-property", "fail", "GA4 property parent does not match saved account");
      }
      return result("ga4-property", "pass", `GA4 property ${property.name} is readable`);
    }),
  );
  checks.push(
    await capture("ga4-stream", async () => {
      if (!state.gaPropertyName || !state.gaDataStreamName || !state.measurementId) {
        return result("ga4-stream", "fail", "GA4 stream state is incomplete");
      }
      const streams = await google.listDataStreams(state.gaPropertyName);
      const stream = streams.find((candidate) => candidate.name === state.gaDataStreamName);
      if (!stream) return result("ga4-stream", "fail", "Saved GA4 stream is not readable");
      if (stream.webStreamData?.measurementId !== state.measurementId) {
        return result("ga4-stream", "fail", "GA4 measurement ID does not match saved state");
      }
      return result(
        "ga4-stream",
        "pass",
        `GA4 stream and measurement ID ${state.measurementId} match`,
      );
    }),
  );
  checks.push(
    await capture("domain-ownership", async () => {
      if (!state.verificationResourceId) {
        return result("domain-ownership", "fail", "No verification resource is saved");
      }
      const resource = await google.getVerifiedResource(state.verificationResourceId);
      const expectedOwner = state.googleEmail?.toLowerCase();
      const owns = expectedOwner
        ? (resource.owners ?? []).some((owner) => owner.toLowerCase() === expectedOwner)
        : false;
      return owns
        ? result(
            "domain-ownership",
            "pass",
            `${expectedOwner} is an owner of ${resource.id}`,
          )
        : result(
            "domain-ownership",
            "fail",
            "Authenticated owner is missing from the verified resource",
          );
    }),
  );
  checks.push(
    await capture("search-console", async () => {
      const siteUrl = state.searchConsoleProperty ?? `sc-domain:${config.domain}`;
      const sites = await google.listSearchConsoleSites();
      const site = sites.find((candidate) => candidate.siteUrl === siteUrl);
      if (!site) return result("search-console", "fail", `${siteUrl} is not readable`);
      if (site.permissionLevel !== "siteOwner") {
        return result(
          "search-console",
          "fail",
          `${siteUrl} permission is ${site.permissionLevel ?? "unknown"}, not siteOwner`,
        );
      }
      return result("search-console", "pass", `${siteUrl} is readable with owner access`);
    }),
  );
  checks.push(
    await capture("sitemap", async () => {
      const siteUrl = state.searchConsoleProperty ?? `sc-domain:${config.domain}`;
      const sitemaps = await google.listSitemaps(siteUrl);
      const sitemap = sitemaps.find((candidate) => candidate.path === config.sitemapUrl);
      if (!sitemap) return result("sitemap", "fail", "Configured sitemap is not submitted");
      if (sitemap.isPending) {
        return result("sitemap", "pending", "Search Console is still processing the sitemap");
      }
      const errors = Number(sitemap.errors ?? 0);
      const warnings = Number(sitemap.warnings ?? 0);
      return errors > 0
        ? result("sitemap", "fail", `Sitemap reports ${errors} errors and ${warnings} warnings`)
        : result("sitemap", "pass", `Sitemap reports ${warnings} warnings and no errors`);
    }),
  );
  checks.push(
    await capture("live-tag", async () => {
      if (!state.measurementId) return result("live-tag", "fail", "No measurement ID is saved");
      const response = await (options.fetchImpl ?? fetch)(config.canonicalUrl, {
        redirect: "follow",
      });
      if (!response.ok) {
        return result("live-tag", "fail", `Canonical page returned ${response.status}`);
      }
      const inspection = inspectGoogleTags(await response.text(), state.measurementId);
      if (!inspection.expectedPresent) {
        return result("live-tag", "fail", `${state.measurementId} is missing from live HTML`);
      }
      if (inspection.loaderCount !== 1 || inspection.managerCount > 0) {
        return result(
          "live-tag",
          "fail",
          "Live HTML has an unexpected Google tag count",
          JSON.stringify(inspection),
        );
      }
      return result("live-tag", "pass", `Live HTML contains one ${state.measurementId} loader`);
    }),
  );
  checks.push(
    await capture("public-dns", async () => {
      if (!state.verificationToken) {
        return result("public-dns", "skipped", "No DNS verification token is saved");
      }
      const rows = await (options.resolveTxtImpl ?? resolveTxt)(config.domain);
      const records = rows.map((row) => row.join(""));
      return records.includes(state.verificationToken)
        ? result("public-dns", "pass", "Public DNS contains the saved verification token")
        : result("public-dns", "fail", "Public DNS does not contain the saved token");
    }),
  );
  checks.push(
    await capture("cloudflare-record", async () => {
      if (!options.cloudflareToken) {
        return result(
          "cloudflare-record",
          "skipped",
          "No Cloudflare token was supplied for provider read-back",
        );
      }
      if (!state.cloudflareZoneId || !state.cloudflareDnsRecordId) {
        return result("cloudflare-record", "fail", "Cloudflare record state is incomplete");
      }
      const cloudflare = new CloudflareClient(
        options.cloudflareToken,
        options.fetchImpl ?? fetch,
      );
      const record = await cloudflare.getDnsRecord(
        state.cloudflareZoneId,
        state.cloudflareDnsRecordId,
      );
      return record?.type === "TXT" && record.content.replace(/^"|"$/g, "") === state.verificationToken
        ? result("cloudflare-record", "pass", `Cloudflare TXT record ${record.id} matches`)
        : result("cloudflare-record", "fail", "Cloudflare TXT record does not match saved state");
    }),
  );
  checks.push(
    result(
      "ga4-search-console-link",
      "skipped",
      "Verify the GA4 to Search Console product link in Analytics Admin",
      JSON.stringify({
        gaPropertyName: state.gaPropertyName,
        gaDataStreamName: state.gaDataStreamName,
        searchConsoleProperty: state.searchConsoleProperty,
      }),
    ),
  );
  return {
    domain: config.domain,
    checks,
    passed: checks.filter((item) => item.status === "pass").length,
    pending: checks.filter((item) => item.status === "pending").length,
    skipped: checks.filter((item) => item.status === "skipped").length,
    failed: checks.filter((item) => item.status === "fail").length,
  };
}
