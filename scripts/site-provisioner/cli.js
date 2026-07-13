#!/usr/bin/env node
import process from "node:process";
import { createInterface } from "node:readline/promises";
import {
  authorize,
  BASE_GOOGLE_SCOPES,
  TokenManager,
  USER_MANAGEMENT_SCOPE,
} from "./auth.js";
import { buildAccessPlan, grantAccess } from "./access.js";
import { loadSiteConfig } from "./config.js";
import {
  loadCloudflareToken,
  saveCloudflareToken,
} from "./credentials.js";
import { runDoctor } from "./doctor.js";
import { GoogleClient } from "./google.js";
import {
  applyProvisioning,
  buildPlan,
  PendingProvisioningError,
} from "./provisioner.js";
import { safeErrorMessage } from "./security.js";
import { loadState } from "./state.js";
import { googleTagSnippet, installStaticTag } from "./tag.js";
import { validateProvisioning } from "./validation.js";

function parseArgs(argv) {
  const options = new Map();
  let command;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!command && !argument.startsWith("--")) {
      command = argument;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const equals = argument.indexOf("=");
    if (equals !== -1) {
      options.set(argument.slice(2, equals), argument.slice(equals + 1));
      continue;
    }
    const name = argument.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(name, next);
      index += 1;
    } else {
      options.set(name, true);
    }
  }
  return { command, options };
}

function stringOption(args, name, required = false) {
  const value = args.options.get(name);
  if (typeof value === "boolean") throw new Error(`--${name} requires a value`);
  if (value === undefined && required) throw new Error(`--${name} is required`);
  return value;
}

function flag(args, name) {
  return args.options.get(name) === true;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function output(args, message) {
  const stream = flag(args, "json") ? process.stderr : process.stdout;
  stream.write(`${message}\n`);
}

function printHelp() {
  process.stdout.write(`provision-google-tracking

Commands:
  doctor            Check local prerequisites and optional public site readiness
  auth              Authorize a Google identity with a Desktop OAuth client
  cloudflare-token  Save a domain-bound Cloudflare token from standard input
  accounts          List Analytics accounts visible to the authorized identity
  plan              Show base provisioning work without remote writes
  apply             Create or resume GA4, verification, Search Console, and sitemap
  status            Show saved non-secret state
  install-tag       Print or install the saved GA4 tag
  access-plan       Show optional GA4 admin and Search Console owner grants
  grant-access      Apply and verify the optional access grants
  validate          Read back Google, DNS, Cloudflare, sitemap, and live-tag evidence

Common options:
  --config PATH             Site JSON configuration
  --oauth-client PATH       Google Desktop OAuth client JSON
  --cloudflare-token-file PATH  Explicit domain-bound Cloudflare token file
  --json                    Print machine-readable output
  --dry-run                 Show work without writes
  --yes                     Skip typed confirmation after separate plan approval

Auth options:
  --email ADDRESS           Expected Google identity
  --manage-users            Also request GA4 user-management scope
  --no-open                 Print the OAuth URL without opening a browser

Other options:
  --domain DOMAIN           Domain for cloudflare-token
  --account ID              Analytics account ID for authenticated planning/apply
  --online                  Include public URL checks in doctor
  --target-email ADDRESS    Google Account for access-plan or grant-access
  --site-dir PATH           Static HTML directory for install-tag
  --measurement-id ID       Print/install a supplied GA4 measurement ID
  --replace-measurement-id  Replace a different tag inside managed markers

Secret values are never accepted as command-line arguments.
`);
}

async function promptLine(question) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

async function chooseAccount(accounts) {
  if (accounts.length === 0) {
    throw new Error(
      "The authorized Google identity has no Analytics account. Create one in Analytics or obtain access, then retry.",
    );
  }
  if (!process.stdin.isTTY) {
    throw new Error("Set gaAccountId in the site config for non-interactive execution");
  }
  process.stdout.write("\nAccessible Google Analytics accounts:\n");
  accounts.forEach((account, index) => {
    process.stdout.write(
      `  ${index + 1}. ${account.displayName} (${account.account.replace(/^accounts\//, "")})\n`,
    );
  });
  const answer = await promptLine("Choose an account number: ");
  const selected = accounts[Number.parseInt(answer, 10) - 1];
  if (!selected) throw new Error("Invalid Analytics account selection");
  return selected;
}

async function resolveAccount(args, config, google) {
  const accounts = await google.listAnalyticsAccounts();
  const requested = stringOption(args, "account") ?? config.gaAccountId;
  if (!requested) return chooseAccount(accounts);
  const normalized = requested.replace(/^accounts\//, "");
  const account = accounts.find(
    (candidate) => candidate.account.replace(/^accounts\//, "") === normalized,
  );
  if (!account) {
    throw new Error(`Analytics account ${normalized} is not accessible to this identity`);
  }
  return account;
}

async function authenticatedGoogle(args, config, requiredScopes = BASE_GOOGLE_SCOPES) {
  const clientPath = stringOption(args, "oauth-client", true);
  const email = (
    stringOption(args, "email") ?? config?.expectedGoogleEmail
  )?.toLowerCase();
  if (!email) throw new Error("--email is required when no site config is supplied");
  const manager = await TokenManager.create(clientPath, email);
  if (
    config?.expectedGoogleCloudProjectId &&
    manager.client.projectId &&
    manager.client.projectId !== config.expectedGoogleCloudProjectId
  ) {
    throw new Error(
      `OAuth client project ${manager.client.projectId} does not match ${config.expectedGoogleCloudProjectId}`,
    );
  }
  await manager.assertScopes(requiredScopes);
  await manager.getAccessToken();
  return { google: new GoogleClient(manager), email, manager };
}

async function commandDoctor(args) {
  const config = await loadSiteConfig(stringOption(args, "config", true));
  const result = await runDoctor({
    config,
    oauthClientPath: stringOption(args, "oauth-client"),
    cloudflareTokenFile: stringOption(args, "cloudflare-token-file"),
    online: flag(args, "online"),
  });
  if (flag(args, "json")) printJson(result);
  else {
    process.stdout.write(`Readiness checks for ${config.domain}:\n`);
    for (const item of result.checks) {
      process.stdout.write(`- ${item.status.toUpperCase()}: ${item.summary}\n`);
      if (item.details) process.stdout.write(`  ${item.details}\n`);
    }
  }
  if (result.failed) process.exitCode = 1;
  else if (result.pending) process.exitCode = 2;
}

async function commandAuth(args) {
  const clientPath = stringOption(args, "oauth-client", true);
  const email = stringOption(args, "email", true).toLowerCase();
  const token = await authorize({
    clientPath,
    expectedEmail: email,
    manageUsers: flag(args, "manage-users"),
    openBrowser: !flag(args, "no-open"),
    onAuthorizationUrl: (url) => output(args, `Authorize ${email} at:\n${url}`),
  });
  const result = {
    email: token.email,
    tokenPath: token.tokenPath,
    clientFingerprint: token.clientFingerprint,
    projectId: token.projectId,
    scopes: token.scopes,
  };
  if (flag(args, "json")) printJson(result);
  else output(args, `Authorized ${result.email}. Token saved to ${result.tokenPath}`);
}

async function commandCloudflareToken(args) {
  if (process.stdin.isTTY) {
    throw new Error("Pipe the token through standard input so it is not printed or saved in shell history");
  }
  const domain = stringOption(args, "domain", true);
  let token = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) token += chunk;
  const savedPath = await saveCloudflareToken({
    token,
    domain,
    targetPath: stringOption(args, "token-file"),
  });
  process.stdout.write(`Cloudflare token saved for ${domain} with owner-only permissions: ${savedPath}\n`);
}

async function commandAccounts(args) {
  const { google, email, manager } = await authenticatedGoogle(args);
  const accounts = await google.listAnalyticsAccounts();
  const result = {
    email,
    projectId: manager.client.projectId,
    clientFingerprint: manager.client.fingerprint,
    accounts,
  };
  if (flag(args, "json")) printJson(result);
  else {
    process.stdout.write(`Analytics accounts visible to ${email}:\n`);
    for (const account of accounts) {
      process.stdout.write(
        `- ${account.displayName}: ${account.account.replace(/^accounts\//, "")}\n`,
      );
    }
  }
}

async function commandPlan(args) {
  const config = await loadSiteConfig(stringOption(args, "config", true));
  let plan;
  if (stringOption(args, "oauth-client")) {
    const { google, email, manager } = await authenticatedGoogle(args, config);
    const account = await resolveAccount(args, config, google);
    plan = await buildPlan(config, {
      googleEmail: email,
      oauthProjectId: manager.client.projectId,
      oauthClientFingerprint: manager.client.fingerprint,
      gaAccountName: account.displayName,
      gaAccountId: account.account.replace(/^accounts\//, ""),
    });
  } else {
    plan = await buildPlan(config);
  }
  if (flag(args, "json")) printJson(plan);
  else {
    process.stdout.write(
      `${plan.approvalReady ? "Approval-ready" : "Preliminary"} plan for ${config.displayName}:\n`,
    );
    process.stdout.write(`Google identity: ${plan.actingGoogleEmail}\n`);
    process.stdout.write(`OAuth Cloud project: ${plan.oauthProjectId ?? "not verified"}\n`);
    process.stdout.write(`OAuth client fingerprint: ${plan.oauthClientFingerprint ?? "not verified"}\n`);
    process.stdout.write(
      `Analytics account: ${plan.gaAccountName ?? "not verified"} (${plan.gaAccountId ?? "not selected"})\n`,
    );
    process.stdout.write(`Domain and DNS zone: ${plan.domain}\n`);
    process.stdout.write(`Canonical URL: ${plan.canonicalUrl}\n`);
    process.stdout.write(`Sitemap URL: ${plan.sitemapUrl}\n`);
    process.stdout.write(`DNS provider: ${plan.dnsProvider}\n`);
    process.stdout.write("Planned writes:\n");
    plan.actions.forEach((action) => process.stdout.write(`- ${action}\n`));
    process.stdout.write(`State: ${plan.statePath}\n`);
    if (!plan.approvalReady) {
      process.stdout.write(
        "This preliminary plan is not sufficient for write approval. Rerun with --oauth-client after authorization.\n",
      );
    }
    process.stdout.write("Manual work after provisioning:\n");
    plan.manualNextSteps.forEach((action) => process.stdout.write(`- ${action}\n`));
  }
}

async function commandApply(args) {
  const config = await loadSiteConfig(stringOption(args, "config", true));
  let plan = await buildPlan(config);
  if (flag(args, "dry-run")) {
    printJson(plan);
    return;
  }
  const { google, email, manager } = await authenticatedGoogle(args, config);
  const account = await resolveAccount(args, config, google);
  const accountId = account.account.replace(/^accounts\//, "");
  plan = await buildPlan(config, {
    googleEmail: email,
    oauthProjectId: manager.client.projectId,
    oauthClientFingerprint: manager.client.fingerprint,
    gaAccountName: account.displayName,
    gaAccountId: accountId,
  });
  if (!plan.approvalReady) {
    throw new Error(
      "The authenticated plan is missing OAuth project or account metadata; refusing writes",
    );
  }
  output(args, `Google identity: ${email}`);
  output(args, `OAuth Cloud project: ${plan.oauthProjectId}`);
  output(args, `OAuth client fingerprint: ${plan.oauthClientFingerprint}`);
  output(args, `Analytics account: ${account.displayName} (${accountId})`);
  output(args, `Domain: ${config.domain}`);
  output(args, `Canonical URL: ${config.canonicalUrl}`);
  output(args, `Sitemap URL: ${config.sitemapUrl}`);
  output(args, `DNS provider and zone: ${config.verification.provider} / ${config.domain}`);
  output(args, "Planned writes:");
  plan.actions.forEach((action) => output(args, `- ${action}`));
  if (!flag(args, "yes")) {
    const answer = await promptLine(`Type ${config.domain} to apply these changes: `);
    if (answer !== config.domain) throw new Error("Confirmation did not match; no changes made");
  }
  const credential =
    config.verification.provider === "cloudflare"
      ? await loadCloudflareToken({
          domain: config.domain,
          tokenFile: stringOption(args, "cloudflare-token-file"),
        })
      : undefined;
  const state = await applyProvisioning({
    config,
    google,
    accountId,
    accountName: account.displayName,
    googleEmail: email,
    cloudflareToken: credential?.token,
    report: (message) => output(args, message),
  });
  if (flag(args, "json")) printJson(state);
  else output(args, `Provisioning complete. Measurement ID: ${state.measurementId}`);
}

async function commandStatus(args) {
  const config = await loadSiteConfig(stringOption(args, "config", true));
  printJson(await loadState(config.statePath, config.domain));
}

async function commandInstallTag(args) {
  const config = await loadSiteConfig(stringOption(args, "config", true));
  const state = await loadState(config.statePath, config.domain);
  const measurementId = stringOption(args, "measurement-id") ?? state.measurementId;
  if (!measurementId) throw new Error("No measurement ID is saved; run apply or pass --measurement-id");
  const siteDirectory = stringOption(args, "site-dir") ?? config.staticSiteDirectory;
  if (!siteDirectory) {
    process.stdout.write(`${googleTagSnippet(measurementId)}\n`);
    return;
  }
  const dryRun = flag(args, "dry-run");
  if (!dryRun && !flag(args, "yes")) {
    const answer = await promptLine(
      `Type ${config.domain} to modify HTML in ${siteDirectory}: `,
    );
    if (answer !== config.domain) throw new Error("Confirmation did not match; no files changed");
  }
  printJson(
    await installStaticTag({
      root: siteDirectory,
      measurementId,
      dryRun,
      replaceMeasurementId: flag(args, "replace-measurement-id"),
    }),
  );
}

async function commandAccessPlan(args) {
  const config = await loadSiteConfig(stringOption(args, "config", true));
  const plan = await buildAccessPlan(config, stringOption(args, "target-email", true));
  if (flag(args, "json")) printJson(plan);
  else {
    process.stdout.write(`Access plan for ${plan.targetEmail}:\n`);
    plan.actions.forEach((action) => process.stdout.write(`- ${action}\n`));
    process.stdout.write(`Confirmation: ${plan.confirmation}\n`);
  }
}

async function commandGrantAccess(args) {
  const config = await loadSiteConfig(stringOption(args, "config", true));
  const targetEmail = stringOption(args, "target-email", true);
  const plan = await buildAccessPlan(config, targetEmail);
  if (flag(args, "dry-run")) {
    printJson(plan);
    return;
  }
  const requiredScopes = [...BASE_GOOGLE_SCOPES, USER_MANAGEMENT_SCOPE];
  const { google, email } = await authenticatedGoogle(args, config, requiredScopes);
  output(args, `Granting access as ${email}`);
  plan.actions.forEach((action) => output(args, `- ${action}`));
  if (!flag(args, "yes")) {
    const answer = await promptLine(`Type ${plan.confirmation} to grant access: `);
    if (answer !== plan.confirmation) {
      throw new Error("Confirmation did not match; no permission changes made");
    }
  }
  const result = await grantAccess({
    config,
    google,
    targetEmail,
    report: (message) => output(args, message),
  });
  if (flag(args, "json")) printJson(result);
  else output(args, `Access grants verified for ${result.targetEmail}`);
}

async function commandValidate(args) {
  const config = await loadSiteConfig(stringOption(args, "config", true));
  const { google } = await authenticatedGoogle(args, config);
  const credential =
    config.verification.provider === "cloudflare"
      ? await loadCloudflareToken({
          domain: config.domain,
          tokenFile: stringOption(args, "cloudflare-token-file"),
        })
      : undefined;
  const result = await validateProvisioning({
    config,
    google,
    cloudflareToken: credential?.token,
  });
  if (flag(args, "json")) printJson(result);
  else {
    process.stdout.write(`Validation for ${config.domain}:\n`);
    for (const item of result.checks) {
      process.stdout.write(`- ${item.status.toUpperCase()}: ${item.summary}\n`);
      if (item.details) process.stdout.write(`  ${item.details}\n`);
    }
  }
  if (result.failed > 0) process.exitCode = 1;
  else if (result.pending > 0) process.exitCode = 2;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "doctor":
      return commandDoctor(args);
    case "auth":
      return commandAuth(args);
    case "cloudflare-token":
      return commandCloudflareToken(args);
    case "accounts":
      return commandAccounts(args);
    case "plan":
      return commandPlan(args);
    case "apply":
      return commandApply(args);
    case "status":
      return commandStatus(args);
    case "install-tag":
      return commandInstallTag(args);
    case "access-plan":
      return commandAccessPlan(args);
    case "grant-access":
      return commandGrantAccess(args);
    case "validate":
      return commandValidate(args);
    case "help":
    case undefined:
      return printHelp();
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}

main().catch((error) => {
  const environmentToken = process.env.CLOUDFLARE_API_TOKEN;
  process.stderr.write(
    `${safeErrorMessage(error, environmentToken ? [environmentToken] : [])}\n`,
  );
  process.exitCode = error instanceof PendingProvisioningError ? error.exitCode : 1;
});
