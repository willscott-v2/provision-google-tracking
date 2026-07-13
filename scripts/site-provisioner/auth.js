import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { requestJson } from "./http.js";

export const BASE_GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/analytics.edit",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters",
  "https://www.googleapis.com/auth/siteverification",
];

export const USER_MANAGEMENT_SCOPE =
  "https://www.googleapis.com/auth/analytics.manage.users";

export function authorizationScopes(manageUsers = false) {
  return [
    ...BASE_GOOGLE_SCOPES,
    ...(manageUsers ? [USER_MANAGEMENT_SCOPE] : []),
  ];
}

export function configHome() {
  return process.env.SITE_PROVISIONER_HOME
    ? path.resolve(process.env.SITE_PROVISIONER_HOME)
    : path.join(os.homedir(), ".config", "site-provisioner");
}

function emailSlug(email) {
  return email.toLowerCase().replace(/[^a-z0-9.-]+/g, "_");
}

export function oauthClientFingerprint(clientId) {
  return createHash("sha256").update(clientId).digest("hex").slice(0, 16);
}

export function tokenPathForClient(email, clientId) {
  return path.join(
    configHome(),
    "tokens",
    emailSlug(email),
    `${oauthClientFingerprint(clientId)}.json`,
  );
}

export function legacyTokenPathForEmail(email) {
  return path.join(configHome(), "tokens", `${emailSlug(email)}.json`);
}

export async function loadOAuthClient(clientPath) {
  const resolved = path.resolve(clientPath);
  const raw = await readFile(resolved, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OAuth client file is not valid JSON");
  }
  if (!parsed.installed) {
    throw new Error(
      "OAuth client must be a Google Desktop app credential with an installed section",
    );
  }
  const section = parsed.installed;
  if (
    !section.client_id ||
    !section.client_secret ||
    !section.auth_uri ||
    !section.token_uri
  ) {
    throw new Error("OAuth Desktop client file is incomplete");
  }
  return {
    clientId: section.client_id,
    clientSecret: section.client_secret,
    authUri: section.auth_uri,
    tokenUri: section.token_uri,
    projectId: section.project_id,
    sourcePath: resolved,
    fingerprint: oauthClientFingerprint(section.client_id),
  };
}

async function writeToken(tokenPath, token) {
  await mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readToken(tokenPath, expectedFingerprint, expectedEmail) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(tokenPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      const legacy = legacyTokenPathForEmail(expectedEmail);
      if (await pathExists(legacy)) {
        throw new Error(
          `A legacy email-only OAuth token exists at ${legacy}. Its issuing client cannot be verified. Re-run auth with the intended Desktop client.`,
        );
      }
      throw new Error(
        `No OAuth token exists for ${expectedEmail} and client ${expectedFingerprint}. Run auth first.`,
      );
    }
    throw error;
  }
  if (
    !parsed.accessToken ||
    !parsed.refreshToken ||
    !parsed.expiresAt ||
    !parsed.email ||
    !parsed.clientFingerprint
  ) {
    throw new Error(`OAuth token file is incomplete: ${tokenPath}`);
  }
  if (parsed.clientFingerprint !== expectedFingerprint) {
    throw new Error(
      `OAuth token was issued to client ${parsed.clientFingerprint}, not ${expectedFingerprint}`,
    );
  }
  if (parsed.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error(`OAuth token belongs to ${parsed.email}, not ${expectedEmail}`);
  }
  return parsed;
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function openUrl(url) {
  let command;
  let args;
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "linux") {
    command = "xdg-open";
    args = [url];
  } else {
    return false;
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function exchangeCode(client, code, redirectUri, codeVerifier, fetchImpl) {
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  return requestJson(
    fetchImpl,
    client.tokenUri,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    "OAuth code exchange",
    [client.clientSecret, code],
  );
}

async function getUserEmail(accessToken, fetchImpl) {
  const user = await requestJson(
    fetchImpl,
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Google identity check",
    [accessToken],
  );
  if (!user.email) throw new Error("Google did not return an email address");
  return user.email.toLowerCase();
}

function scopeArray(scopeValue) {
  if (Array.isArray(scopeValue)) return [...new Set(scopeValue)];
  return [...new Set(String(scopeValue ?? "").split(/\s+/).filter(Boolean))];
}

export async function authorize(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const client = await loadOAuthClient(options.clientPath);
  const expectedEmail = options.expectedEmail.toLowerCase();
  const requestedScopes = authorizationScopes(options.manageUsers);
  const state = base64Url(randomBytes(24));
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  let resolveCallback;
  let rejectCallback;
  const codePromise = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const server = createServer((request, response) => {
    const incoming = new URL(request.url ?? "/", "http://127.0.0.1");
    if (incoming.pathname !== "/oauth2/callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (incoming.searchParams.get("state") !== state) {
      response.writeHead(400).end("OAuth state did not match. You can close this tab.");
      rejectCallback(new Error("OAuth state did not match"));
      return;
    }
    const oauthError = incoming.searchParams.get("error");
    const code = incoming.searchParams.get("code");
    if (oauthError || !code) {
      response.writeHead(400).end("Google authorization was not completed.");
      rejectCallback(
        new Error(`Google authorization failed: ${oauthError ?? "no code"}`),
      );
      return;
    }
    response
      .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Authorization received. You can close this tab and return to the terminal.");
    resolveCallback(code);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start the OAuth callback server");
  }
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
  const authUrl = new URL(client.authUri);
  authUrl.search = new URLSearchParams({
    access_type: "offline",
    client_id: client.clientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true",
    login_hint: expectedEmail,
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: requestedScopes.join(" "),
    state,
  }).toString();
  options.onAuthorizationUrl?.(authUrl.toString());
  if (options.openBrowser !== false) openUrl(authUrl.toString());
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const timeout = setTimeout(
    () => rejectCallback(new Error("OAuth authorization timed out")),
    timeoutMs,
  );
  try {
    const code = await codePromise;
    const response = await exchangeCode(
      client,
      code,
      redirectUri,
      codeVerifier,
      fetchImpl,
    );
    if (!response.refresh_token) {
      throw new Error(
        "Google did not return a refresh token. Revoke the app grant and authorize again.",
      );
    }
    const email = await getUserEmail(response.access_token, fetchImpl);
    if (email !== expectedEmail) {
      throw new Error(`Authorized ${email}, expected ${expectedEmail}`);
    }
    const grantedScopes = scopeArray(response.scope ?? requestedScopes);
    const missing = requestedScopes.filter((scope) => !grantedScopes.includes(scope));
    if (missing.length > 0) {
      throw new Error(`Google did not grant required scopes: ${missing.join(", ")}`);
    }
    const token = {
      version: 2,
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1_000,
      tokenType: response.token_type ?? "Bearer",
      scopes: grantedScopes,
      email,
      clientFingerprint: client.fingerprint,
      projectId: client.projectId,
    };
    const tokenPath = tokenPathForClient(email, client.clientId);
    await writeToken(tokenPath, token);
    return { ...token, tokenPath };
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}

export class TokenManager {
  constructor(client, expectedEmail, fetchImpl = fetch) {
    this.client = client;
    this.expectedEmail = expectedEmail.toLowerCase();
    this.fetchImpl = fetchImpl;
    this.tokenPath = tokenPathForClient(this.expectedEmail, client.clientId);
  }

  static async create(clientPath, expectedEmail, fetchImpl = fetch) {
    return new TokenManager(
      await loadOAuthClient(clientPath),
      expectedEmail,
      fetchImpl,
    );
  }

  async load() {
    this.token ??= await readToken(
      this.tokenPath,
      this.client.fingerprint,
      this.expectedEmail,
    );
    return this.token;
  }

  async getStoredEmail() {
    return (await this.load()).email;
  }

  async assertScopes(requiredScopes) {
    const token = await this.load();
    const granted = scopeArray(token.scopes ?? token.scope);
    const missing = requiredScopes.filter((scope) => !granted.includes(scope));
    if (missing.length > 0) {
      throw new Error(
        `OAuth token is missing required scopes: ${missing.join(", ")}. Re-run auth with the matching option.`,
      );
    }
  }

  async getAccessToken(forceRefresh = false) {
    const token = await this.load();
    if (!forceRefresh && token.expiresAt > Date.now() + 60_000) {
      return token.accessToken;
    }
    const body = new URLSearchParams({
      client_id: this.client.clientId,
      client_secret: this.client.clientSecret,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    });
    const response = await requestJson(
      this.fetchImpl,
      this.client.tokenUri,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      "OAuth token refresh",
      [this.client.clientSecret, token.refreshToken],
    );
    this.token = {
      ...token,
      accessToken: response.access_token,
      expiresAt: Date.now() + response.expires_in * 1_000,
      tokenType: response.token_type ?? token.tokenType,
      scopes: scopeArray(response.scope ?? token.scopes),
    };
    await writeToken(this.tokenPath, this.token);
    return this.token.accessToken;
  }
}
