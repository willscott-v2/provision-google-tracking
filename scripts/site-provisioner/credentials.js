import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { configHome } from "./auth.js";
import { normalizeDomain } from "./config.js";

export function cloudflareTokenPathForDomain(domain) {
  return path.join(configHome(), "cloudflare", `${normalizeDomain(domain)}.json`);
}

export async function saveCloudflareToken({ token, domain, targetPath }) {
  const value = token.trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(value)) {
    throw new Error("Cloudflare token format is not valid");
  }
  const normalizedDomain = normalizeDomain(domain);
  const resolved = path.resolve(
    targetPath ?? cloudflareTokenPathForDomain(normalizedDomain),
  );
  await mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const record = { version: 1, domain: normalizedDomain, token: value };
  await writeFile(resolved, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await chmod(resolved, 0o600);
  return resolved;
}

export async function loadCloudflareToken({ domain, tokenFile } = {}) {
  const environmentToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (environmentToken) return { token: environmentToken, source: "environment" };
  if (!domain) return undefined;
  const normalizedDomain = normalizeDomain(domain);
  const resolved = path.resolve(tokenFile ?? cloudflareTokenPathForDomain(normalizedDomain));
  try {
    const metadata = await stat(resolved);
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error(`Cloudflare token file must use 0600 permissions: ${resolved}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(await readFile(resolved, "utf8"));
    } catch {
      throw new Error(
        `Cloudflare token file is not a domain-bound JSON record: ${resolved}. Re-save it with cloudflare-token --domain ${normalizedDomain}`,
      );
    }
    if (parsed.version !== 1 || !parsed.domain || !parsed.token) {
      throw new Error(`Cloudflare token file is incomplete: ${resolved}`);
    }
    if (normalizeDomain(parsed.domain) !== normalizedDomain) {
      throw new Error(
        `Cloudflare token file is bound to ${parsed.domain}, not ${normalizedDomain}`,
      );
    }
    return { token: parsed.token, source: resolved };
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}
