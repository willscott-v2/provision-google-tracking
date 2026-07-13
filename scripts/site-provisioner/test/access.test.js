import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildAccessPlan, grantAccess } from "../access.js";
import { parseSiteConfigForTest } from "../config.js";
import { createState, loadState, saveState } from "../state.js";
import { tempDirectory, validConfig } from "./helpers.js";

class FakeAccessGoogle {
  constructor() {
    this.bindings = [];
    this.resource = {
      id: "dns://example.com",
      site: { type: "INET_DOMAIN", identifier: "example.com" },
      owners: ["owner@example.com"],
    };
    this.createCount = 0;
    this.updateCount = 0;
    this.failOwnerUpdates = 0;
  }

  async listPropertyAccessBindings() {
    return this.bindings;
  }

  async createPropertyAccessBinding(propertyName, email) {
    this.createCount += 1;
    const binding = {
      name: `${propertyName}/accessBindings/1`,
      user: email,
      roles: ["predefinedRoles/admin"],
    };
    this.bindings.push(binding);
    return binding;
  }

  async getVerifiedResource() {
    return structuredClone(this.resource);
  }

  async updateVerifiedResource(_id, resource) {
    this.updateCount += 1;
    if (this.failOwnerUpdates > 0) {
      this.failOwnerUpdates -= 1;
      throw new Error("temporary owner update failure");
    }
    this.resource = { ...this.resource, owners: resource.owners };
    return structuredClone(this.resource);
  }
}

async function preparedConfig() {
  const root = await tempDirectory();
  const config = parseSiteConfigForTest(validConfig(), path.join(root, "site.json"));
  const state = createState("example.com");
  state.gaPropertyName = "properties/100";
  state.verificationResourceId = "dns://example.com";
  await saveState(config.statePath, state);
  return config;
}

test("plans both optional access grants", async () => {
  const config = await preparedConfig();
  const plan = await buildAccessPlan(config, "Teammate@Example.com");
  assert.equal(plan.targetEmail, "teammate@example.com");
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.confirmation, "example.com:teammate@example.com");
});

test("resumes after a partial access failure without duplicating GA4 admin", async () => {
  const config = await preparedConfig();
  const google = new FakeAccessGoogle();
  google.failOwnerUpdates = 1;
  await assert.rejects(
    () =>
      grantAccess({
        config,
        google,
        targetEmail: "teammate@example.com",
      }),
    /temporary owner update failure/,
  );
  let state = await loadState(config.statePath, config.domain);
  assert.equal(state.accessGrants["teammate@example.com"].gaAdmin, true);
  assert.equal(state.accessGrants["teammate@example.com"].searchConsoleOwner, undefined);
  const result = await grantAccess({
    config,
    google,
    targetEmail: "teammate@example.com",
  });
  assert.equal(result.gaAdmin.reused, true);
  assert.equal(result.searchConsoleOwner.reused, false);
  assert.equal(google.createCount, 1);
  state = await loadState(config.statePath, config.domain);
  assert.equal(state.accessGrants["teammate@example.com"].searchConsoleOwner, true);
  const repeated = await grantAccess({
    config,
    google,
    targetEmail: "teammate@example.com",
  });
  assert.equal(repeated.gaAdmin.reused, true);
  assert.equal(repeated.searchConsoleOwner.reused, true);
  assert.equal(google.createCount, 1);
});

test("refuses to replace a conflicting GA4 role", async () => {
  const config = await preparedConfig();
  const google = new FakeAccessGoogle();
  google.bindings.push({
    name: "properties/100/accessBindings/9",
    user: "teammate@example.com",
    roles: ["predefinedRoles/viewer"],
  });
  await assert.rejects(
    () =>
      grantAccess({
        config,
        google,
        targetEmail: "teammate@example.com",
      }),
    /refusing to replace them silently/,
  );
  assert.deepEqual(google.resource.owners, ["owner@example.com"]);
});

test("rejects a malformed target email before writes", async () => {
  const config = await preparedConfig();
  const google = new FakeAccessGoogle();
  await assert.rejects(
    () => grantAccess({ config, google, targetEmail: "not-an-email" }),
    /valid Google Account email/,
  );
  assert.equal(google.createCount, 0);
});

test("stops after Google rejects an account and does not grant Search Console ownership", async () => {
  const config = await preparedConfig();
  const google = new FakeAccessGoogle();
  google.createPropertyAccessBinding = async () => {
    google.createCount += 1;
    throw new Error("User not allowed");
  };
  await assert.rejects(
    () => grantAccess({ config, google, targetEmail: "unknown@example.com" }),
    /User not allowed/,
  );
  assert.equal(google.createCount, 1);
  assert.equal(google.updateCount, 0);
});
