const SECRET_KEYS = [
  "access_token",
  "refresh_token",
  "client_secret",
  "authorization",
  "cloudflare_api_token",
  "token",
];

export function redactSecrets(input, explicitSecrets = []) {
  let result = String(input);
  for (const secret of explicitSecrets) {
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  result = result.replace(
    /Bearer\s+[A-Za-z0-9._~+\/-]+/gi,
    "Bearer [REDACTED]",
  );
  for (const key of SECRET_KEYS) {
    const jsonPattern = new RegExp(`("${key}"\\s*:\\s*")[^"]+("?)`, "gi");
    result = result.replace(jsonPattern, `$1[REDACTED]$2`);
    const headerPattern = new RegExp(`(${key}\\s*[:=]\\s*)[^\\s,}]+`, "gi");
    result = result.replace(headerPattern, `$1[REDACTED]`);
  }
  return result;
}

export function safeErrorMessage(error, secrets = []) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, secrets);
}
