# API Boundaries and Official Sources

Use this reference to verify why a step is automated, browser-assisted, or intentionally manual.

## Google user OAuth

This skill uses the OAuth native-app loopback flow with a Desktop client, PKCE, state validation, offline access, and an expected-email check. Google documents Desktop clients and loopback redirect behavior in [OAuth 2.0 for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app).

A service account is not required. The user still needs permission in the selected Analytics account and must own or be able to verify the Search Console domain.

## Required scopes

| Purpose | Scope |
|---|---|
| Identify the consenting account | `openid`, `email` |
| Create and read GA4 configuration | `analytics.edit`, `analytics.readonly` |
| Add Search Console property and sitemap | `webmasters` |
| Obtain tokens, verify domains, manage owners | `siteverification` |
| Optional GA4 access bindings | `analytics.manage.users` |

Search Console requires authenticated-user OAuth. See [Authorize Search Console Requests](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing).

## Cloud project quota

The OAuth client belongs to a Google Cloud project. Google documents Analytics API quotas at the Cloud project level in [Limits and quotas on API requests](https://developers.google.com/analytics/devguides/limits-and-quotas). User OAuth changes the acting principal; it does not remove project-level API enablement or quota accounting.

The website tag does not use this provisioning CLI's Admin API quota.

## GA4 property and stream

The runtime uses the Analytics Admin API v1beta for account summaries, properties, and data streams. It creates one property under an owner-confirmed account and one matching web stream. The [Analytics Admin API overview](https://developers.google.com/analytics/devguides/config/admin/v1) lists these management capabilities.

## GA4 administrator access

Property access bindings are currently exposed on the Admin API v1alpha surface. The role is `predefinedRoles/admin`. See the [properties.accessBindings resource](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties.accessBindings).

Alpha surfaces can change. Keep this command separate from base provisioning and verify every write through a list read-back.

## Site Verification and delegated ownership

The runtime requests a `DNS_TXT` token, verifies an `INET_DOMAIN`, and updates the verified resource owner list. Google documents owner-list updates in [WebResource: update](https://developers.google.com/site-verification/v1/webResource/update).

The authenticated verified owner remains in the list. The runtime only adds the requested Google Account and never removes owners.

## Search Console property and sitemap

The Search Console API supports adding a site, listing permission levels, listing sitemaps, and submitting a sitemap. Domain properties use `sc-domain:example.com` in Search Console API calls after root-domain verification.

Submission acceptance does not prove processing success. The validator reads the sitemap entry and reports pending, warnings, and errors.

## Cloudflare DNS

The runtime lists the active zone, lists matching TXT records, creates only the exact missing verification record, and reads it back. Cloudflare documents `DNS Write` for [Create DNS Record](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/) and the available zone permissions in its [API token permissions reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).

The recommended token is restricted to one zone with Zone Read and DNS Edit in the Cloudflare UI.

For another DNS provider, `verification.provider: "manual"` returns the TXT handoff and skips all Cloudflare API work. The owner adds the record, and the same saved-state run resumes Google verification. The package does not automate another provider's credentials or DNS API.

## GA4-to-Search Console product link

Google's public Analytics Admin API resource list includes several product-link types but does not expose a Search Console link resource. See the current [Admin API REST resources](https://developers.google.com/analytics/devguides/config/admin/v1/rest).

Complete and verify this link in Analytics Admin. Do not infer link success from domain ownership, sitemap submission, or the presence of a GA tag.

## Browser-only and owner-only decisions

Use browser control for ordinary navigation when available. Keep these with the person:

- Passwords, passkeys, recovery information, and MFA
- Analytics and Google Cloud terms
- Billing attachment
- OAuth audience and publishing changes
- Registrar nameserver changes
- Final Cloudflare token reveal and copy
- Final review before GA4/Search Console link submission

If current official documentation conflicts with this package, stop and update the package before a live write.
