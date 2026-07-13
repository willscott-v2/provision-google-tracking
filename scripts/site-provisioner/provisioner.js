import { CloudflareClient } from "./cloudflare.js";
import { isApiStatus } from "./google.js";
import { loadState, saveState } from "./state.js";

export class PendingProvisioningError extends Error {
  constructor(message) {
    super(message);
    this.name = "PendingProvisioningError";
    this.exitCode = 2;
  }
}

function sameWebUrl(left, right) {
  if (!left) return false;
  try {
    const a = new URL(left);
    const b = new URL(right);
    const normalizePath = (pathname) => pathname.replace(/\/+$/, "") || "/";
    return (
      a.protocol === b.protocol &&
      a.hostname.toLowerCase() === b.hostname.toLowerCase() &&
      normalizePath(a.pathname) === normalizePath(b.pathname)
    );
  } catch {
    return false;
  }
}

async function findExistingGaSetup(google, accountId, config) {
  const properties = await google.listProperties(accountId);
  const matches = [];
  const named = [];
  for (const property of properties) {
    const streams = await google.listDataStreams(property.name);
    if (property.displayName === config.displayName) named.push({ property, streams });
    for (const stream of streams) {
      if (sameWebUrl(stream.webStreamData?.defaultUri, config.canonicalUrl)) {
        matches.push({ property, stream });
      }
    }
  }
  if (matches.length > 1) {
    throw new Error(
      `More than one GA4 web stream matches ${config.canonicalUrl}; select one manually`,
    );
  }
  if (matches.length === 1) return matches[0];
  if (named.length > 1) {
    throw new Error(
      `More than one GA4 property is named ${config.displayName}; use saved state or resolve the ambiguity manually`,
    );
  }
  if (named.length === 1) {
    const only = named[0];
    if (only.streams.length === 0) return { property: only.property };
    throw new Error(
      `A GA4 property named ${config.displayName} exists but its web stream does not match ${config.canonicalUrl}`,
    );
  }
  return {};
}

async function ensureAnalytics(input) {
  const { config, state, google, accountId, report } = input;
  let property;
  let stream;
  if (state.gaPropertyName) {
    property = await google.getProperty(state.gaPropertyName);
    report(`Resuming GA4 property ${property.name}`);
  } else {
    const existing = await findExistingGaSetup(google, accountId, config);
    property = existing.property;
    stream = existing.stream;
    if (property) report(`Reusing GA4 property ${property.name}`);
    if (stream) report(`Reusing GA4 web stream ${stream.name}`);
  }
  if (!property) {
    const created = await google.createProperty({
      accountId,
      displayName: config.displayName,
      timeZone: config.timeZone,
      currencyCode: config.currencyCode,
    });
    property = await google.getProperty(created.name);
    if (property.parent !== `accounts/${accountId}`) {
      throw new Error(`Created GA4 property ${property.name} has an unexpected parent`);
    }
    report(`Created and verified GA4 property ${property.name}`);
  }
  state.gaPropertyName = property.name;
  state.gaAccountId = accountId;
  state.gaAccountName = input.accountName;
  await saveState(config.statePath, state);
  if (!stream && state.gaDataStreamName) {
    const streams = await google.listDataStreams(property.name);
    stream = streams.find((candidate) => candidate.name === state.gaDataStreamName);
    if (!stream) {
      throw new Error(
        `Saved GA4 stream ${state.gaDataStreamName} no longer exists; refusing to create a duplicate`,
      );
    }
    report(`Resuming GA4 web stream ${stream.name}`);
  }
  if (!stream) {
    const streams = await google.listDataStreams(property.name);
    const matches = streams.filter((candidate) =>
      sameWebUrl(candidate.webStreamData?.defaultUri, config.canonicalUrl),
    );
    if (matches.length > 1) {
      throw new Error(`Multiple GA4 streams match ${config.canonicalUrl}`);
    }
    stream = matches[0];
  }
  if (!stream) {
    const created = await google.createWebDataStream({
      propertyName: property.name,
      displayName: `${config.displayName} Web`,
      defaultUri: config.canonicalUrl,
    });
    stream = (await google.listDataStreams(property.name)).find(
      (candidate) => candidate.name === created.name,
    );
    if (!stream) {
      throw new PendingProvisioningError(
        `GA4 created stream ${created.name}, but it is not readable yet. Rerun apply; do not create another stream.`,
      );
    }
    report(`Created and verified GA4 web stream ${stream.name}`);
  }
  const measurementId = stream.webStreamData?.measurementId;
  if (!measurementId) {
    throw new PendingProvisioningError(
      `GA4 stream ${stream.name} has no readable measurement ID yet. Rerun apply.`,
    );
  }
  state.gaDataStreamName = stream.name;
  state.measurementId = measurementId;
  await saveState(config.statePath, state);
}

async function ensureVerification(input) {
  const { config, state, google, report } = input;
  if (state.verificationResourceId) {
    await google.getVerifiedResource(state.verificationResourceId);
    report(`Resuming verified domain resource ${state.verificationResourceId}`);
    return;
  }
  const existing = (await google.listVerifiedResources()).find(
    (resource) =>
      resource.site?.type === "INET_DOMAIN" &&
      resource.site.identifier.toLowerCase() === config.domain,
  );
  if (existing) {
    state.verificationResourceId = existing.id;
    report(`Reusing verified domain resource ${existing.id}`);
    await saveState(config.statePath, state);
    return;
  }
  if (!state.verificationToken) {
    state.verificationToken = await google.getDomainVerificationToken(config.domain);
    report("Received Google DNS verification token");
    await saveState(config.statePath, state);
  }
  if (config.verification.provider === "cloudflare") {
    const token = input.cloudflareToken?.trim();
    if (!token) {
      throw new PendingProvisioningError(
        `A domain-bound Cloudflare token is required for ${config.domain}. Save one, then rerun apply.`,
      );
    }
    const cloudflare = new CloudflareClient(token, input.fetchImpl);
    const record = await cloudflare.ensureVerificationTxt({
      domain: config.domain,
      content: state.verificationToken,
      ...(state.cloudflareZoneId ? { knownZoneId: state.cloudflareZoneId } : {}),
      ...(state.cloudflareDnsRecordId
        ? { knownRecordId: state.cloudflareDnsRecordId }
        : {}),
    });
    state.cloudflareZoneId = record.zoneId;
    state.cloudflareDnsRecordId = record.recordId;
    report(
      `${record.reused ? "Reused" : "Created"} Cloudflare verification TXT record ${record.recordId}`,
    );
    await saveState(config.statePath, state);
  } else {
    report(`Manual DNS action: add a TXT record at ${config.domain}`);
    report(`Manual DNS TXT content: ${state.verificationToken}`);
  }
  const attempts = input.verificationAttempts ?? 6;
  const delayMs = input.verificationDelayMs ?? 5_000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const verified = await google.verifyDomain(config.domain);
      const readBack = await google.getVerifiedResource(verified.id);
      state.verificationResourceId = readBack.id;
      report(`Verified domain ownership as ${readBack.id}`);
      await saveState(config.statePath, state);
      return;
    } catch (error) {
      if (!isApiStatus(error, 400) || attempt === attempts) {
        if (isApiStatus(error, 400)) break;
        throw error;
      }
      report(`DNS verification is not visible yet; retrying (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new PendingProvisioningError(
    config.verification.provider === "cloudflare"
      ? "The TXT record exists, but Google cannot see it yet. Wait for DNS propagation and rerun apply; no duplicate record will be created."
      : "Google cannot see the manual TXT record yet. Add or confirm the saved record, wait for DNS propagation, and rerun apply.",
  );
}

async function ensureSearchConsole(input) {
  const { config, state, google, report } = input;
  const siteUrl = `sc-domain:${config.domain}`;
  let sites = await google.listSearchConsoleSites();
  if (!sites.some((site) => site.siteUrl === siteUrl)) {
    await google.addSearchConsoleSite(siteUrl);
    sites = await google.listSearchConsoleSites();
    if (!sites.some((site) => site.siteUrl === siteUrl)) {
      throw new PendingProvisioningError(
        `Search Console accepted ${siteUrl}, but it is not readable yet. Rerun apply.`,
      );
    }
    report(`Added and verified Search Console property ${siteUrl}`);
  } else {
    report(`Reusing Search Console property ${siteUrl}`);
  }
  state.searchConsoleProperty = siteUrl;
  await saveState(config.statePath, state);
  let sitemaps = await google.listSitemaps(siteUrl);
  if (!sitemaps.some((sitemap) => sitemap.path === config.sitemapUrl)) {
    await google.submitSitemap(siteUrl, config.sitemapUrl);
    sitemaps = await google.listSitemaps(siteUrl);
    if (!sitemaps.some((sitemap) => sitemap.path === config.sitemapUrl)) {
      throw new PendingProvisioningError(
        `Search Console accepted ${config.sitemapUrl}, but the submission is not readable yet. Rerun apply.`,
      );
    }
    report(`Submitted and verified sitemap ${config.sitemapUrl}`);
  } else {
    report(`Reusing sitemap submission ${config.sitemapUrl}`);
  }
  state.sitemapSubmitted = true;
  state.completed = true;
  await saveState(config.statePath, state);
}

export async function applyProvisioning(options) {
  const report = options.report ?? (() => undefined);
  const state = await loadState(options.config.statePath, options.config.domain);
  if (state.googleEmail && state.googleEmail !== options.googleEmail.toLowerCase()) {
    throw new Error(
      `Saved state belongs to ${state.googleEmail}, not ${options.googleEmail.toLowerCase()}`,
    );
  }
  if (state.gaAccountId && state.gaAccountId !== options.accountId) {
    throw new Error(
      `Saved state uses Analytics account ${state.gaAccountId}, not ${options.accountId}`,
    );
  }
  state.googleEmail = options.googleEmail.toLowerCase();
  state.gaAccountId = options.accountId;
  await saveState(options.config.statePath, state);
  await ensureAnalytics({
    config: options.config,
    state,
    google: options.google,
    accountId: options.accountId,
    accountName: options.accountName,
    report,
  });
  await ensureVerification({
    config: options.config,
    state,
    google: options.google,
    report,
    cloudflareToken: options.cloudflareToken,
    fetchImpl: options.fetchImpl,
    verificationAttempts: options.verificationAttempts,
    verificationDelayMs: options.verificationDelayMs,
  });
  await ensureSearchConsole({
    config: options.config,
    state,
    google: options.google,
    report,
  });
  return state;
}

export async function buildPlan(config, context = {}) {
  const state = await loadState(config.statePath, config.domain);
  const actions = [];
  if (!state.measurementId) actions.push("Create or reuse a GA4 property and web stream");
  if (!state.verificationResourceId) {
    actions.push(
      config.verification.provider === "cloudflare"
        ? "Create or reuse the exact Cloudflare verification TXT record"
        : "Generate a Google verification token for owner-managed DNS handoff",
    );
    actions.push("Verify Google ownership of the root domain");
  }
  if (!state.searchConsoleProperty) {
    actions.push(`Add Search Console Domain property sc-domain:${config.domain}`);
  }
  if (!state.sitemapSubmitted) actions.push(`Submit ${config.sitemapUrl}`);
  if (actions.length === 0) actions.push("No provisioning writes; saved state is complete");
  return {
    displayName: config.displayName,
    domain: config.domain,
    canonicalUrl: config.canonicalUrl,
    sitemapUrl: config.sitemapUrl,
    actingGoogleEmail: context.googleEmail ?? config.expectedGoogleEmail,
    oauthProjectId:
      context.oauthProjectId ?? config.expectedGoogleCloudProjectId ?? null,
    oauthClientFingerprint: context.oauthClientFingerprint ?? null,
    gaAccountName: context.gaAccountName ?? null,
    gaAccountId: context.gaAccountId ?? config.gaAccountId ?? null,
    dnsProvider: config.verification.provider,
    dnsZone: config.domain,
    statePath: config.statePath,
    actions,
    completed: state.completed ?? false,
    approvalReady: Boolean(
      context.googleEmail &&
        context.oauthProjectId &&
        context.oauthClientFingerprint &&
        context.gaAccountName &&
        context.gaAccountId,
    ),
    manualNextSteps: [
      "Install or hand off the Google tag",
      "Link GA4 to Search Console in Analytics Admin",
      "Run authenticated validation and verify the product link in the browser",
    ],
  };
}
