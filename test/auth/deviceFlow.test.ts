import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { requestDeviceCode, verifyIdToken } = await import("../../src/auth/deviceFlow.js");

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
      requestDeviceCode(),
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

    await requestDeviceCode();

    expect(String(requestBody)).toContain("client_id=client-id");
    expect(String(requestBody)).toContain("scope=openid+profile+email");
    expect(String(requestBody)).toContain("audience=https%3A%2F%2Fapi.example.com");
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
      requestDeviceCode(),
    ).rejects.toThrow("enable Device Code");
  });
});

describe("verifyIdToken", () => {
  it("accepts a valid Auth0-issued RSA ID token", async () => {
    process.env = { ...ORIGINAL_ENV, AUTH0_DOMAIN: "example.auth0.com", AUTH0_CLIENT_ID: "client-id" };
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kid = "test-key";
    const token = signJwt(
      { alg: "RS256", kid, typ: "JWT" },
      { iss: "https://example.auth0.com/", aud: "client-id", exp: Math.floor(Date.now() / 1_000) + 60, email: "dev@example.com" },
      privateKey,
    );
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" }] })));

    await expect(verifyIdToken(token)).resolves.toMatchObject({ email: "dev@example.com" });
  });

  it("rejects a token with a bad signature", async () => {
    process.env = { ...ORIGINAL_ENV, AUTH0_DOMAIN: "example.auth0.com", AUTH0_CLIENT_ID: "client-id" };
    const trusted = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kid = "test-key";
    const token = signJwt(
      { alg: "RS256", kid, typ: "JWT" },
      { iss: "https://example.auth0.com/", aud: "client-id", exp: Math.floor(Date.now() / 1_000) + 60 },
      attacker.privateKey,
    );
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [{ ...trusted.publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" }] })));

    await expect(verifyIdToken(token)).rejects.toThrow("verification failed");
  });
});

function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: KeyObject): string {
  const input = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  return `${input}.${signer.sign(privateKey).toString("base64url")}`;
}
