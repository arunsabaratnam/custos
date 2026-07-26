import { execa } from "execa";
import chalk from "chalk";
import { readRepoConfig, resolveRepoState } from "./repoState.js";
import { accent } from "../ui/theme.js";

export async function runDoctor(): Promise<void> {
  console.log(chalk.bold("Custos doctor"));
  console.log("");

  renderCheck("Node", true, process.version);

  const gitVersion = await getGitVersion();
  renderCheck("Git", Boolean(gitVersion), gitVersion ?? "git is not available");

  const authEnabled = await isAuthEnabled();
  const authDomain = Boolean(process.env.AUTH0_DOMAIN);
  const authClientId = Boolean(process.env.AUTH0_CLIENT_ID);
  const authAudience = Boolean(process.env.AUTH0_AUDIENCE);

  renderCheck("Auth0 override", authEnabled, authEnabled ? "enabled" : "disabled");

  if (authEnabled) {
    renderCheck(
      "AUTH0_DOMAIN",
      authDomain,
      authDomain ? process.env.AUTH0_DOMAIN! : "required when Auth0 override is enabled",
    );
    renderCheck(
      "AUTH0_CLIENT_ID",
      authClientId,
      authClientId ? "configured" : "required when Auth0 override is enabled",
    );

    if (authAudience) {
      renderCheck("AUTH0_AUDIENCE", true, "configured");
    }

    if (process.env.AUTH0_CLIENT_SECRET) {
      renderCheck("AUTH0_CLIENT_SECRET", true, "present but not used by Device Authorization Flow");
    }
  }

  renderCheck(
    "MongoDB audit",
    process.env.CUSTOS_AUDIT_ENABLED !== "false",
    process.env.CUSTOS_AUDIT_ENABLED === "false" ? "disabled" : "enabled",
  );
  renderCheck("MONGODB_URI", Boolean(process.env.MONGODB_URI), process.env.MONGODB_URI ? "configured" : "not configured");
  renderCheck(
    "Backboard AI",
    Boolean(process.env.BACKBOARD_API_KEY),
    process.env.BACKBOARD_API_KEY ? "configured" : "not configured",
  );

  if (authEnabled && (!authDomain || !authClientId)) {
    process.exitCode = 1;
  } else if (!gitVersion) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

async function isAuthEnabled(): Promise<boolean> {
  try {
    const state = await resolveRepoState();
    const config = await readRepoConfig(state.configPath);
    if (config) {
      return config.auth.enabled || parseBooleanEnv(process.env.CUSTOS_ALLOW_OVERRIDE, false);
    }
  } catch {
    // `custos doctor` should still be useful outside a Git repo.
  }

  return parseBooleanEnv(process.env.CUSTOS_ALLOW_OVERRIDE, false);
}

async function getGitVersion(): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["--version"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

function renderCheck(label: string, ok: boolean, detail: string): void {
  const icon = ok ? accent("✓") : chalk.red("✗");
  const value = ok ? chalk.white(detail) : chalk.yellow(detail);
  console.log(`${icon} ${chalk.bold(label.padEnd(18))} ${value}`);
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
