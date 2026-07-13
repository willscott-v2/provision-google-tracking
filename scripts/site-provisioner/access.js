import { loadState, saveState } from "./state.js";

function normalizeEmail(email) {
  const value = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new Error("Target access email must be a valid Google Account email address");
  }
  return value;
}

export async function buildAccessPlan(config, targetEmail) {
  const email = normalizeEmail(targetEmail);
  const state = await loadState(config.statePath, config.domain);
  if (!state.gaPropertyName || !state.verificationResourceId) {
    throw new Error("Complete base provisioning before planning access grants");
  }
  const previous = state.accessGrants?.[email] ?? {};
  const actions = [];
  if (!previous.gaAdmin) {
    actions.push(`Grant ${email} GA4 property administrator access`);
  }
  if (!previous.searchConsoleOwner) {
    actions.push(`Grant ${email} Search Console delegated-owner access`);
  }
  if (actions.length === 0) actions.push("No permission writes; saved grants are complete");
  return {
    domain: config.domain,
    targetEmail: email,
    gaPropertyName: state.gaPropertyName,
    verificationResourceId: state.verificationResourceId,
    actions,
    confirmation: `${config.domain}:${email}`,
  };
}

async function ensureGaAdmin({ google, propertyName, email, report }) {
  let bindings = await google.listPropertyAccessBindings(propertyName);
  const existing = bindings.find(
    (binding) => binding.user?.toLowerCase() === email,
  );
  if (existing) {
    if (!existing.roles?.includes("predefinedRoles/admin")) {
      throw new Error(
        `${email} already has GA4 roles ${existing.roles?.join(", ") || "none"}; refusing to replace them silently`,
      );
    }
    report(`Reusing GA4 administrator binding ${existing.name}`);
    return { bindingName: existing.name, reused: true };
  }
  const created = await google.createPropertyAccessBinding(propertyName, email);
  bindings = await google.listPropertyAccessBindings(propertyName);
  const readBack = bindings.find(
    (binding) =>
      binding.user?.toLowerCase() === email &&
      binding.roles?.includes("predefinedRoles/admin"),
  );
  if (!readBack) {
    throw new Error(
      `GA4 accepted administrator binding ${created.name ?? "without an ID"}, but read-back verification failed`,
    );
  }
  report(`Created and verified GA4 administrator binding ${readBack.name}`);
  return { bindingName: readBack.name, reused: false };
}

async function ensureSearchConsoleOwner({ google, resourceId, email, report }) {
  let resource = await google.getVerifiedResource(resourceId);
  const owners = (resource.owners ?? []).map((owner) => owner.toLowerCase());
  if (owners.includes(email)) {
    report(`Reusing Search Console owner ${email}`);
    return { reused: true };
  }
  resource = await google.updateVerifiedResource(resourceId, {
    site: resource.site,
    owners: [...(resource.owners ?? []), email],
  });
  const readBack = await google.getVerifiedResource(resourceId);
  if (!(readBack.owners ?? []).some((owner) => owner.toLowerCase() === email)) {
    throw new Error(
      `Google accepted the owner update for ${email}, but read-back verification failed`,
    );
  }
  report(`Created and verified Search Console delegated owner ${email}`);
  return { reused: false, resource };
}

export async function grantAccess(options) {
  const email = normalizeEmail(options.targetEmail);
  const state = await loadState(options.config.statePath, options.config.domain);
  if (!state.gaPropertyName || !state.verificationResourceId) {
    throw new Error("Complete base provisioning before granting access");
  }
  state.accessGrants ??= {};
  state.accessGrants[email] ??= {};
  const report = options.report ?? (() => undefined);
  const ga = await ensureGaAdmin({
    google: options.google,
    propertyName: state.gaPropertyName,
    email,
    report,
  });
  state.accessGrants[email].gaAdmin = true;
  state.accessGrants[email].gaBindingName = ga.bindingName;
  await saveState(options.config.statePath, state);
  const searchConsole = await ensureSearchConsoleOwner({
    google: options.google,
    resourceId: state.verificationResourceId,
    email,
    report,
  });
  state.accessGrants[email].searchConsoleOwner = true;
  state.accessGrants[email].updatedAt = new Date().toISOString();
  await saveState(options.config.statePath, state);
  return {
    targetEmail: email,
    gaAdmin: { verified: true, reused: ga.reused },
    searchConsoleOwner: { verified: true, reused: searchConsole.reused },
  };
}
