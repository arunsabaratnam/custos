import { afterEach, describe, expect, it, vi } from "vitest";

const { requestDeviceCode } = await import("../../src/auth/deviceFlow.js");

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

describe("requestDeviceCode", () => {
  it("reports the Auth0 override configuration error with correct spacing", async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AUTH0_DOMAIN;
    delete process.env.AUTH0_CLIENT_ID;

    await expect(
      requestDeviceCode({
        "https://custos/finding_id": "finding-1",
        "https://custos/severity": "critical",
        "https://custos/rule": "hardcoded-api-key",
        "https://custos/file": "src/server.ts",
        "https://custos/override_reason": "test",
      }),
    ).rejects.toThrow("AUTH0_DOMAIN and AUTH0_CLIENT_ID must be set to override with Auth0");
  });

  it("sends only Auth0-supported device-code parameters", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      AUTH0_DOMAIN: "example.auth0.com",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_AUDIENCE: "https://api.example.com",
    };
    let requestBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        requestBody = init?.body;
        return Response.json({
          device_code: "device-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://example.com/activate",
          expires_in: 300,
          interval: 5,
        });
      }),
    );

    await requestDeviceCode({
      "https://custos/finding_id": "finding-1",
      "https://custos/severity": "critical",
      "https://custos/rule": "hardcoded-api-key",
      "https://custos/file": "src/server.ts",
      "https://custos/override_reason": "test",
    });

    expect(String(requestBody)).toContain("client_id=client-id");
    expect(String(requestBody)).toContain("scope=openid+profile+email");
    expect(String(requestBody)).toContain("audience=https%3A%2F%2Fapi.example.com");
    expect(String(requestBody)).not.toContain("custos");
    expect(String(requestBody)).not.toContain("finding-1");
  });

  it("explains how to fix a missing Auth0 Device Code grant", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      AUTH0_DOMAIN: "example.auth0.com",
      AUTH0_CLIENT_ID: "client-id",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "unauthorized_client",
            error_description:
              "Grant type 'urn:ietf:params:oauth:grant-type:device_code' not allowed for the client.",
          }),
          { status: 403 },
        ),
      ),
    );

    await expect(
      requestDeviceCode({
        "https://custos/finding_id": "finding-1",
        "https://custos/severity": "critical",
        "https://custos/rule": "hardcoded-api-key",
        "https://custos/file": "src/server.ts",
        "https://custos/override_reason": "test",
      }),
    ).rejects.toThrow("enable Device Code");
  });
});
