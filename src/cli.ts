#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runScan } from "./commands/scan.js";
import { runAudit } from "./commands/audit.js";
import { runDoctor } from "./commands/doctor.js";
import { runHelp } from "./commands/help.js";
import { runSelect } from "./commands/select.js";
import { runWelcome } from "./commands/welcome.js";

const program = new Command();

program
  .name("custos")
  .description("Terminal-native, local-first developer security sidekick")
  .version("0.1.0")
  .action(async () => {
    await runWelcome();
  });

program
  .command("help")
  .description("show a simple guide to Custos commands")
  .action(async () => {
    await runHelp();
  });

program
  .command("select")
  .description("navigate executable Custos commands with the keyboard")
  .action(async () => {
    await runSelect();
  });

program
  .command("init")
  .description("install Custos into the current Git repository")
  .action(async () => {
    await runInit();
  });

program
  .command("scan")
  .description("scan the outgoing diff for security findings")
  .option("--pre-push", "run in pre-push hook mode (exit 0 allow / 1 block)")
  .option("--json", "emit machine-readable JSON output")
  .action(async (options: { prePush?: boolean; json?: boolean }) => {
    await runScan({ prePush: options.prePush, json: options.json });
  });

program
  .command("audit")
  .description("show recent audit events from MongoDB")
  .action(async () => {
    await runAudit();
  });

program
  .command("doctor")
  .description("validate the environment before a demo")
  .action(async () => {
    await runDoctor();
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } finally {
    // A live mongoose connection keeps the event loop alive, which would
    // hang `git push` forever. Tear it down (no-op if never connected) and
    // hard-exit with whatever exit code the command set as a backstop.
    try {
      const { disconnectMongo } = await import("./audit/mongo.js");
      await disconnectMongo();
    } catch {
      // Never let teardown failure change the command's outcome.
    }
    process.exit(process.exitCode ?? 0);
  }
}

void main();
