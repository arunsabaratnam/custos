import type { FindingContext } from "./claimsBuilder.js";

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
 * Starts the Auth0 Device Authorization Flow. The finding context is sent
 * as extra parameters so a post-login Action can embed it as JWT claims
 * (best-effort — the Mongo audit record carries the context regardless).
 */
export async function requestDeviceCode(findingContext: FindingContext): Promise<DeviceCodeResponse> {
  const { domain, clientId, audience } = requireEnv();

  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("scope", "openid profile email");
  if (audience) form.set("audience", audience);
  // Pass finding context through as custom params for the Auth0 Action.
  for (const [key, value] of Object.entries(findingContext)) {
    if (value !== undefined) form.set(key, String(value));
  }

  const res = await fetch(`https://${domain}/oauth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!res.ok) {
    const detail = await safeText(res);
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
      // Prefer the id_token for identity claims (email/name); fall back to
      // the access token (a JWT only when an API audience is configured).
      const claims = decodeJwtClaims(idToken) ?? decodeJwtClaims(accessToken) ?? {};
      return { accessToken, claims };
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
 * Decodes the payload segment of a JWT without verifying its signature.
 * Safe here because the token was just fetched directly from Auth0 over
 * TLS — we only need to read the claims, not establish trust. Returns null
 * for opaque (non-JWT) tokens.
 */
function decodeJwtClaims(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
