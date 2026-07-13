# Recovery and Validation

Use this reference after an interrupted run, exit code `2`, unexpected remote state, permission error, or failed validation check.

## Contents

- Recovery rules
- OAuth recovery
- Analytics recovery
- Cloudflare and DNS recovery
- Search Console and sitemap recovery
- Access-grant recovery
- Validation statuses
- Manual product-link validation
- Final handoff record

## Recovery rules

1. Preserve the site config and state file.
2. Do not delete or rename remote resources to make the run look clean.
3. Read the saved non-secret state with `status`.
4. Inspect the remote resource named in the error.
5. Fix the prerequisite or permission problem.
6. Rerun the same command with the same config, OAuth client, identity, Analytics account, and domain.
7. Verify the resumed step through read-back output.

Deleting state removes the primary duplicate protection. It does not delete Google or Cloudflare resources.

## OAuth recovery

### No token for the client fingerprint

The same Google email can authorize more than one Desktop client. Tokens are stored by email and client fingerprint because a refresh token issued to one client cannot safely be refreshed through another.

Run `auth` with the intended client. Do not move or rename another client's token file.

### OAuth client project does not match

Confirm which Google Cloud project the owner approved. Then supply a Desktop client downloaded from that project. Change `expectedGoogleCloudProjectId` only when the owner confirms the config expectation was wrong; do not edit it merely to silence the check. Rerun `doctor` and the authenticated plan before any write.

### Legacy email-only token exists

The older runtime keyed tokens only by email. The new runtime refuses to guess which client issued that token. Reauthorize with the intended Desktop client. Keep the legacy file until the new authorization succeeds, then archive or remove it through an owner-approved cleanup.

### Missing scope

For base provisioning, rerun ordinary `auth`. For GA4 access grants, rerun `auth --manage-users`. Use the same client and identity so Google can preserve previously granted scopes.

### Seven-day expiration

Check whether an External OAuth app remains in Testing. Reauthorize for immediate work or ask the project owner to choose an appropriate publishing and verification path. Do not change the audience automatically.

## Analytics recovery

### No accounts returned

The user has no accessible Analytics account. Create the first account in the Analytics UI or grant the user access, then rerun `accounts`.

### Account mismatch

State is bound to the original numeric account. Confirm the owner-selected account. Do not edit state to move a property between accounts.

### Multiple properties or streams match

Stop. Compare numeric property IDs, stream IDs, default URLs, owners, and tag installations. Resolve the ambiguity manually before continuing.

### Saved property or stream is missing

Do not create a replacement automatically. Confirm whether the resource was deleted, moved to trash, or hidden by permissions. Restore access or decide on a new setup through a new approved plan.

## Cloudflare and DNS recovery

### Token missing

Create a token for the exact zone, then save it with `cloudflare-token --domain`. Rerun `apply`.

### Token bound to another domain

The file is intentionally rejected. Select or create the token file for the configured domain. Do not widen the other token to all zones for convenience.

### Zone not found

Check:

- Cloudflare account
- Zone status
- Root-domain spelling
- Zone resource restriction on the token
- `Zone Read` permission

### DNS listing or creation denied

Check `DNS Edit` in the Cloudflare UI (`DNS Write` in API documentation). Keep the token restricted to the intended zone.

### Google cannot see the TXT record

Exit code `2` is expected during propagation. Confirm public TXT results, wait, and rerun `apply`. The provisioner reuses the saved token and record ID.

### Token exposed

Revoke and replace the token. The existing TXT record does not depend on the API token remaining active.

## Search Console and sitemap recovery

### Domain property not readable after add

Google may need time to expose the accepted property. Keep state and rerun. If it persists, confirm the authenticated owner and verified resource.

### Sitemap not readable after submit

Confirm the exact URL returns successful XML on the public site. Rerun after Search Console processes the submission.

### Sitemap errors

Use the Search Console response and live sitemap to identify invalid URLs, redirects, HTML fallbacks, or format problems. Fix and deploy the source sitemap before resubmitting.

Do not report a sitemap as healthy merely because the submit request returned no error.

## Access-grant recovery

### `User not allowed`

The target address may not be registered as a Google Account. Ask for a valid Google Account email or have the user register the address with Google, then rerun.

### Existing GA4 role conflict

The runtime stops rather than replacing roles. Review the existing access binding with the property owner and make a separate role-change plan if needed.

### GA4 succeeded and Search Console failed

State records the verified GA4 grant before starting the Search Console write. Fix the Search Console problem and rerun `grant-access`; the GA4 binding is reused.

### Search Console owner update succeeded but read-back failed

Inspect the verified resource and Search Console user list. Do not repeat owner updates blindly. Rerun only after confirming whether Google eventually exposed the owner.

## Validation statuses

- **PASS:** read-back evidence matches config and saved state.
- **PENDING:** Google is processing a known resource or sitemap.
- **SKIPPED:** optional credentials were not supplied or the check is intentionally browser-only.
- **FAIL:** evidence is missing, conflicting, unreachable, or permission is insufficient.

`validate` exits `1` when any check fails and `2` when nothing fails but at least one check is pending.

## Manual product-link validation

The CLI reports the saved:

- GA4 property name
- Data stream name
- Search Console Domain property

Open the GA4 Search Console Links list and compare all three, plus the linking user and creation date. A live tag, valid sitemap, and verified domain do not prove the product link exists.

## Final handoff record

Record only non-secret operational values:

- Google Cloud project ID
- Acting owner email
- Analytics account name and ID
- GA4 property and stream IDs
- Measurement ID
- Search Console Domain property
- Sitemap URL and status
- Verification resource ID
- Cloudflare zone and DNS record IDs
- Tag source location and deployment result
- Product-link verification result
- Delegated users and roles
- Pending delays or maintenance notes

Do not record OAuth client contents, access tokens, refresh tokens, Cloudflare token values, browser cookies, or authorization URLs.
