import test from "node:test";
import assert from "node:assert/strict";
import {
  googleTagSnippet,
  inspectGoogleTags,
  installTagInHtml,
} from "../tag.js";
import { readFixture } from "./helpers.js";

const MEASUREMENT_ID = "G-ABCDE12345";

test("inserts one managed tag and then reuses it", async () => {
  const html = await readFixture("plain.html");
  const inserted = installTagInHtml(html, MEASUREMENT_ID);
  assert.equal(inserted.changed, true);
  assert.match(inserted.content, /site-provisioner:google-tag:start/);
  const repeated = installTagInHtml(inserted.content, MEASUREMENT_ID);
  assert.equal(repeated.changed, false);
  const inspection = inspectGoogleTags(repeated.content, MEASUREMENT_ID);
  assert.equal(inspection.loaderCount, 1);
  assert.equal(inspection.expectedPresent, true);
});

test("refuses an unmanaged GA or GTM installation", async () => {
  const html = (await readFixture("plain.html")).replace(
    "</head>",
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-OTHER12345"></script></head>',
  );
  assert.throws(() => installTagInHtml(html, MEASUREMENT_ID), /unmanaged Google Analytics/);
});

test("requires an explicit replacement flag for a different managed ID", async () => {
  const html = (await readFixture("plain.html")).replace(
    "</head>",
    `${googleTagSnippet("G-OTHER12345")}\n</head>`,
  );
  assert.throws(() => installTagInHtml(html, MEASUREMENT_ID), /different site-provisioner/);
  const replaced = installTagInHtml(html, MEASUREMENT_ID, true);
  assert.equal(replaced.changed, true);
  assert.doesNotMatch(replaced.content, /G-OTHER12345/);
});

test("rejects malformed measurement IDs", () => {
  assert.throws(() => googleTagSnippet("not-an-id"), /Invalid GA4 measurement ID/);
});
