import { redactSecrets } from "./security.js";

export class ApiError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export async function requestJson(fetchImpl, url, init, label, secrets = []) {
  const response = await fetchImpl(url, init);
  if (response.status === 204) return undefined;
  const body = await response.text();
  if (!response.ok) {
    const safeBody = redactSecrets(body.slice(0, 4_000), secrets);
    throw new ApiError(
      `${label} failed (${response.status}): ${safeBody}`,
      response.status,
      safeBody,
    );
  }
  if (body.trim() === "") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

export function jsonRequest(body) {
  if (body === undefined) return { headers: { Accept: "application/json" } };
  return {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}
