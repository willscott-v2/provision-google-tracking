import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const START_MARKER = "<!-- site-provisioner:google-tag:start -->";
const END_MARKER = "<!-- site-provisioner:google-tag:end -->";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MANAGED_BLOCK = new RegExp(
  `${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`,
  "g",
);
const EXTERNAL_GOOGLE_TAG =
  /googletagmanager\.com\/(?:gtag\/js|gtm\.js)|\bGTM-[A-Z0-9]+\b|\bgtag\s*\(\s*['"]config['"]/gi;

export function assertMeasurementId(measurementId) {
  if (!/^G-[A-Z0-9]{5,20}$/.test(measurementId)) {
    throw new Error(`Invalid GA4 measurement ID: ${measurementId}`);
  }
}

export function googleTagSnippet(measurementId) {
  assertMeasurementId(measurementId);
  return `${START_MARKER}
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${measurementId}');
</script>
${END_MARKER}`;
}

export function inspectGoogleTags(html, expectedMeasurementId) {
  const matches = [...html.matchAll(EXTERNAL_GOOGLE_TAG)].map((match) => match[0]);
  const measurementIds = [
    ...new Set([...html.matchAll(/\bG-[A-Z0-9]{5,20}\b/g)].map((match) => match[0])),
  ];
  return {
    loaderCount: matches.filter((value) => /googletagmanager\.com\/gtag\/js/i.test(value))
      .length,
    managerCount: matches.filter((value) => /gtm\.js|GTM-/i.test(value)).length,
    measurementIds,
    expectedPresent: expectedMeasurementId
      ? measurementIds.includes(expectedMeasurementId)
      : undefined,
  };
}

export function installTagInHtml(html, measurementId, replaceMeasurementId = false) {
  const snippet = googleTagSnippet(measurementId);
  const existingBlocks = html.match(MANAGED_BLOCK) ?? [];
  if (existingBlocks.length > 1) {
    throw new Error("Multiple site-provisioner Google tag blocks were found");
  }
  if (existingBlocks.length === 1) {
    if (existingBlocks[0].includes(measurementId)) {
      return { content: html, changed: false, reason: "already-installed" };
    }
    if (!replaceMeasurementId) {
      throw new Error(
        "A different site-provisioner measurement ID is installed; use --replace-measurement-id",
      );
    }
    return {
      content: html.replace(MANAGED_BLOCK, snippet),
      changed: true,
      reason: "replaced",
    };
  }
  EXTERNAL_GOOGLE_TAG.lastIndex = 0;
  if (EXTERNAL_GOOGLE_TAG.test(html)) {
    throw new Error("An unmanaged Google Analytics or Tag Manager installation already exists");
  }
  const closingHead = html.search(/<\/head\s*>/i);
  if (closingHead === -1) throw new Error("HTML document has no closing </head> tag");
  return {
    content: `${html.slice(0, closingHead)}${snippet}\n${html.slice(closingHead)}`,
    changed: true,
    reason: "inserted",
  };
}

async function findHtmlFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (["node_modules", ".git"].includes(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        files.push(fullPath);
      }
    }
  }
  await visit(path.resolve(root));
  return files.sort();
}

export async function installStaticTag(input) {
  const files = await findHtmlFiles(input.root);
  if (files.length === 0) throw new Error(`No HTML files found in ${input.root}`);
  const changed = [];
  const unchanged = [];
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const transformed = installTagInHtml(
      html,
      input.measurementId,
      input.replaceMeasurementId ?? false,
    );
    if (!transformed.changed) {
      unchanged.push(file);
      continue;
    }
    changed.push(file);
    if (!input.dryRun) await writeFile(file, transformed.content, "utf8");
  }
  return { scanned: files.length, changed, unchanged };
}
