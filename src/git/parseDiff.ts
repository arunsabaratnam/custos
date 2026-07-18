import path from "path";
import type { DiffHunk } from "../scanner/types.js";

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".env": "dotenv",
  ".sh": "bash",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".sql": "sql",
};

export function parseDiff(rawDiff: string): DiffHunk[] {
  if (!rawDiff.trim()) return [];

  const hunks: DiffHunk[] = [];
  const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const fileMatch = section.match(/^a\/.+ b\/(.+)\n/);
    if (!fileMatch) continue;

    const file = fileMatch[1]!.trim();
    const ext = path.extname(file);
    const language = LANGUAGE_MAP[ext] ?? "unknown";

    const hunkHeaders = [...section.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm)];
    const hunkBodies = section.split(/^@@ [^@]+ @@[^\n]*/m).slice(1);

    hunkBodies.forEach((body, i) => {
      const startLine = hunkHeaders[i] ? parseInt(hunkHeaders[i]![1]!, 10) : 1;
      let lineNum = startLine;
      const addedLines: Array<{ line: number; content: string }> = [];
      const contextLines: string[] = [];

      const normalizedBody = body.startsWith("\n") ? body.slice(1) : body;

      for (const line of normalizedBody.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          addedLines.push({ line: lineNum, content: line.slice(1) });
          lineNum++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          // removed line — don't advance lineNum
        } else if (line !== "\\ No newline at end of file") {
          contextLines.push(line);
          lineNum++;
        }
      }

      if (addedLines.length > 0) {
        hunks.push({
          file,
          language,
          addedLines,
          context: contextLines.slice(0, 10).join("\n"),
        });
      }
    });
  }

  return hunks;
}
