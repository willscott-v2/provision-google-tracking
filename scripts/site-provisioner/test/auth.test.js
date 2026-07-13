import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  authorizationScopes,
  BASE_GOOGLE_SCOPES,
  legacyTokenPathForEmail,
  loadOAuthClient,
  oauthClientFingerprint,
  tokenPathForClient,
  TokenManager,
  USER_MANAGEMENT_SCOPE,
} from "../auth.js";
import { desktopClient, tempDirectory, writeJson } from "./helpers.js";

test("isolates the same email across OAuth clients", () => {
  const left = tokenPathForClient("owner@example.com", "client-a");
  const right = tokenPathForClient("owner@example.com", "client-b");
  assert.notEqual(left, right);
  assert.notEqual(oauthClientFingerprint("client-a"), oauthClientFingerprint("client-b"));
});

test("accepts only Desktop OAuth client files", async () => {
  const root = await tempDirectory();
  const desktopPath = await writeJson(path.join(root, "desktop.json"), desktopClient());
  const client = await loadOAuthClient(desktopPath);
  assert.equal(client.projectId, "example-project");
  const webPath = await writeJson(path.join(root, "web.json"), {
    web: desktopClient().installed,
  });
  await assert.rejects(() => loadOAuthClient(webPath), /Desktop app credential/);
});

test("refuses to guess the issuing client for a legacy token", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = root;
  const clientPath = await writeJson(path.join(root, "desktop.json"), desktopClient());
  const legacy = legacyTokenPathForEmail("owner@example.com");
  await mkdir(path.dirname(legacy), { recursive: true });
  await writeFile(legacy, "{}\n", { mode: 0o600 });
  const manager = await TokenManager.create(clientPath, "owner@example.com");
  await assert.rejects(() => manager.getStoredEmail(), /issuing client cannot be verified/);
});

test("detects missing optional user-management scope", async () => {
  const root = await tempDirectory();
  process.env.SITE_PROVISIONER_HOME = root;
  const client = desktopClient();
  const clientPath = await writeJson(path.join(root, "desktop.json"), client);
  const tokenPath = tokenPathForClient(
    "owner@example.com",
    client.installed.client_id,
  );
  await mkdir(path.dirname(tokenPath), { recursive: true });
  await writeJson(tokenPath, {
    version: 2,
    accessToken: "TEST_ONLY_NOT_A_SECRET_ACCESS_TOKEN",
    refreshToken: "TEST_ONLY_NOT_A_SECRET_REFRESH_TOKEN",
    expiresAt: Date.now() + 60_000,
    email: "owner@example.com",
    clientFingerprint: oauthClientFingerprint(client.installed.client_id),
    scopes: ["openid", "email"],
  });
  const manager = await TokenManager.create(clientPath, "owner@example.com");
  await assert.rejects(
    () =>
      manager.assertScopes([
        "https://www.googleapis.com/auth/analytics.manage.users",
      ]),
    /missing required scopes/,
  );
});

test("expands OAuth scopes only for explicit user management", () => {
  assert.deepEqual(authorizationScopes(false), BASE_GOOGLE_SCOPES);
  const expanded = authorizationScopes(true);
  assert.deepEqual(expanded.slice(0, BASE_GOOGLE_SCOPES.length), BASE_GOOGLE_SCOPES);
  assert.equal(expanded.at(-1), USER_MANAGEMENT_SCOPE);
  assert.equal(new Set(expanded).size, expanded.length);
});
