import { describe, expect, it } from "vitest";
import { buildFindingActionOptions, buildIssueSelectionOptions } from "../../src/ui/prompts.js";
import type { Finding } from "../../src/scanner/types.js";

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

  it("shows Auth0 override only in pre-push mode when override is enabled", () => {
    expect(buildFindingActionOptions({ allowOverride: false }).map((option) => option.value)).not.toContain("override");
    expect(buildFindingActionOptions({ mode: "manual", allowOverride: true }).map((option) => option.value)).not.toContain("override");
    expect(buildFindingActionOptions({ mode: "pre-push", allowOverride: true }).map((option) => option.value)).toContain("override");
  });

  it("can add a Back to issues action before the terminal exit action", () => {
    const values = buildFindingActionOptions({ showBack: true }).map((option) => option.value);

    expect(values).toEqual(["view-details", "back", "abort"]);
  });

  it("builds issue selection options with an exit action", () => {
    const findings: Finding[] = [
      {
        id: "hardcoded-api-key",
        severity: "critical",
        category: "secret",
        title: "Hardcoded API key detected",
        file: "demo_test.ts",
        line: 2,
        evidence: "secret",
        explanation: "bad",
        recommendation: "fix",
        source: "rule",
      },
    ];

    expect(buildIssueSelectionOptions(findings, { mode: "manual" })).toEqual([
      {
        value: 0,
        label: "CRITICAL  Hardcoded API key detected",
        hint: "demo_test.ts:2",
      },
      { value: "abort", label: "Exit scan" },
    ]);
  });
});
