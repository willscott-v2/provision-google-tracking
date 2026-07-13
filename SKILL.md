---
name: provision-google-tracking
description: Provision or resume Google Analytics 4 and Google Search Console for a website, starting from either an empty setup or existing Google and Cloudflare assets. Use when Codex needs to prepare Google Cloud user OAuth, create or reuse a GA4 property and web stream, return a measurement ID, verify a Search Console Domain property through Cloudflare DNS, submit a sitemap, install or hand off the Google tag, link GA4 to Search Console, validate the result, recover a partial run, or optionally grant GA4 administrator and Search Console delegated-owner access.
---

# Provision Google Tracking

Use the bundled dependency-free CLI for repeatable API work. Use browser control for console setup, OAuth consent, Cloudflare token setup, GA4-to-Search Console linking, and other UI-only steps.

## Read the right references

- Read [Google Cloud Bootstrap](references/google-cloud-bootstrap.md) when the operator lacks a Google Cloud project, enabled APIs, OAuth configuration, a Desktop client, or an Analytics account. Also read it for OAuth errors.
- Read [Cloudflare and Site Readiness](references/cloudflare-and-site-readiness.md) when the domain is not active in Cloudflare, no restricted token exists, the sitemap or robots file is missing, the tag method is unclear, or DNS uses another provider.
- Read [Operator Runbook](references/operator-runbook.md) before the first live run and for the configuration schema and command sequence.
- Read [Recovery and Validation](references/recovery-and-validation.md) after an interruption, pending result, conflict, permission failure, or validation problem.
- Read [Installation](references/installation.md) when installing, sharing, or updating the skill.
- Read [API Boundaries](references/api-boundaries.md) when scopes, quota attribution, API versions, access roles, or browser-only work are unclear.

Resolve `<skill-directory>` to the directory containing this `SKILL.md`. Run:

```bash
<skill-directory>/scripts/provision-site help
```

Require Node.js 20 or newer.

## Protect identities, secrets, and live systems

1. Treat explanation, diagnosis, status, and audit requests as read-only.
2. Do not create resources, change DNS, edit a website, deploy, grant access, change nameservers, attach billing, or change OAuth publishing status unless the user requested and approved that exact work.
3. Before `apply`, show the Google identity, OAuth project, Analytics account name and ID, domain, canonical URL, sitemap URL, DNS provider, and every planned write. Obtain approval for that exact plan.
4. Before `grant-access`, show the acting Google identity, target Google Account, GA4 property ID, verified-domain resource, roles, and both permission writes. Obtain separate approval.
5. Never place OAuth client JSON, authorization codes, tokens, cookies, passwords, or Cloudflare credentials in the skill, a repository, site config, CLI arguments, task output, screenshots, or browser traces.
6. Pause for passwords, passkeys, recovery details, MFA codes, billing decisions, OAuth publishing changes, nameserver changes, and final token reveal.
7. If a token appears in output or a browser trace, treat it as exposed and rotate it.
8. Keep client assets client-owned when possible. Confirm the Analytics account, Cloud project, domain, and DNS owner instead of assuming agency or personal ownership.
9. Preserve consent handling and existing GA or GTM architecture. Do not present tag guidance as legal advice.
10. Do not delete remote resources or local state to repair a partial run. Resume after reading the saved state and remote evidence.

## Start from the operator's actual readiness

Inspect first. Do not assume the operator already has:

- A Google Cloud project
- The three required APIs enabled
- Google Auth Platform branding, audience, scopes, and test users
- A Desktop OAuth client
- A Google Analytics account with sufficient access
- An active Cloudflare zone and zone-restricted API token, or an owner-managed DNS handoff
- A valid sitemap and robots file
- Editable source, deployment permission, or a tag/consent design

If any item is missing, follow the two bootstrap references. Use the included templates in `assets/` as starting points, not as production values.

## Run the safe preflight

Create a controlled site config from `assets/site.config.example.json`, then run:

```bash
<skill-directory>/scripts/provision-site doctor \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json \
  --online
```

`doctor` performs no external writes. Fix failures before authorization. Pending OAuth or Cloudflare credentials are expected when bootstrapping.

## Authorize the intended Google user

Use a caller-supplied Google Desktop OAuth client. A service account is not required.

```bash
<skill-directory>/scripts/provision-site auth \
  --oauth-client /secure/path/to/desktop-client.json \
  --email owner@example.com
```

OAuth tokens are isolated by Google email and OAuth-client fingerprint. Do not reuse an email-only legacy token or a token issued to another client.

For optional GA4 access management, extend consent deliberately:

```bash
<skill-directory>/scripts/provision-site auth \
  --oauth-client /secure/path/to/desktop-client.json \
  --email owner@example.com \
  --manage-users
```

## Confirm Analytics ownership

List the accounts visible to the authenticated user:

```bash
<skill-directory>/scripts/provision-site accounts \
  --oauth-client /secure/path/to/desktop-client.json \
  --email owner@example.com
```

Have the owner confirm the intended account name and numeric ID. Prefer one property and web stream per website inside an account owned by the same legal entity. Do not create a new Analytics account per site unless ownership requires it.

## Prepare DNS credentials or handoff

For `verification.provider: "cloudflare"`, create a token restricted to the intended zone with Cloudflare UI permissions `Zone Read` and `DNS Edit` (`DNS Write` in API documentation). Have the user copy the final value, then store it through standard input:

```bash
pbpaste | <skill-directory>/scripts/provision-site cloudflare-token \
  --domain example.com
```

The default file is domain-specific and owner-readable only. Never silently substitute a token bound to another domain.

For another DNS host, set `verification.provider` to `manual`. The approved `apply` run saves and prints the Google TXT name and content, exits `2` while the record is absent, and resumes verification after the owner adds it.

## Plan, approve, apply, and resume

Run a preliminary local plan when credentials are not ready:

```bash
<skill-directory>/scripts/provision-site plan \
  --config /absolute/path/to/site.json
```

Do not approve writes from the preliminary plan. After OAuth authorization and Analytics account selection, run the authenticated read-only plan:

```bash
<skill-directory>/scripts/provision-site plan \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json
```

Approve only when the output says `Approval-ready` and shows the actual Google identity, OAuth project and client fingerprint, Analytics account name and ID, domain, canonical URL, sitemap URL, DNS provider and zone, and every planned write. Then run:

```bash
<skill-directory>/scripts/provision-site apply \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json
```

Let the CLI require the domain confirmation. Use `--yes` only when the exact plan was separately approved in the current task.

The runtime creates or reuses and reads back:

1. One GA4 property under the confirmed Analytics account
2. One matching web stream and its `G-` measurement ID
3. One Google DNS verification token and either an exact Cloudflare TXT record or an owner-managed DNS handoff
4. One verified Domain resource and `sc-domain:` Search Console property
5. One configured sitemap submission

Exit code `2` means the operation is pending and resumable. Rerun the same command after the reported delay. Do not create replacements.

## Install or hand off the Google tag

For static HTML, preview before editing:

```bash
<skill-directory>/scripts/provision-site install-tag \
  --config /absolute/path/to/site.json \
  --dry-run
```

The installer stops when it finds an unmanaged GA or GTM setup. For Next.js, React, a CMS, GTM, or a consent platform, use the measurement ID in editable source or deployment configuration. Do not patch generated build artifacts.

Tag installation and deployment are separate approvals. Verify the deployed site after publishing.

## Link GA4 to Search Console

Complete the product link in **GA4 Admin > Product links > Search Console Links**. Match the saved numeric property and stream IDs and the verified `sc-domain:` property. Review before submitting, then verify the list shows the intended Search Console property, stream, linking user, and date.

Keep this as a browser step unless current official Google documentation exposes a supported public API.

## Grant optional access separately

Plan first:

```bash
<skill-directory>/scripts/provision-site access-plan \
  --config /absolute/path/to/site.json \
  --target-email teammate@example.com
```

After separate approval, run `grant-access` with the same arguments plus `--oauth-client`. The command adds or reuses GA4 property administrator access and Search Console delegated-owner access, saves progress after each verified write, and stops rather than replacing a conflicting GA4 role.

## Validate and report

Run authenticated read-only validation:

```bash
<skill-directory>/scripts/provision-site validate \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json
```

Report passes, pending checks, failures, skipped provider checks, exact non-secret IDs, and browser work still required. Verify the GA4-to-Search Console link in the browser because the CLI intentionally marks it as manual.
