# Operator Runbook

Use this reference for routine setup after reviewing the two bootstrap guides.

## Contents

1. Requirements
2. Configuration
3. Readiness check
4. Authorization and account selection
5. Dry plan and approval
6. Base provisioning
7. Tag installation or handoff
8. Product link
9. Optional access grants
10. Validation and records

## 1. Requirements

- Node.js 20 or newer
- An owner-approved Google Cloud Desktop OAuth client
- Analytics Admin, Search Console, and Site Verification APIs enabled in the client project
- The intended Google user configured for the OAuth app's audience
- Access to an existing Google Analytics account
- An active Cloudflare zone or a manual DNS handoff plan
- A live canonical page and sitemap
- Editable website source and deployment approval for tag work

Resolve `<skill-directory>` to the directory containing `SKILL.md`.

## 2. Configuration

Copy `assets/site.config.example.json` into a controlled operations directory outside the skill. Use `assets/site.config.manual-dns.example.json` when another provider will add the verification TXT record. Replace every example value.

| Field | Required | Meaning |
|---|---:|---|
| `displayName` | Yes | GA4 property and stream display name |
| `domain` | Yes | Root domain without protocol or path |
| `canonicalUrl` | Yes | HTTP or HTTPS site URL on the root domain or its subdomain |
| `sitemapUrl` | Yes | Public sitemap URL on the configured domain |
| `timeZone` | Yes | IANA time zone, such as `America/Chicago` |
| `currencyCode` | Yes | Three-letter ISO 4217 code |
| `expectedGoogleEmail` | Yes | Exact Google identity allowed to authorize |
| `expectedGoogleCloudProjectId` | No | Expected project ID for OAuth client cross-checking |
| `gaAccountId` | Recommended | Numeric Analytics account chosen by the owner |
| `verification.provider` | Yes | `cloudflare` for API-managed DNS or `manual` for an owner-managed provider handoff |
| `staticSiteDirectory` | No | Editable static HTML root, relative to the config or absolute |
| `stateFile` | No | Non-secret state path; defaults beside the config under `.state/` |

The config contains ownership identifiers but no credentials. Decide whether the email, project ID, and account ID belong in a public repository before committing it.

## 3. Readiness check

Run local checks:

```bash
<skill-directory>/scripts/provision-site doctor \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json
```

Add `--online` to fetch the canonical page and sitemap. `doctor` does not modify local or remote systems.

Interpretation:

- `PASS`: the checked prerequisite is ready.
- `PENDING`: fix or decide something before a live apply.
- `SKIPPED`: an optional or later-stage asset is absent.
- `FAIL`: the supplied input is unsafe, invalid, or conflicts with the config.

`doctor` exits `1` for a failed check and `2` when nothing failed but at least one prerequisite is pending. Automation should inspect both the exit code and JSON status fields.

## 4. Authorization and account selection

Authorize the exact expected user:

```bash
<skill-directory>/scripts/provision-site auth \
  --oauth-client /secure/path/to/desktop-client.json \
  --email owner@example.com
```

The callback listens only on loopback. The CLI verifies the returned email and saves the token under a client-specific fingerprint. It does not accept an email-only token from the older runtime.

List accessible Analytics accounts:

```bash
<skill-directory>/scripts/provision-site accounts \
  --oauth-client /secure/path/to/desktop-client.json \
  --email owner@example.com
```

Have the owner confirm the account name and numeric ID. Add that ID to `gaAccountId`. Display names are not unique.

For a Cloudflare config, save the domain-bound token after the owner creates it:

```bash
pbpaste | <skill-directory>/scripts/provision-site cloudflare-token \
  --domain example.com
```

For another DNS host, set `verification.provider` to `manual` and follow the handoff in the Cloudflare and Site Readiness reference. No Cloudflare token is needed.

## 5. Dry plan and approval

Start with a local no-write preview:

```bash
<skill-directory>/scripts/provision-site plan \
  --config /absolute/path/to/site.json
```

This output is labeled `Preliminary` and is not enough for write approval. After authorization and account selection, run an authenticated read-only plan:

```bash
<skill-directory>/scripts/provision-site plan \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json
```

Approve only when the output is labeled `Approval-ready` and shows:

- Acting Google email
- OAuth Cloud project ID
- Analytics account name and ID
- Display name
- Root domain
- Canonical URL
- Sitemap URL
- DNS provider and zone
- Every Google and Cloudflare write
- Manual tag, deployment, and link work that follows

For manual DNS, replace “Cloudflare write” with the exact owner-managed TXT handoff. Approval for one site, account, or domain does not cover another. Approval for API provisioning does not cover source edits, deployment, access grants, nameservers, billing, or OAuth publishing changes.

## 6. Base provisioning

Run after approval:

```bash
<skill-directory>/scripts/provision-site apply \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json
```

Type the exact domain at the confirmation prompt. `--yes` is allowed only after a separate exact-plan approval in the current task.

The command writes state after each verified remote step:

1. Analytics account choice
2. GA4 property
3. Web stream and measurement ID
4. Google verification token
5. Cloudflare zone and TXT record, or the manual DNS handoff state
6. Verified domain resource
7. Search Console property
8. Sitemap submission

Exit codes:

- `0`: the requested operation completed.
- `1`: an error or failed check requires attention.
- `2`: a write was accepted or DNS is propagating; rerun the same command later.

Do not delete the state file after exit `2`.

With `verification.provider: "manual"`, the first approved run prints the exact TXT name and content and usually exits `2`. Add that record through the domain owner's provider, confirm it in public DNS, and rerun the same command. The runtime skips Cloudflare and resumes with Google verification.

## 7. Tag installation or handoff

Print the tag when no static directory is configured:

```bash
<skill-directory>/scripts/provision-site install-tag \
  --config /absolute/path/to/site.json
```

Preview static HTML changes:

```bash
<skill-directory>/scripts/provision-site install-tag \
  --config /absolute/path/to/site.json \
  --site-dir /absolute/path/to/editable/site \
  --dry-run
```

After source-edit approval, remove `--dry-run`. The installer:

- Finds HTML recursively outside `.git` and `node_modules`
- Inserts one marked Google tag block before `</head>`
- Reuses the same managed measurement ID
- Refuses unmanaged GA or GTM installations
- Requires an explicit flag before replacing a different managed ID

For frameworks, CMSs, GTM, or consent platforms, hand off the saved measurement ID and verify the source-level implementation. Deployment remains separate.

## 8. Product link

In Google Analytics:

1. Select the saved numeric property.
2. Open **Admin > Product links > Search Console Links**.
3. Create a link.
4. Select the verified Domain property.
5. Select the saved web stream.
6. Review and submit.
7. Read the link list back and compare property, stream, linking user, and date.

Do not choose by display name alone. The public Admin API does not expose this product-link resource, so the CLI cannot prove it.

## 9. Optional access grants

First extend OAuth with the user-management scope:

```bash
<skill-directory>/scripts/provision-site auth \
  --oauth-client /secure/path/to/desktop-client.json \
  --email owner@example.com \
  --manage-users
```

Plan:

```bash
<skill-directory>/scripts/provision-site access-plan \
  --config /absolute/path/to/site.json \
  --target-email teammate@example.com
```

After separate approval:

```bash
<skill-directory>/scripts/provision-site grant-access \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json \
  --target-email teammate@example.com
```

The target must be a Google Account. A non-Google email address can be registered as a Google Account, but the user must complete that registration before the grant succeeds.

The command adds:

- GA4 property role `predefinedRoles/admin`
- Search Console delegated ownership through the verified resource owner list

It never removes owners. It stops when an existing GA4 binding has different roles rather than replacing them.

## 10. Validation and records

Run:

```bash
<skill-directory>/scripts/provision-site validate \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json
```

The command reads back:

- GA4 property and parent account
- Web stream and measurement ID
- Domain ownership and owner email
- Search Console owner permission
- Sitemap processing state, warnings, and errors
- Live canonical HTML and tag count
- Public verification TXT record
- Saved Cloudflare record when a token is available

The GA4-to-Search Console link remains `SKIPPED` until checked in the browser.

Add `--json` to `doctor`, `accounts`, `plan`, `apply`, `access-plan`, `grant-access`, or `validate` for structured output. JSON never includes OAuth or Cloudflare token values.
