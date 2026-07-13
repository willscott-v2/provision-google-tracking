# Cloudflare and Site Readiness

Use this reference before DNS verification, sitemap submission, tag installation, or production deployment.

## Contents

1. Confirm domain ownership
2. Start Cloudflare from scratch
3. Prepare an existing Cloudflare zone
4. Create the least-privilege token
5. Save the token safely
6. Handle another DNS provider
7. Prepare the website
8. Create sitemap and robots files
9. Choose the tag method
10. Verify deployment readiness

## 1. Confirm domain ownership

Identify the person or organization authorized to change:

- Registrar nameservers
- Cloudflare zone settings and DNS records
- Website source and deployment
- Cookie or consent configuration

DNS verification proves control of the root domain. Do not add a zone, change nameservers, or create verification records based only on a matching brand name.

## 2. Start Cloudflare from scratch

Skip this section when the domain already uses an active Cloudflare zone.

1. Create or sign in to the owner-approved [Cloudflare account](https://dash.cloudflare.com/).
2. Select **Add a domain** and enter the root domain.
3. Choose the owner-approved plan.
4. Review every DNS record Cloudflare imports. Compare the current authoritative DNS before changing nameservers.
5. Record the nameservers Cloudflare assigns.
6. Stop and obtain explicit approval for the nameserver change.
7. Change nameservers at the registrar through the owner's account.
8. Wait for Cloudflare to report the zone as active.
9. Verify the website, mail records, and other critical hostnames still resolve.

Nameserver changes affect the entire domain, not only Google verification. A missed MX, CNAME, or TXT record can interrupt unrelated services. This skill does not automate registrar changes.

If the owner does not want to move DNS to Cloudflare, use the provider handoff in section 6.

## 3. Prepare an existing Cloudflare zone

Confirm:

- The zone status is **Active**.
- The root domain matches the site config.
- The selected Cloudflare account is the intended owner.
- Cloudflare's assigned nameservers are authoritative in public DNS.
- The operator can read the zone and edit DNS.

Do not reuse a Worker deployment token or a broad account token just because it already exists. A separate DNS-verification token is easier to audit and revoke.

## 4. Create the least-privilege token

Open **My Profile > API Tokens > Create Token**. Start with the **Edit zone DNS** template or a custom token.

Set only:

| Scope | Permission |
|---|---|
| Zone | DNS: Edit |
| Zone | Zone: Read |
| Zone Resources | Include > Specific zone > the intended domain |

Cloudflare's UI uses `DNS Edit`. Current API documentation calls the corresponding write permission `DNS Write`. The [DNS record creation endpoint](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/) requires DNS Write, while zone lookup requires Zone Read. Cloudflare's [permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) lists both zone-level permission groups.

Do not grant:

- All zones when one zone is enough
- Account administration
- Workers editing
- Billing
- API token management
- Global API key access

Review the summary before creating the token.

## 5. Save the token safely

Have the user click the final create action and copy the one-time value. Avoid allowing the value to enter browser automation output or screenshots.

Store it through standard input:

```bash
pbpaste | <skill-directory>/scripts/provision-site cloudflare-token \
  --domain example.com
```

The runtime writes a domain-bound JSON credential with mode `0600` under:

```text
${SITE_PROVISIONER_HOME:-~/.config/site-provisioner}/cloudflare/example.com.json
```

The token value is never accepted as a CLI argument. An explicit `--token-file` path is available for owner-managed storage, but the file still records its bound domain and is rejected for another domain.

If the token appears in a trace or output, revoke it and create a replacement. The DNS record remains active after token revocation.

## 6. Handle another DNS provider

The bundled automated adapter supports Cloudflare. For Route 53, GoDaddy, Squarespace Domains, or another provider:

1. Set `verification.provider` to `manual` in the site config.
2. Include the manual TXT handoff in the exact approval-ready plan.
3. Run the approved `apply`. It creates or reuses GA4, saves the verification token, prints the exact TXT name and content, and exits `2` if Google cannot see the record yet.
4. Have the owner add the record in the provider UI, or add and test a provider adapter before a later package release.
5. Confirm the TXT record through public DNS.
6. Rerun the same `apply` command. The runtime skips Cloudflare, verifies through Google, and resumes Search Console and sitemap work.

Do not bypass the state file by starting a second config or requesting another token.

## 7. Prepare the website

Confirm these inputs from live evidence and editable source:

- Root domain
- Canonical HTTPS URL
- Sitemap URL
- Reporting time zone
- Currency
- Editable source directory or framework repository
- Existing deployment process
- Existing GA4, legacy Analytics, GTM, or consent tooling
- Permission to publish

Fetch the live homepage and search rendered HTML and bundled source for:

```text
googletagmanager.com/gtag/js
googletagmanager.com/gtm.js
G-
GTM-
gtag('config'
```

If an existing tag is present, identify its owner and measurement ID. Do not add a second loader or replace a GTM design without approval.

## 8. Create sitemap and robots files

The skill includes:

- `assets/sitemap.example.xml`
- `assets/robots.example.txt`

Replace every `example.com` value. Include only canonical, indexable URLs the owner intends to expose.

Common source locations:

- **Static HTML or Vite:** place files in the public/static directory copied to the deployment root.
- **Next.js App Router:** use `app/sitemap.ts` and `app/robots.ts`, or verified static files when the project design requires them.
- **CMS:** use the CMS's supported sitemap and robots controls. Do not overwrite generated files without understanding the CMS behavior.

Before submission, verify:

```bash
curl -i https://example.com/sitemap.xml
curl -i https://example.com/robots.txt
```

The sitemap must return a successful response and XML content rather than an HTML application shell. The robots file should point to the canonical sitemap URL. Validate the deployed files, not only local source.

## 9. Choose the tag method

Use one method:

- **Static HTML:** preview and use the bundled `install-tag` command.
- **Next.js or React:** add the measurement ID to editable source or an environment variable using the project's existing component pattern.
- **Google Tag Manager:** configure GA4 inside the existing container after confirming ownership and publish permission.
- **CMS integration:** enter the `G-` ID through the supported integration when available.
- **Consent platform:** connect GA4 through the current consent design and verify default consent behavior with the site owner.

Do not patch generated output when an editable source exists. Do not bypass a consent banner or assume one jurisdiction's rules apply everywhere.

## 10. Verify deployment readiness

Before publishing a tag or sitemap change:

1. Run the project's test, lint, typecheck, and build commands that exist.
2. Inspect the production build for one intended loader.
3. Confirm sitemap and robots files are included with the expected content type.
4. Review the exact deployment target.
5. Obtain deployment approval separately from Google and DNS provisioning approval.

After publishing:

1. Fetch the canonical page, sitemap, and robots file.
2. Confirm one matching measurement ID and no unintended GTM loader.
3. Check the browser console for tag-related errors.
4. Run the skill's authenticated `validate` command.
5. Verify the GA4-to-Search Console product link in Analytics Admin.
