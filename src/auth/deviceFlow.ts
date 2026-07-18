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

/**
 * Auth0 Device Authorization Flow: request a device code, then poll until
 * the user completes authentication, respecting `interval`/`slow_down`,
 * and time out after 5 minutes per AGENTS.md's "Auth0 Integration" section.
 *
 * Not implemented yet — later phase wires this to AUTH0_DOMAIN,
 * AUTH0_CLIENT_ID, AUTH0_AUDIENCE.
 */
export async function requestDeviceCode(
  _findingContext: FindingContext,
): Promise<DeviceCodeResponse> {
  throw new Error("requestDeviceCode: not implemented");
}

export async function pollForToken(
  _deviceCode: string,
  _interval: number,
): Promise<DeviceFlowResult> {
  throw new Error("pollForToken: not implemented");
}
