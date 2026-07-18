import * as clack from "@clack/prompts";

export type FindingAction = "apply-patch" | "view-details" | "override" | "abort";

export async function promptFindingAction(hasPatch = false): Promise<FindingAction> {
  const options: Array<{ value: FindingAction; label: string; hint?: string }> = [
    ...(hasPatch ? [{ value: "apply-patch" as const, label: "Apply suggested patch", hint: "edit the file and block this push" }] : []),
    { value: "view-details", label: "View technical details" },
    { value: "override", label: "Force override with Auth0", hint: "requires audit reason" },
    { value: "abort", label: "Abort push" },
  ];

  const result = await clack.select<FindingAction>({
    message: "What do you want to do?",
    options,
    initialValue: hasPatch ? "apply-patch" : "abort",
  });

  if (clack.isCancel(result)) {
    return "abort";
  }

  return result;
}

export async function promptOverrideReason(): Promise<string> {
  const result = await clack.text({
    message: "Why are you overriding this finding? (required for audit log)",
    placeholder: "e.g., key is already rotated, not in production path",
    validate: (value) => (!value.trim() ? "A reason is required to override." : undefined),
  });

  if (clack.isCancel(result)) {
    return "";
  }

  return result.trim();
}
