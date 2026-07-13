#!/usr/bin/env node
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.dirname(scriptDirectory);
const failures = [];
const sourceMapMarker = ["sourceMapping", "URL="].join("");
const suppliedForbiddenTerms = (process.env.SITE_PROVISIONER_FORBIDDEN_TERMS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function requirePath(relativePath) {
  try {
    await access(path.join(skillDirectory, relativePath));
  } catch {
    failures.push(`Missing required path: ${relativePath}`);
  }
}

for (const required of [
  "SKILL.md",
  "agents/openai.yaml",
  "assets/site.config.example.json",
  "assets/site.config.manual-dns.example.json",
  "assets/sitemap.example.xml",
  "assets/robots.example.txt",
  "scripts/provision-site",
  "scripts/site-provisioner/cli.js",
  "scripts/site-provisioner/package.json",
]) {
  await requirePath(required);
}

const files = await walk(skillDirectory);
for (const file of files) {
  const relative = path.relative(skillDirectory, file);
  if (relative.endsWith(".map")) failures.push(`Source map is not allowed: ${relative}`);
  if (/(^|\/)(client_secret[^/]*\.json|credentials\.json)$/i.test(relative)) {
    failures.push(`Credential-shaped file is not allowed: ${relative}`);
  }
  if (/(^|\/)\.state(\/|$)/.test(relative)) {
    failures.push(`Saved state is not allowed in the skill: ${relative}`);
  }
  if (/\.(?:md|js|json|yaml|yml|txt|xml|sh)$/i.test(relative) || relative === "scripts/provision-site") {
    const text = await readFile(file, "utf8");
    for (const [label, pattern] of [
      ["absolute macOS user path", /\/Users\/[A-Za-z0-9._-]+\//],
      ["source-map reference", new RegExp(sourceMapMarker)],
      ["private key", /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
      ["OAuth access token", /\bya29\.[A-Za-z0-9_-]{20,}/],
      ["file URI", /file:\/\//],
      [
        "literal bearer authorization",
        /Authorization\s*:\s*["']Bearer\s+[A-Za-z0-9._-]{16,}["']/i,
      ],
    ]) {
      if (pattern.test(text)) failures.push(`${label} found in ${relative}`);
    }
    const lowerText = text.toLowerCase();
    for (const term of suppliedForbiddenTerms) {
      if (lowerText.includes(term.toLowerCase())) {
        failures.push(`supplied forbidden term found in ${relative}`);
      }
    }
  }
}

const skillText = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");
for (const match of skillText.matchAll(/\]\((references\/[^)]+)\)/g)) {
  await requirePath(match[1]);
}

const wrapperMode = (await stat(path.join(skillDirectory, "scripts/provision-site"))).mode;
if ((wrapperMode & 0o111) === 0) failures.push("scripts/provision-site is not executable");

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL: ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Package validation passed for ${files.length} files.\n`);
}
