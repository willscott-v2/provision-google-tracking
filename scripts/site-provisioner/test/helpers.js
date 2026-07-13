import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function tempDirectory(prefix = "site-provisioner-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export function validConfig(overrides = {}) {
  return {
    displayName: "Example Site",
    domain: "example.com",
    canonicalUrl: "https://example.com/",
    sitemapUrl: "https://example.com/sitemap.xml",
    timeZone: "America/Chicago",
    currencyCode: "USD",
    expectedGoogleEmail: "owner@example.com",
    expectedGoogleCloudProjectId: "example-project",
    gaAccountId: "123456789",
    verification: { provider: "cloudflare" },
    ...overrides,
  };
}

export function desktopClient(overrides = {}) {
  return {
    installed: {
      client_id: "test-only-client.apps.googleusercontent.com",
      client_secret: "TEST_ONLY_NOT_A_SECRET_CLIENT_VALUE",
      project_id: "example-project",
      auth_uri: "https://accounts.example.test/auth",
      token_uri: "https://oauth.example.test/token",
      redirect_uris: ["http://localhost"],
      ...overrides,
    },
  };
}

export async function writeJson(filePath, value, mode = 0o600) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  return filePath;
}

export async function readFixture(name) {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
