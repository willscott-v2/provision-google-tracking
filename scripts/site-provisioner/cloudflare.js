import { ApiError, jsonRequest, requestJson } from "./http.js";

function comparableTxt(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export class CloudflareClient {
  constructor(apiToken, fetchImpl = fetch) {
    this.apiToken = apiToken;
    this.fetchImpl = fetchImpl;
    if (!apiToken.trim()) throw new Error("A Cloudflare API token is required");
  }

  async request(apiPath, init, label) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiToken}`);
    const envelope = await requestJson(
      this.fetchImpl,
      `https://api.cloudflare.com/client/v4${apiPath}`,
      { ...init, headers },
      label,
      [this.apiToken],
    );
    if (!envelope.success) {
      const errors = (envelope.errors ?? [])
        .map((error) => `${error.code}: ${error.message}`)
        .join(", ");
      throw new Error(`${label} failed: ${errors || "unknown Cloudflare error"}`);
    }
    return envelope.result;
  }

  async findZone(domain) {
    const query = new URLSearchParams({ name: domain, status: "active" });
    const zones = await this.request(
      `/zones?${query.toString()}`,
      { method: "GET" },
      "Find Cloudflare zone",
    );
    const zone = zones.find((candidate) => candidate.name === domain);
    if (!zone) {
      throw new Error(`The Cloudflare token cannot access an active ${domain} zone`);
    }
    return zone;
  }

  async getDnsRecord(zoneId, recordId) {
    try {
      return await this.request(
        `/zones/${zoneId}/dns_records/${recordId}`,
        { method: "GET" },
        "Get Cloudflare DNS record",
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async listTxtRecords(zoneId, domain) {
    const query = new URLSearchParams({ type: "TXT", name: domain, per_page: "100" });
    return this.request(
      `/zones/${zoneId}/dns_records?${query.toString()}`,
      { method: "GET" },
      "List Cloudflare TXT records",
    );
  }

  async createTxtRecord(zoneId, domain, content) {
    return this.request(
      `/zones/${zoneId}/dns_records`,
      {
        method: "POST",
        ...jsonRequest({
          type: "TXT",
          name: domain,
          content,
          ttl: 1,
          comment: "Google Site Verification managed by site-provisioner",
        }),
      },
      "Create Cloudflare verification TXT record",
    );
  }

  async ensureVerificationTxt(input) {
    const zone = input.knownZoneId
      ? { id: input.knownZoneId }
      : await this.findZone(input.domain);
    if (input.knownRecordId) {
      const known = await this.getDnsRecord(zone.id, input.knownRecordId);
      if (
        known?.type === "TXT" &&
        comparableTxt(known.content) === comparableTxt(input.content)
      ) {
        return { zoneId: zone.id, recordId: known.id, reused: true };
      }
    }
    const records = await this.listTxtRecords(zone.id, input.domain);
    const existing = records.find(
      (record) => comparableTxt(record.content) === comparableTxt(input.content),
    );
    if (existing) return { zoneId: zone.id, recordId: existing.id, reused: true };
    const created = await this.createTxtRecord(zone.id, input.domain, input.content);
    const readBack = await this.getDnsRecord(zone.id, created.id);
    if (
      !readBack ||
      comparableTxt(readBack.content) !== comparableTxt(input.content)
    ) {
      throw new Error("Cloudflare TXT record could not be verified after creation");
    }
    return { zoneId: zone.id, recordId: created.id, reused: false };
  }
}
