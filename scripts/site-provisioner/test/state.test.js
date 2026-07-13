import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { loadState, saveState } from "../state.js";
import { tempDirectory, writeJson } from "./helpers.js";

test("creates version 2 state and saves it atomically with 0600 permissions", async () => {
  const root = await tempDirectory();
  const statePath = path.join(root, "state", "example.json");
  const state = await loadState(statePath, "example.com");
  assert.equal(state.version, 2);
  state.measurementId = "G-ABCDE12345";
  await saveState(statePath, state);
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
  assert.equal((await loadState(statePath, "example.com")).measurementId, "G-ABCDE12345");
});

test("migrates version 1 state without dropping resource IDs", async () => {
  const root = await tempDirectory();
  const statePath = path.join(root, "legacy.json");
  await writeJson(statePath, {
    version: 1,
    domain: "example.com",
    gaPropertyName: "properties/100",
  });
  const state = await loadState(statePath, "example.com");
  assert.equal(state.version, 2);
  assert.equal(state.gaPropertyName, "properties/100");
  assert.deepEqual(state.accessGrants, {});
});

test("rejects state for another domain", async () => {
  const root = await tempDirectory();
  const statePath = path.join(root, "wrong.json");
  await writeJson(statePath, { version: 2, domain: "example.net" });
  await assert.rejects(() => loadState(statePath, "example.com"), /does not match/);
});
