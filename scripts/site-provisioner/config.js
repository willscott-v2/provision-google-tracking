import { readFile } from "node:fs/promises";
import path from "node:path";

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeDomain(input) {
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  let hostname;
  try {
    hostname = new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    throw new Error(`Invalid domain: ${input}`);
  }
  hostname = hostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) => !DOMAIN_LABEL.test(label))) {
    throw new Error(`Invalid domain: ${input}`);
  }
  return hostname;
}

export function normalizeWebUrl(input, domain) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error(`URL must use HTTP or HTTPS: ${input}`);
  }
  const hostname = normalizeDomain(url.hostname);
  if (hostname !== domain && !hostname.endsWith(`.${domain}`)) {
    throw new Error(`URL hostname ${hostname} is outside ${domain}`);
  }
  url.hash = "";
  url.search = "";
  return url.toString();
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, field) {
  return value === undefined ? undefined : requiredString(value, field);
}

function assertTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }
}

function parseConfig(value, sourcePath) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Site configuration must be a JSON object");
  }
  const displayName = requiredString(value.displayName, "displayName");
  const domain = normalizeDomain(requiredString(value.domain, "domain"));
  const canonicalUrl = normalizeWebUrl(
    requiredString(value.canonicalUrl, "canonicalUrl"),
    domain,
  );
  const sitemapUrl = normalizeWebUrl(
    requiredString(value.sitemapUrl, "sitemapUrl"),
    domain,
  );
  const timeZone = requiredString(value.timeZone, "timeZone");
  assertTimeZone(timeZone);
  const currencyCode = requiredString(value.currencyCode, "currencyCode").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new Error("currencyCode must be a three-letter ISO 4217 code");
  }
  const expectedGoogleEmail = requiredString(
    value.expectedGoogleEmail,
    "expectedGoogleEmail",
  ).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(expectedGoogleEmail)) {
    throw new Error("expectedGoogleEmail must be an email address");
  }
  const verificationProvider = value.verification?.provider;
  if (!["cloudflare", "manual"].includes(verificationProvider)) {
    throw new Error('verification.provider must be "cloudflare" or "manual"');
  }
  const directory = path.dirname(sourcePath);
  const statePath = path.resolve(
    directory,
    value.stateFile ?? path.join(".state", `${domain}.json`),
  );
  const config = {
    displayName,
    domain,
    canonicalUrl,
    sitemapUrl,
    timeZone,
    currencyCode,
    expectedGoogleEmail,
    verification: { provider: verificationProvider },
    sourcePath,
    statePath,
  };
  const gaAccountId = optionalString(value.gaAccountId, "gaAccountId")?.replace(
    /^accounts\//,
    "",
  );
  if (gaAccountId !== undefined && !/^\d+$/.test(gaAccountId)) {
    throw new Error("gaAccountId must contain digits only");
  }
  if (gaAccountId !== undefined) config.gaAccountId = gaAccountId;
  const projectId = optionalString(
    value.expectedGoogleCloudProjectId,
    "expectedGoogleCloudProjectId",
  );
  if (projectId !== undefined) config.expectedGoogleCloudProjectId = projectId;
  if (value.staticSiteDirectory !== undefined) {
    config.staticSiteDirectory = path.resolve(
      directory,
      requiredString(value.staticSiteDirectory, "staticSiteDirectory"),
    );
  }
  if (value.stateFile !== undefined) config.stateFile = value.stateFile;
  return config;
}

export async function loadSiteConfig(configPath) {
  const sourcePath = path.resolve(configPath);
  const raw = await readFile(sourcePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${sourcePath}`);
  }
  return parseConfig(parsed, sourcePath);
}

export function parseSiteConfigForTest(value, sourcePath = "/tmp/site.json") {
  return parseConfig(value, sourcePath);
}
