# Provision Google Tracking

Provision or resume Google Analytics 4 and Google Search Console for a website.

This agent skill covers the setup work around Google Cloud user OAuth, GA4 properties and web streams, Search Console Domain properties, Cloudflare DNS verification, sitemap submission, tag handoff, validation, recovery, and optional access grants.

It starts from the operator's actual readiness. A Google Cloud project, OAuth client, Analytics account, Cloudflare token, sitemap, and tag implementation may already exist, or none of them may exist yet.

## What it handles

- Prepare a Google Cloud project, required APIs, Google Auth Platform settings, and a Desktop OAuth client
- Authenticate an intended Google user without requiring a service account
- Create or reuse one GA4 property and matching web stream
- Return the `G-` measurement ID
- Create a Search Console Domain property
- Add or reuse the Google verification TXT record through a zone-restricted Cloudflare token
- Hand off DNS verification for providers other than Cloudflare
- Submit or reuse a sitemap submission
- Install a Google tag in static HTML or hand the measurement ID to a framework, CMS, GTM, or consent-platform owner
- Guide and verify the browser-only GA4-to-Search Console product link
- Validate the live tag, DNS, ownership, sitemap, and saved Google resources
- Optionally grant GA4 administrator and Search Console delegated-owner access to another Google Account
- Resume after DNS delays, interrupted runs, permission failures, and other partial results

## Safety model

The workflow separates inspection, planning, approval, writes, and verification.

1. `doctor` checks local readiness and can perform read-only public URL checks.
2. `plan` starts as a preliminary local plan, then becomes approval-ready after OAuth and Analytics account selection.
3. The operator reviews the acting Google identity, OAuth project, Analytics account, domain, URLs, DNS provider, and every planned write.
4. `apply` requires confirmation before making external changes.
5. The runtime reads resources back after writes and saves non-secret IDs for recovery.
6. Repeated runs create or reuse matching resources instead of creating replacements blindly.

Optional access grants have their own plan and approval step. Website deployment, nameserver changes, OAuth publishing changes, consent decisions, billing decisions, and secret reveal remain separate owner actions.

## Requirements

- Node.js 20 or newer
- A POSIX-like shell for the bundled wrapper, or direct Node.js invocation on another platform
- A Google Account allowed to manage the intended Analytics account and website
- A caller-supplied Google Cloud Desktop OAuth client
- An active Cloudflare zone and restricted API token for automated DNS, or access to the site's DNS provider for manual verification
- Control of the website, canonical URL, sitemap, and tag deployment path

A service account is not required. API enablement and quota are still attributed to the Google Cloud project that owns the OAuth client.

## Install

Review the repository before installing it. Installation does not authorize Google, create resources, change DNS, edit a website, or copy credentials.

### Codex

```bash
git clone https://github.com/willscott-v2/provision-google-tracking \
  "${CODEX_HOME:-$HOME/.codex}/skills/provision-google-tracking"
chmod +x "${CODEX_HOME:-$HOME/.codex}/skills/provision-google-tracking/scripts/provision-site"
```

Start a new Codex task and invoke `$provision-google-tracking` with a read-only request.

### Claude Code

Claude Code uses the same `SKILL.md` and supporting-file model. Install personal skills under `~/.claude/skills/`:

```bash
git clone https://github.com/willscott-v2/provision-google-tracking \
  "$HOME/.claude/skills/provision-google-tracking"
chmod +x "$HOME/.claude/skills/provision-google-tracking/scripts/provision-site"
```

Invoke `/provision-google-tracking`. See the official [Claude Code skills documentation](https://code.claude.com/docs/en/skills).

### Grok Build

Grok Build discovers personal skills under `~/.grok/skills/` and documents Claude Code skill compatibility:

```bash
git clone https://github.com/willscott-v2/provision-google-tracking \
  "$HOME/.grok/skills/provision-google-tracking"
chmod +x "$HOME/.grok/skills/provision-google-tracking/scripts/provision-site"
```

Invoke `/provision-google-tracking`. See the official [Grok Build skills documentation](https://docs.x.ai/build/features/skills-plugins-marketplaces).

Codex is the validated target for this release. The package structure is compatible with Claude Code and Grok Build, but the provisioning workflow has not been parity-tested in those agents. `agents/openai.yaml` contains Codex display metadata and is not needed by other agents.

An ordinary chat interface or raw model API will not run the workflow by itself. The agent environment needs local filesystem access, shell execution, Node.js 20+, permission controls, and browser-capable loopback OAuth.

For copy, symlink, archive, update, and validation options, read [Installation and Sharing](references/installation.md).

## Start from zero

If Google Cloud, Analytics, Cloudflare, or website prerequisites are missing, begin with:

1. [Google Cloud Bootstrap](references/google-cloud-bootstrap.md)
2. [Cloudflare and Site Readiness](references/cloudflare-and-site-readiness.md)
3. [Operator Runbook](references/operator-runbook.md)

Those guides cover project ownership, API enablement, OAuth consent settings, test users, Desktop client creation, Analytics account readiness, Cloudflare zones and restricted tokens, sitemap and robots files, and tag or consent architecture.

## First safe run

Copy a sanitized configuration template to a controlled location outside the skill:

```bash
cp assets/site.config.example.json /absolute/path/to/site.json
```

Run the local and online readiness checks:

```bash
./scripts/provision-site doctor \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json \
  --online
```

Authorize the intended Google user, list visible Analytics accounts, and select the account owned by the right person or organization:

```bash
./scripts/provision-site auth \
  --oauth-client /secure/path/to/desktop-client.json \
  --email owner@example.com

./scripts/provision-site accounts \
  --oauth-client /secure/path/to/desktop-client.json \
  --email owner@example.com
```

Generate an authenticated read-only plan:

```bash
./scripts/provision-site plan \
  --config /absolute/path/to/site.json \
  --oauth-client /secure/path/to/desktop-client.json
```

Stop and review that output. Run `apply` only after the exact identities, resources, URLs, provider, and writes have been approved.

The complete command sequence, configuration schema, manual-DNS path, tag handoff, access-grant flow, and validation steps are in the [Operator Runbook](references/operator-runbook.md).

## Secrets and local state

Do not place any of these in this repository or the skill folder:

- OAuth client JSON
- Authorization codes, access tokens, or refresh tokens
- Cloudflare API tokens
- Passwords, cookies, passkeys, recovery details, or MFA codes
- Site-specific configuration or saved state
- Browser traces or screenshots containing secret values

The runtime stores credentials and non-secret recovery state outside the skill. Override the default location with `SITE_PROVISIONER_HOME` when the operator needs a different owner-controlled directory.

If a secret appears in command output, a browser trace, a screenshot, an issue, or a commit, treat it as exposed and rotate it.

## Automation boundaries

Some steps stay with a person or browser session:

- Creating the first Google Analytics account and accepting its terms
- Choosing OAuth audience, publishing status, test users, and any verification process
- Reviewing billing or changing authoritative nameservers
- Revealing and copying the final Cloudflare token
- Deciding how consent and existing GA or GTM tags should work
- Publishing a website change
- Creating and checking the GA4-to-Search Console link

The public Analytics Admin API does not expose the GA4-to-Search Console product-link resource used by this workflow, so that link remains browser-assisted.

## Recovery and validation

Exit code `2` means the run is pending and resumable. It commonly indicates DNS propagation, a manual DNS handoff, or another incomplete external step. Do not create replacement resources or delete saved state.

Read [Recovery and Validation](references/recovery-and-validation.md) before resuming an interrupted or failed run. Read [API Boundaries](references/api-boundaries.md) for scopes, quota attribution, access roles, API versions, and browser-only work.

## Validate the package

```bash
sh -n scripts/provision-site
./scripts/provision-site help
node --test scripts/site-provisioner/test/*.test.js
node scripts/validate-package.js
```

The published package includes sanitized fixtures and uses Node's built-in test runner. The release was validated with 40 tests and secret, stale-assumption, path, syntax, archive, and package scans.

## Project layout

```text
SKILL.md                 Agent instructions and reference routing
agents/openai.yaml       Codex display metadata
assets/                  Sanitized configuration, sitemap, and robots templates
references/              Bootstrap, runbook, recovery, API, and install guidance
scripts/provision-site   Dependency-free CLI wrapper
scripts/site-provisioner Runtime, state, validation, and tests
```

## License

[MIT](LICENSE), copyright 2026 Will Scott.
