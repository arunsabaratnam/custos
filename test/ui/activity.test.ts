import { afterEach, describe, expect, it, vi } from "vitest";
import { shimmerColor, startActivity } from "../../src/ui/activity.js";

function brightness([r, g, b]: [number, number, number]): number {
  return r + g + b;
}

/** Temporarily overrides process.stderr.isTTY for a test body. */
function withStderrTTY(isTTY: boolean, fn: () => Promise<void> | void): Promise<void> | void {
  const original = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: isTTY });
  const restore = () => {
    if (original) Object.defineProperty(process.stderr, "isTTY", original);
    else delete (process.stderr as { isTTY?: boolean }).isTTY;
  };
  const result = fn();
  if (result instanceof Promise) return result.finally(restore);
  restore();
  return result;
}

describe("shimmerColor", () => {
  it("is brightest (white) exactly at the head", () => {
    const atHead = shimmerColor(5, 5, 10);
    expect(atHead).toEqual([255, 255, 255]);
  });

  it("fades toward gold as distance from the head grows", () => {
    const near = shimmerColor(4, 5, 10);
    const far = shimmerColor(0, 5, 10);
    expect(brightness(shimmerColor(5, 5, 10))).toBeGreaterThan(brightness(near));
    expect(brightness(near)).toBeGreaterThan(brightness(far));
  });
});

describe("startActivity inert path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CUSTOS_NO_ANIM;
  });

  it("creates no timers and prints one plain line when stderr is not a TTY", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await withStderrTTY(false, async () => {
      const activity = startActivity("Scanning changes", { kind: "scan" });
      activity.update("Parsing diff");
      activity.detail("3 hunks");
      await activity.succeed("Done");
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
    const writes = writeSpy.mock.calls.map((c) => String(c[0]));
    const settleLines = writes.filter((w) => w.includes("Done"));
    expect(settleLines).toHaveLength(1);
    // Inert path must not emit cursor-control escape codes.
    expect(writes.some((w) => w.includes("\x1b[?25l"))).toBe(false);
  });

  it("forces the static path when CUSTOS_NO_ANIM=1 even on a TTY", async () => {
    process.env.CUSTOS_NO_ANIM = "1";
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await withStderrTTY(true, async () => {
      const activity = startActivity("Working", { kind: "think" });
      await activity.succeed("ok");
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
