import { describe, expect, it } from "vitest";
import { buildFindingActionOptions } from "../../src/ui/prompts.js";

describe("buildFindingActionOptions", () => {
  it("labels the abort action as Exit scan in manual mode", () => {
    const options = buildFindingActionOptions({ mode: "manual" });

    expect(options).toContainEqual(expect.objectContaining({ value: "abort", label: "Exit scan" }));
  });

  it("labels the abort action as Abort push in pre-push mode", () => {
    const options = buildFindingActionOptions({ mode: "pre-push" });

    expect(options).toContainEqual(expect.objectContaining({ value: "abort", label: "Abort push" }));
  });

  it("shows Apply suggested patch only when a patch is available", () => {
    expect(buildFindingActionOptions({ hasPatch: false }).map((option) => option.value)).not.toContain("apply-patch");
    expect(buildFindingActionOptions({ hasPatch: true }).map((option) => option.value)).toContain("apply-patch");
  });
});
