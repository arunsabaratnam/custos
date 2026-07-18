export type FindingAction = "apply-patch" | "view-details" | "override" | "abort";

/**
 * Interactive action menu (clack) and override reason prompt.
 *
 * Not implemented yet — later phase wires this using @clack/prompts,
 * defaulting the safest option (abort) per AGENTS.md's UX guidelines.
 */
export async function promptFindingAction(): Promise<FindingAction> {
  throw new Error("promptFindingAction: not implemented");
}

export async function promptOverrideReason(): Promise<string> {
  throw new Error("promptOverrideReason: not implemented");
}
