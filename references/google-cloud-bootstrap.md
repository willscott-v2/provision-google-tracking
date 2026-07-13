# Google Cloud Bootstrap

Use this reference when the operator does not already have a suitable Google Cloud project, Google Auth Platform configuration, Desktop OAuth client, or Google Analytics account.

## Contents

1. Decide ownership
2. Create or select the Cloud project
3. Enable the APIs
4. Configure Google Auth Platform
5. Create the Desktop OAuth client
6. Prepare Google Analytics ownership
7. Understand quota attribution
8. Authorize the first user
9. Fix common setup errors
10. Safe sequence after bootstrap

## 1. Decide ownership

Identify these owners before creating anything:

- **Google Cloud project owner:** controls OAuth configuration, API enablement, quota, and client credentials.
- **Google Analytics account owner:** controls the account where the new property will live.
- **Domain and DNS owner:** controls the Search Console verification record.
- **Website owner:** controls tag installation, consent behavior, and deployment.

For client work, prefer client-owned assets and grant the operator only the access needed. A personal or agency project can work for an internal tool, but document who will maintain OAuth when staff or vendors change.

Do not attach billing or accept organization-wide policy changes without the project owner's approval.

## 2. Create or select the Cloud project

1. Open the [Google Cloud project selector](https://console.cloud.google.com/projectselector2/home/dashboard).
2. Select an existing owner-approved project or choose **New Project**.
3. Set a durable project name and choose the correct organization and folder when applicable.
4. Record the immutable project ID. The display name can change; the project ID is the safer comparison value.
5. Confirm the operator can manage APIs and OAuth clients in that project.

In an organization-managed project, the operator may need a Cloud administrator. Give the administrator a bounded handoff: confirm the project ID, enable the three named APIs, configure the owner-approved Auth Platform audience and test users, and create one Desktop client. Do not request broad project ownership when those actions can be handled through narrower organization roles or a custom role.

Do not create extra projects to work around API limits. Google applies Analytics API quotas at the Cloud project level and prohibits using extra projects to evade quotas. See [Analytics API limits and quotas](https://developers.google.com/analytics/devguides/limits-and-quotas).

## 3. Enable the APIs

Open **APIs & Services > Library** in the selected project and enable:

1. **Google Analytics Admin API** (`analyticsadmin.googleapis.com`)
2. **Google Search Console API** (`searchconsole.googleapis.com`)
3. **Google Site Verification API** (`siteverification.googleapis.com`)

Use the project selector in the console header before each enable action. The [Analytics Admin API quickstart](https://developers.google.com/analytics/devguides/config/admin/v1/quickstart) and [Search Console authorization guide](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing) both require the relevant API to be active in the calling project.

Enabling an API does not create a service account, Analytics property, or Search Console property. This skill authenticates a person with OAuth and acts only within that person's existing permissions.

## 4. Configure Google Auth Platform

Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in the same project and complete the setup sections.

### Branding

Set:

- A recognizable application name
- A support email controlled by the project owner
- Developer contact email addresses that will remain monitored

Only add a logo, homepage, privacy policy, or terms URL if the owner can maintain them and Google requires them for the chosen publishing path. Do not invent public policy pages.

### Audience

Choose deliberately:

- **Internal:** only accounts inside the selected Google Workspace organization can authorize. An outside account receives `org_internal`.
- **External:** any eligible Google Account can be allowed, subject to the app's publishing status and OAuth rules.

If **External** remains in **Testing**, add every intended operator under **Test users**. Google currently limits Testing access to listed users for non-basic scopes and states that test-user authorizations, including refresh tokens, expire after seven days. See [Manage App Audience](https://support.google.com/cloud/answer/15549945).

Testing is useful for short setup work. It is a poor fit for unattended long-lived automation because repeated consent may be required. Moving to production or seeking OAuth verification is an owner decision. Explain the warning and trade-off; do not change publishing status automatically.

### Data access

Add or review these scopes:

```text
openid
email
https://www.googleapis.com/auth/analytics.edit
https://www.googleapis.com/auth/analytics.readonly
https://www.googleapis.com/auth/webmasters
https://www.googleapis.com/auth/siteverification
```

Add this scope only if the operator will grant or inspect GA4 user access:

```text
https://www.googleapis.com/auth/analytics.manage.users
```

Google may show an unverified-app warning for sensitive scopes. The person granting consent must review the exact app name, project, account, and scopes before continuing.

## 5. Create the Desktop OAuth client

1. Open **Google Auth Platform > Clients**.
2. Select **Create Client**.
3. Choose **Desktop app**.
4. Give the client a durable operator-facing name.
5. Create it and download the JSON immediately.

Google's [OAuth client guide](https://support.google.com/cloud/answer/15549257) documents the Desktop client type and recommends storing downloaded credentials securely.

Keep the file outside source repositories and shared chat folders. On macOS or Linux:

```bash
chmod 600 /secure/path/to/desktop-client.json
```

Pass the path to the CLI. Do not paste the file contents into a prompt or copy it into the skill.

The runtime accepts only a downloaded credential containing an `installed` section. It rejects web-client credentials because their redirect and secret-handling model is different.

## 6. Prepare Google Analytics ownership

If the intended legal entity already has an Analytics account, use it. Google recommends one account for a business and a separate property and web stream for a single website in the common one-site case. See [Google Analytics account structure](https://support.google.com/analytics/answer/9679158).

If no Analytics account exists:

1. Sign in to [Google Analytics](https://analytics.google.com/) with the intended owner.
2. Select **Start measuring**, or open **Admin > Create > Account**.
3. Enter the owner-approved account name.
4. Review the data-sharing settings rather than accepting defaults blindly.
5. Accept the applicable Analytics terms as the owner.

Google's [website setup guide](https://support.google.com/analytics/answer/14183469) covers first-account creation. This skill creates or reuses the property and web stream after an account exists. It does not accept Analytics terms for the user.

Confirm the authenticated user has enough account access to create properties. Then run `accounts` and copy the intended numeric account ID into the site config.

## 7. Understand quota attribution

User OAuth and quota answer different questions:

- OAuth identifies the person and limits the actions to that person's permissions.
- The OAuth client belongs to a Google Cloud project.
- Google measures Analytics API quotas at the Cloud project level even when the authenticated principal is a user rather than a service account.
- API quota does not count website visitors and does not control the browser tag. If the API client reaches a limit, API calls are throttled; the GA tag and Analytics UI are separate.

Do not create a service account just to satisfy quota accounting. This workflow does not require one.

## 8. Authorize the first user

Run:

```bash
<skill-directory>/scripts/provision-site auth \
  --oauth-client /secure/path/to/desktop-client.json \
  --email owner@example.com
```

Check the browser consent screen:

1. The intended Google Account is selected.
2. The app name matches the chosen Cloud project configuration.
3. The requested scopes match the setup work.
4. No password, passkey, recovery detail, or MFA code is handed to Codex.

The local callback uses loopback OAuth with PKCE and state validation. Tokens are stored under `SITE_PROVISIONER_HOME` or the user's config directory with owner-only permissions. The path is keyed by both email and OAuth-client fingerprint.

## 9. Fix common setup errors

| Error | Likely cause | What to check |
|---|---|---|
| `org_internal` | External account used with an Internal app | Project organization and intended user's Workspace membership |
| `access_denied` | Consent was canceled or policy blocked a scope | Selected account, test-user list, Workspace policy, and scopes |
| `redirect_uri_mismatch` | Wrong OAuth client type or altered flow | Use the downloaded Desktop client; do not substitute a web client |
| API not enabled | Required service is disabled in the client project | Project selector and the three enabled APIs |
| No refresh token | Existing grant or consent did not return offline access | Revoke the app grant if appropriate, then authorize again |
| Client fingerprint mismatch | Token came from another Desktop client | Re-run `auth` with the intended client; do not rename or reuse the old token |
| OAuth project mismatch | Desktop client came from a different project than the config expects | Confirm the owner-approved project, then use that project's Desktop client or correct the config only if its expectation was wrong |
| Token expires after seven days | External app is still in Testing | Reauthorize or have the owner choose an appropriate production path |
| No Analytics accounts | User has no Analytics account access | Create the first account or grant the user access, then rerun `accounts` |
| User-management scope missing | Base OAuth grant did not include access management | Rerun `auth --manage-users` with the same client and identity |

If Google changes the Auth Platform UI, use the same ownership and scope decisions rather than guessing based on an old button label.

## 10. Safe sequence after bootstrap

1. Install or select the validated skill folder.
2. Copy the Cloudflare or manual-DNS config template outside the skill and replace every example value.
3. Run `doctor` locally, then add `--online` when public URL checks are allowed.
4. Run `auth` with the owner-approved Desktop client and exact expected email.
5. Run `accounts`, have the owner select the intended Analytics account, and save its numeric ID in the config.
6. For Cloudflare, save the domain-bound token through standard input. For another provider, keep `verification.provider` set to `manual`.
7. Run the preliminary local `plan` for orientation.
8. Rerun `plan` with `--oauth-client` so the CLI reads the actual identity, OAuth project, client fingerprint, and Analytics account.
9. Stop unless the output says `Approval-ready` and every identifier and planned write has been reviewed.
10. Obtain approval for that exact plan before `apply`.
