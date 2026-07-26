import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  select: vi.fn(async () => "abort"),
  confirm: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(() => false),
}));

const clack = await import("@clack/prompts");
const { promptFindingAction } = await import("../../src/ui/prompts.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("promptFindingAction", () => {
  it("labels the abort action as Exit scan in manual mode", async () => {
    await promptFindingAction({ mode: "manual" });

    expect(clack.select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([expect.objectContaining({ value: "abort", label: "Exit scan" })]),
      }),
    );
  });

  it("labels the abort action as Abort push in pre-push mode", async () => {
    await promptFindingAction({ mode: "pre-push" });

    expect(clack.select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([expect.objectContaining({ value: "abort", label: "Abort push" })]),
      }),
    );
  });
});
