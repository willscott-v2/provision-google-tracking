import { ApiError, jsonRequest, requestJson } from "./http.js";

export class GoogleClient {
  constructor(tokenProvider, fetchImpl = fetch) {
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async request(url, init, label, retry = true) {
    const accessToken = await this.tokenProvider.getAccessToken(false);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    try {
      return await requestJson(
        this.fetchImpl,
        url,
        { ...init, headers },
        label,
        [accessToken],
      );
    } catch (error) {
      if (retry && error instanceof ApiError && error.status === 401) {
        await this.tokenProvider.getAccessToken(true);
        return this.request(url, init, label, false);
      }
      throw error;
    }
  }

  async paged(url, field, label) {
    const values = [];
    let pageToken;
    do {
      const next = new URL(url);
      next.searchParams.set("pageSize", "200");
      if (pageToken) next.searchParams.set("pageToken", pageToken);
      const response = await this.request(next.toString(), { method: "GET" }, label);
      values.push(...(response[field] ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return values;
  }

  async listAnalyticsAccounts() {
    return this.paged(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      "accountSummaries",
      "List Analytics accounts",
    );
  }

  async listProperties(accountId) {
    const url = new URL("https://analyticsadmin.googleapis.com/v1beta/properties");
    url.searchParams.set("filter", `parent:accounts/${accountId}`);
    return this.paged(url.toString(), "properties", "List GA4 properties");
  }

  async getProperty(propertyName) {
    return this.request(
      `https://analyticsadmin.googleapis.com/v1beta/${propertyName}`,
      { method: "GET" },
      "Get GA4 property",
    );
  }

  async createProperty(input) {
    return this.request(
      "https://analyticsadmin.googleapis.com/v1beta/properties",
      {
        method: "POST",
        ...jsonRequest({
          parent: `accounts/${input.accountId}`,
          displayName: input.displayName,
          timeZone: input.timeZone,
          currencyCode: input.currencyCode,
        }),
      },
      "Create GA4 property",
    );
  }

  async listDataStreams(propertyName) {
    return this.paged(
      `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/dataStreams`,
      "dataStreams",
      "List GA4 data streams",
    );
  }

  async createWebDataStream(input) {
    return this.request(
      `https://analyticsadmin.googleapis.com/v1beta/${input.propertyName}/dataStreams`,
      {
        method: "POST",
        ...jsonRequest({
          type: "WEB_DATA_STREAM",
          displayName: input.displayName,
          webStreamData: { defaultUri: input.defaultUri },
        }),
      },
      "Create GA4 web data stream",
    );
  }

  async listPropertyAccessBindings(propertyName) {
    return this.paged(
      `https://analyticsadmin.googleapis.com/v1alpha/${propertyName}/accessBindings`,
      "accessBindings",
      "List GA4 property access bindings",
    );
  }

  async createPropertyAccessBinding(propertyName, email) {
    return this.request(
      `https://analyticsadmin.googleapis.com/v1alpha/${propertyName}/accessBindings`,
      {
        method: "POST",
        ...jsonRequest({ user: email, roles: ["predefinedRoles/admin"] }),
      },
      "Grant GA4 property administrator",
    );
  }

  async listVerifiedResources() {
    const response = await this.request(
      "https://www.googleapis.com/siteVerification/v1/webResource",
      { method: "GET" },
      "List verified domains",
    );
    return response.items ?? [];
  }

  async getVerifiedResource(resourceId) {
    return this.request(
      `https://www.googleapis.com/siteVerification/v1/webResource/${encodeURIComponent(resourceId)}`,
      { method: "GET" },
      "Get verified domain resource",
    );
  }

  async updateVerifiedResource(resourceId, resource) {
    return this.request(
      `https://www.googleapis.com/siteVerification/v1/webResource/${encodeURIComponent(resourceId)}`,
      {
        method: "PUT",
        ...jsonRequest({ site: resource.site, owners: resource.owners }),
      },
      "Update verified domain owners",
    );
  }

  async getDomainVerificationToken(domain) {
    const response = await this.request(
      "https://www.googleapis.com/siteVerification/v1/token",
      {
        method: "POST",
        ...jsonRequest({
          site: { type: "INET_DOMAIN", identifier: domain },
          verificationMethod: "DNS_TXT",
        }),
      },
      "Get domain verification token",
    );
    if (!response.token) throw new Error("Google returned an empty verification token");
    return response.token;
  }

  async verifyDomain(domain) {
    const url = new URL(
      "https://www.googleapis.com/siteVerification/v1/webResource",
    );
    url.searchParams.set("verificationMethod", "DNS_TXT");
    return this.request(
      url.toString(),
      {
        method: "POST",
        ...jsonRequest({ site: { type: "INET_DOMAIN", identifier: domain } }),
      },
      "Verify domain ownership",
    );
  }

  async listSearchConsoleSites() {
    const response = await this.request(
      "https://www.googleapis.com/webmasters/v3/sites",
      { method: "GET" },
      "List Search Console properties",
    );
    return response.siteEntry ?? [];
  }

  async addSearchConsoleSite(siteUrl) {
    await this.request(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}`,
      { method: "PUT", ...jsonRequest() },
      "Add Search Console property",
    );
  }

  async listSitemaps(siteUrl) {
    const response = await this.request(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
      { method: "GET" },
      "List Search Console sitemaps",
    );
    return response.sitemap ?? [];
  }

  async submitSitemap(siteUrl, sitemapUrl) {
    await this.request(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
      { method: "PUT", ...jsonRequest() },
      "Submit Search Console sitemap",
    );
  }
}

export function isApiStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}
