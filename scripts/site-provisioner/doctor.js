import { stat } from "node:fs/promises";
import path from "node:path";
import {
  loadOAuthClient,
  tokenPathForClient,
} from "./auth.js";
import {
  cloudflareTokenPathForDomain,
  loadCloudflareToken,
} from "./credentials.js";

function check(id, status, summary, details) {
  return { id, status, summary, ...(details ? { details } : {}) };
}

async function permissionCheck(filePath, id, label, required = false) {
  try {
    const metadata = await stat(filePath);
    const extra = metadata.mode & 0o077;
    if (extra !== 0) {
      return check(
        id,
        "pending",
        `${label} is readable by group or other users`,
        `Set owner-only permissions on ${filePath}`,
      );
    }
    return check(id, "pass", `${label} uses owner-only permissions`);
  } catch (error) {
    if (error?.code === "ENOENT" && !required) {
      return check(id, "skipped", `${label} is not present yet`);
    }
    if (error?.code === "ENOENT") {
      return check(id, "fail", `${label} does not exist`, filePath);
    }
    return check(id, "fail", `${label} could not be inspected`, error.message);
  }
}

async function onlineSiteChecks(config, fetchImpl) {
  const checks = [];
  try {
    const response = await fetchImpl(config.canonicalUrl, { redirect: "follow" });
    checks.push(
      response.ok
        ? check("canonical-url", "pass", `${config.canonicalUrl} returned ${response.status}`)
        : check(
            "canonical-url",
            "fail",
            `${config.canonicalUrl} returned ${response.status}`,
          ),
    );
  } catch (error) {
    checks.push(
      check("canonical-url", "fail", "Canonical URL request failed", error.message),
    );
  }
  try {
    const response = await fetchImpl(config.sitemapUrl, { redirect: "follow" });
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const looksXml = /<(?:\?xml|urlset|sitemapindex)\b/i.test(body.slice(0, 2_000));
    if (!response.ok) {
      checks.push(
        check(
          "sitemap-url",
          "fail",
          `${config.sitemapUrl} returned ${response.status}`,
        ),
      );
    } else if (!looksXml) {
      checks.push(
        check(
          "sitemap-url",
          "fail",
          "Sitemap response does not look like XML",
          `Content-Type: ${contentType || "missing"}`,
        ),
      );
    } else {
      checks.push(
        check(
          "sitemap-url",
          "pass",
          "Sitemap is reachable and looks like XML",
          `Content-Type: ${contentType || "missing"}`,
        ),
      );
    }
  } catch (error) {
    checks.push(check("sitemap-url", "fail", "Sitemap request failed", error.message));
  }
  return checks;
}

export async function runDoctor(options) {
  const { config } = options;
  const checks = [];
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  checks.push(
    major >= 20
      ? check("node", "pass", `Node.js ${process.versions.node} is supported`)
      : check("node", "fail", `Node.js 20 or newer is required; found ${process.versions.node}`),
  );
  checks.push(check("config", "pass", `Configuration is valid for ${config.domain}`));
  const configDirectory = path.dirname(config.sourcePath);
  const relativeState = path.relative(configDirectory, config.statePath);
  checks.push(
    !relativeState.startsWith("..") && !path.isAbsolute(relativeState)
      ? check("state-path", "pass", "State file stays beside the controlled configuration")
      : check(
          "state-path",
          "pending",
          "State file is outside the configuration directory",
          config.statePath,
        ),
  );
  let client;
  if (!options.oauthClientPath) {
    checks.push(
      check(
        "oauth-client",
        "pending",
        "No Desktop OAuth client path was supplied",
        "Create or select a Google Cloud Desktop OAuth client before auth",
      ),
    );
  } else {
    try {
      client = await loadOAuthClient(options.oauthClientPath);
      if (
        config.expectedGoogleCloudProjectId &&
        client.projectId &&
        client.projectId !== config.expectedGoogleCloudProjectId
      ) {
        checks.push(
          check(
            "oauth-client",
            "fail",
            "OAuth client project does not match the configured project",
            `Expected ${config.expectedGoogleCloudProjectId}; found ${client.projectId}`,
          ),
        );
      } else {
        checks.push(
          check(
            "oauth-client",
            "pass",
            "Desktop OAuth client is valid",
            `Project: ${client.projectId ?? "not included in client file"}; fingerprint: ${client.fingerprint}`,
          ),
        );
      }
      checks.push(
        await permissionCheck(
          client.sourcePath,
          "oauth-client-permissions",
          "OAuth client file",
          true,
        ),
      );
      checks.push(
        await permissionCheck(
          tokenPathForClient(config.expectedGoogleEmail, client.clientId),
          "oauth-token",
          "Client-scoped OAuth token",
        ),
      );
    } catch (error) {
      checks.push(check("oauth-client", "fail", "OAuth client is not usable", error.message));
    }
  }
  if (config.verification.provider === "manual") {
    checks.push(
      check(
        "dns-provider",
        "pass",
        "Manual DNS handoff is configured; no Cloudflare credential is required",
      ),
    );
  } else {
    try {
      const credential = await loadCloudflareToken({
        domain: config.domain,
        tokenFile: options.cloudflareTokenFile,
      });
      checks.push(
        credential
          ? check(
              "cloudflare-token",
              "pass",
              `A Cloudflare token is available for ${config.domain}`,
              credential.source,
            )
          : check(
              "cloudflare-token",
              "pending",
              `No Cloudflare token is stored for ${config.domain} yet`,
              cloudflareTokenPathForDomain(config.domain),
            ),
      );
    } catch (error) {
      checks.push(
        check("cloudflare-token", "fail", "Cloudflare token is not usable", error.message),
      );
    }
  }
  if (options.online) {
    checks.push(...(await onlineSiteChecks(config, options.fetchImpl ?? fetch)));
  } else {
    checks.push(
      check("online-site", "skipped", "Public site checks were not requested; use --online"),
    );
  }
  return {
    domain: config.domain,
    checks,
    failed: checks.some((item) => item.status === "fail"),
    pending: checks.some((item) => item.status === "pending"),
  };
}
