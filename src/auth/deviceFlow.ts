import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type DeviceFlowResult = {
  accessToken: string;
  claims: Record<string, unknown>;
};

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const OVERALL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes (AGENTS.md)

function requireEnv(): { domain: string; clientId: string; audience?: string } {
  const domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  if (!domain || !clientId) {
    throw new Error("AUTH0_DOMAIN and AUTH0_CLIENT_ID must be set to override with Auth0");
  }
  return { domain, clientId, audience: process.env.AUTH0_AUDIENCE };
}

/**
 * Starts the Auth0 Device Authorization Flow.
 *
 * Auth0's device-code endpoint only supports client_id, scope, and audience.
 * The finding and override reason remain in the Custos audit event, paired
 * with verified Auth0 identity claims.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const { domain, clientId, audience } = requireEnv();

  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("scope", "openid profile email");
  if (audience) form.set("audience", audience);

  const res = await fetch(`https://${domain}/oauth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!res.ok) {
    const detail = await safeText(res);
    if (res.status === 403 && detail.includes("unauthorized_client") && detail.includes("Grant type")) {
      throw new Error(
        "Auth0 Device Code grant is not enabled for this client. In Auth0 Dashboard, open Applications > Applications, select this Native application, then Advanced Settings > Grant Types, enable Device Code, and save changes.",
      );
    }
    throw new Error(`Auth0 device code request failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as DeviceCodeResponse;
}

/**
 * Polls the token endpoint until the user authenticates. Honors
 * `authorization_pending` (keep waiting), `slow_down` (back off), and
 * aborts on `expired_token` / `access_denied` or after a 5-minute timeout.
 */
export async function pollForToken(deviceCode: string, interval: number): Promise<DeviceFlowResult> {
  const { domain, clientId } = requireEnv();
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  let intervalMs = Math.max(1, interval || 5) * 1_000;

  const form = new URLSearchParams();
  form.set("grant_type", DEVICE_CODE_GRANT);
  form.set("device_code", deviceCode);
  form.set("client_id", clientId);

  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error("Auth0 verification timed out after 5 minutes");
    }

    await delay(intervalMs);

    const res = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.ok && typeof payload.access_token === "string") {
      const accessToken = payload.access_token;
      const idToken = typeof payload.id_token === "string" ? payload.id_token : undefined;
      if (!idToken) {
        throw new Error("Auth0 did not return an ID token; verified identity is required for an override");
      }
      return { accessToken, claims: await verifyIdToken(idToken) };
    }

    const error = String(payload.error ?? "");
    if (error === "authorization_pending") {
      continue;
    }
    if (error === "slow_down") {
      intervalMs += 5_000;
      continue;
    }
    if (error === "expired_token") {
      throw new Error("Auth0 device code expired before verification completed");
    }
    if (error === "access_denied") {
      throw new Error("Auth0 verification was denied");
    }
    throw new Error(`Auth0 token polling failed: ${error || `HTTP ${res.status}`}`);
  }
}

/**
 * Verifies Auth0 identity claims through the tenant's JWKS before accepting
 * an override. Restricting this to Auth0's RSA algorithms keeps the verifier
 * compact and uses only Node's built-in crypto primitives.
 */
export async function verifyIdToken(token: string): Promise<Record<string, unknown>> {
  const { domain, clientId } = requireEnv();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Auth0 returned an invalid ID token");

  try {
    const header = decodeJsonSegment(parts[0]!);
    const claims = decodeJsonSegment(parts[1]!);
    const alg = header.alg;
    const kid = header.kid;
    if (typeof alg !== "string" || !["RS256", "RS384", "RS512"].includes(alg) || typeof kid !== "string") {
      throw new Error("Auth0 ID token uses an unsupported signing algorithm");
    }

    validateClaims(claims, domain, clientId);
    const jwks = await fetchJwks(domain);
    const jwk = jwks.find((key) => key.kid === kid);
    if (!jwk) throw new Error("Auth0 signing key was not found in the tenant JWKS");

    const algorithm = { RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512" }[alg]!;
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const isValid = verify(
      algorithm,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2]!, "base64url"),
    );
    if (!isValid) throw new Error("Auth0 ID token signature verification failed");
    return claims;
  } catch {
    throw new Error("Auth0 ID token verification failed");
  }
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid JWT JSON");
  return parsed as Record<string, unknown>;
}

function validateClaims(claims: Record<string, unknown>, domain: string, clientId: string): void {
  if (claims.iss !== `https://${domain}/`) throw new Error("unexpected Auth0 token issuer");
  const audience = claims.aud;
  const hasAudience = audience === clientId || (Array.isArray(audience) && audience.includes(clientId));
  if (!hasAudience) throw new Error("unexpected Auth0 token audience");
  if (typeof claims.exp !== "number" || claims.exp * 1_000 <= Date.now()) throw new Error("expired Auth0 ID token");
  if (typeof claims.nbf === "number" && claims.nbf * 1_000 > Date.now()) throw new Error("Auth0 ID token is not active yet");
}

async function fetchJwks(domain: string): Promise<Array<JsonWebKey & { kid?: string }>> {
  const response = await fetch(`https://${domain}/.well-known/jwks.json`);
  if (!response.ok) throw new Error(`could not fetch Auth0 JWKS (${response.status})`);
  const payload = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(payload.keys)) throw new Error("Auth0 JWKS response is invalid");
  return payload.keys.filter((key): key is JsonWebKey & { kid?: string } => Boolean(key) && typeof key === "object");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "no response body";
  }
}
