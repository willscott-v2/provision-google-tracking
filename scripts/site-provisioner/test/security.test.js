import test from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../security.js";

test("redacts bearer tokens, JSON secrets, headers, and explicit values", () => {
  const secret = "private-test-value";
  const input = `Bearer abc.def\n{"refresh_token":"refresh-value"}\nauthorization=token-value\n${secret}`;
  const output = redactSecrets(input, [secret]);
  assert.doesNotMatch(output, /abc\.def|refresh-value|token-value|private-test-value/);
  assert.match(output, /REDACTED/);
});
