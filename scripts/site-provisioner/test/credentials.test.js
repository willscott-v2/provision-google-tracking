import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  cloudflareTokenPathForDomain,
  loadCloudflareToken,
  saveCloudflareToken,
} from "../credentials.js";
import { tempDirectory } from "./helpers.js";

test("stores and loads a domain-bound Cloudflare token with 0600 permissions", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = root;
  const saved = await saveCloudflareToken({
    token: "TEST_ONLY_NOT_A_SECRET_CLOUDFLARE_TOKEN_12345",
    domain: "example.com",
  });
  assert.equal(saved, cloudflareTokenPathForDomain("example.com"));
  assert.equal((await stat(saved)).mode & 0o777, 0o600);
  const loaded = await loadCloudflareToken({ domain: "example.com" });
  assert.equal(loaded.token, "TEST_ONLY_NOT_A_SECRET_CLOUDFLARE_TOKEN_12345");
});

test("refuses a token file bound to another domain", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = root;
  const saved = await saveCloudflareToken({
    token: "TEST_ONLY_NOT_A_SECRET_CLOUDFLARE_TOKEN_12345",
    domain: "example.com",
    targetPath: path.join(root, "shared.json"),
  });
  await assert.rejects(
    () => loadCloudflareToken({ domain: "example.net", tokenFile: saved }),
    /bound to example\.com, not example\.net/,
  );
});

test("refuses legacy unbound plain-text token files", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = root;
  const tokenPath = path.join(root, "legacy-token");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(tokenPath, "TEST_ONLY_NOT_A_SECRET_CLOUDFLARE_TOKEN_12345\n", { mode: 0o600 });
  await assert.rejects(
    () => loadCloudflareToken({ domain: "example.com", tokenFile: tokenPath }),
    /not a domain-bound JSON record/,
  );
});
