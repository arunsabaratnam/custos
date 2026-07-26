import readline from "node:readline";
import chalk from "chalk";
import { listAuditEvents } from "../audit/writeAudit.js";
import type { AuditEvent, Finding } from "../scanner/types.js";
import { accent, severityColor } from "../ui/theme.js";

export type AuditOptions = {
  limit?: number;
  pager?: boolean;
  table?: boolean;
};

const DEFAULT_LIMIT = 50;

/**
 * `custos audit` — shows recent audit events from MongoDB.
 *
 * The output is intentionally shaped like a compact `git log`: newest event
 * first, one block per audit record, with enough context for the demo story
 * (commit, repo, branch, actor, finding, override reason, and Auth0 claims).
 */
export async function runAudit(options: AuditOptions = {}): Promise<void> {
  const limit = normalizeLimit(options.limit);

  try {
    const events = await listAuditEvents(limit);
    const lines = options.table ? formatAuditTable(events) : formatAuditEvents(events);

    if (options.table) {
      printLines(lines, { preserveWideLines: true });
    } else if (options.pager !== false && shouldPage(lines)) {
      await pageLines(lines);
    } else {
      printLines(lines);
    }

    process.exitCode = 0;
  } catch (err) {
    console.error(chalk.red("[custos] Could not read audit events:"), (err as Error).message);
    console.error(chalk.dim("Check MONGODB_URI, MONGODB_DB, and Atlas network access."));
    process.exitCode = 1;
  }
}

export function formatAuditTable(events: AuditEvent[]): string[] {
  if (events.length === 0) {
    return [
      chalk.dim("No audit events found."),
    ];
  }

  const columns = [
    { label: "Commit", width: 12 },
    { label: "Time", width: 16 },
    { label: "Event", width: 18 },
    { label: "Action", width: 10 },
    { label: "Severity", width: 10 },
    { label: "Finding", width: 30 },
    { label: "File", width: 22 },
    { label: "User", width: 24 },
  ] as const;

  const header = columns.map((column) => pad(column.label, column.width)).join("  ");
  const divider = columns.map((column) => "─".repeat(column.width)).join("  ");
  const bodyLines = [accent(header), accent(divider)];

  for (const event of events) {
    const finding = event.finding;
    const severity = finding?.severity ?? "-";
    const values = [
      { value: event.commitSha?.slice(0, 12) ?? "unknown", width: columns[0].width },
      { value: formatDateShort(event.createdAt), width: columns[1].width },
      { value: event.eventType, width: columns[2].width },
      { value: event.action, width: columns[3].width },
      { value: severity, width: columns[4].width, color: finding ? severityColor[finding.severity] : chalk.white },
      { value: finding?.title ?? "-", width: columns[5].width },
      { value: formatLocation(finding), width: columns[6].width },
      { value: event.userEmail ?? event.userId ?? "unknown", width: columns[7].width },
    ];

    bodyLines.push(
      values
        .map((cell) => {
          const text = pad(cell.value, cell.width);
          return cell.color ? cell.color(text) : chalk.white(text);
        })
        .join(chalk.white("  ")),
    );
  }

  return blockLines(bodyLines);
}

export function formatAuditEvents(events: AuditEvent[]): string[] {
  if (events.length === 0) {
    return [
      chalk.bold("Custos audit log"),
      "",
      chalk.dim("No audit events found."),
    ];
  }

  const lines = [chalk.bold("Custos audit log"), chalk.dim("Newest events first. Press q to quit when paging."), ""];

  for (const event of events) {
    const finding = event.finding;
    const commit = event.commitSha ? event.commitSha.slice(0, 12) : "unknown";
    const subject = finding?.title ?? event.eventType;
    const eventLines = [
      `${chalk.yellow("commit")} ${commit}`,
      `${chalk.bold("Action:")} ${event.eventType}`,
      `${chalk.bold("Result:")} ${event.action}`,
      `${chalk.bold("Repo:")}   ${event.repoName} (${shortHash(event.repoPathHash)})`,
      `${chalk.bold("Branch:")} ${event.branch ?? "unknown"}`,
      `${chalk.bold("User:")}   ${event.userEmail ?? event.userId ?? "unknown"}`,
      `${chalk.bold("Date:")}   ${formatDate(event.createdAt)}`,
      `${chalk.bold("Event:")}  ${subject}`,
    ];

    if (finding) {
      eventLines.push(...formatFindingLines(finding));
    }

    if (event.overrideReason) {
      eventLines.push(`${chalk.bold("Reason:")} ${event.overrideReason}`);
    }

    const claimLines = formatJwtClaimLines(event.jwtClaims);
    if (claimLines.length > 0) {
      eventLines.push(`${chalk.bold("JWT claims:")}`);
      eventLines.push(...claimLines);
    }

    lines.push(...blockLines(eventLines));
    lines.push("");
  }

  return lines;
}

function formatLocation(finding: Finding | undefined): string {
  if (!finding) {
    return "-";
  }
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

function formatFindingLines(finding: Finding): string[] {
  const location = formatLocation(finding);
  return [
    `${chalk.bold("Finding:")} ${finding.title}`,
    `${chalk.bold("Severity:")} ${finding.severity}`,
    `${chalk.bold("Category:")} ${finding.category}`,
    `${chalk.bold("Rule:")}     ${finding.id}`,
    `${chalk.bold("File:")}     ${location}`,
  ];
}

function formatJwtClaimLines(claims: Record<string, unknown> | undefined): string[] {
  if (!claims || Object.keys(claims).length === 0) {
    return [];
  }

  const important = [
    "email",
    "sub",
    "https://custos/finding_id",
    "https://custos/severity",
    "https://custos/rule",
    "https://custos/file",
    "https://custos/line",
    "https://custos/commit_sha",
    "https://custos/override_reason",
  ];

  return important
    .filter((key) => claims[key] !== undefined)
    .map((key) => `  ${key}: ${formatUnknown(claims[key])}`);
}

function shouldPage(lines: string[]): boolean {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return false;
  }

  const rows = process.stdout.rows ?? 24;
  const columns = process.stdout.columns ?? 80;
  return lines.length > Math.max(8, rows - 2) || lines.some((line) => visibleLength(line) > columns);
}

async function pageLines(lines: string[]): Promise<void> {
  const input = process.stdin;
  const output = process.stdout;
  const rows = Math.max(8, (output.rows ?? 24) - 1);
  const columns = Math.max(20, output.columns ?? 80);
  let verticalOffset = 0;
  let horizontalOffset = 0;

  readline.emitKeypressEvents(input);
  if (input.isTTY) {
    input.setRawMode(true);
  }

  const render = (): void => {
    const maxHorizontalOffset = maxLineWidth(lines) > columns ? maxLineWidth(lines) - columns : 0;
    horizontalOffset = Math.min(horizontalOffset, maxHorizontalOffset);

    output.write("\x1b[2J\x1b[H");
    output.write(
      lines
        .slice(verticalOffset, verticalOffset + rows - 1)
        .map((line) => sliceVisible(line, horizontalOffset, columns))
        .join("\n"),
    );
    output.write("\n");
    output.write(
      chalk.inverse(
        ` q quit  ↑/k up  ↓/j down  ←/h left  →/l right  rows ${verticalOffset + 1}-${Math.min(verticalOffset + rows - 1, lines.length)} of ${lines.length}  cols ${horizontalOffset + 1}-${Math.min(horizontalOffset + columns, maxLineWidth(lines))} `,
      ),
    );
  };

  return new Promise((resolve) => {
    const cleanup = (): void => {
      input.off("keypress", onKeypress);
      if (input.isTTY) {
        input.setRawMode(false);
      }
      output.write("\n");
      resolve();
    };

    const onKeypress = (_char: string, key: readline.Key): void => {
      if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        return;
      }

      if (key.name === "down" || key.name === "j") {
        verticalOffset = Math.min(Math.max(0, lines.length - rows + 1), verticalOffset + 1);
        render();
        return;
      }

      if (key.name === "up" || key.name === "k") {
        verticalOffset = Math.max(0, verticalOffset - 1);
        render();
        return;
      }

      if (key.name === "right" || key.name === "l") {
        horizontalOffset += 4;
        render();
        return;
      }

      if (key.name === "left" || key.name === "h") {
        horizontalOffset = Math.max(0, horizontalOffset - 4);
        render();
        return;
      }

      if (key.name === "pagedown" || key.name === "space") {
        verticalOffset = Math.min(Math.max(0, lines.length - rows + 1), verticalOffset + rows - 2);
        render();
        return;
      }

      if (key.name === "pageup") {
        verticalOffset = Math.max(0, verticalOffset - rows + 2);
        render();
      }
    };

    input.on("keypress", onKeypress);
    render();
  });
}

function printLines(lines: string[], options: { preserveWideLines?: boolean } = {}): void {
  if (!options.preserveWideLines || !process.stdout.isTTY) {
    console.log(lines.join("\n"));
    return;
  }

  process.stdout.write("\x1b[?7l");
  console.log(lines.join("\n"));
  process.stdout.write("\x1b[?7h");
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(200, Math.floor(limit)));
}

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}...` : hash;
}

function formatDate(value: Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toISOString();
}

function formatDateShort(value: Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function pad(value: string, width: number): string {
  const truncated = value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;
  return truncated.padEnd(width, " ");
}

function blockLines(lines: string[]): string[] {
  const width = Math.max(...lines.map((line) => visibleLength(line)));
  const top = accent(`╭${"─".repeat(width + 2)}╮`);
  const bottom = accent(`╰${"─".repeat(width + 2)}╯`);
  const body = lines.map((line) => `${accent("│")} ${line}${" ".repeat(width - visibleLength(line))} ${accent("│")}`);
  return [top, ...body, bottom];
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function maxLineWidth(lines: string[]): number {
  return Math.max(0, ...lines.map((line) => visibleLength(line)));
}

function sliceVisible(value: string, start: number, width: number): string {
  if (start === 0 && visibleLength(value) <= width) {
    return value;
  }

  // Horizontal scrolling strips color codes to keep slicing predictable and
  // prevent broken ANSI sequences. The full-color table remains at column 1.
  return stripAnsi(value).slice(start, start + width).padEnd(Math.min(width, visibleLength(value)), " ");
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\]8;;.*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;]*m/g, "");
}

function formatUnknown(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
