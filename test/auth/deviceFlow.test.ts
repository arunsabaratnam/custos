import { afterEach, describe, expect, it } from "vitest";

const { requestDeviceCode } = await import("../../src/auth/deviceFlow.js");

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
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
});
