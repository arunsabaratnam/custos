import { afterEach, describe, expect, it } from "vitest";
import { writeAuditEvent } from "../../src/audit/writeAudit.js";

describe("writeAuditEvent graceful failure", () => {
  const original = process.env.MONGODB_URI;

  afterEach(() => {
    if (original === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = original;
  });

  it("throws a clear error when MONGODB_URI is unset (caller falls back)", async () => {
    delete process.env.MONGODB_URI;
    await expect(
      writeAuditEvent({ eventType: "scan_passed", action: "allowed", createdAt: new Date() }),
    ).rejects.toThrow(/MONGODB_URI/);
  });
});
