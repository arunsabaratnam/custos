import fs from "node:fs/promises";

await fs.chmod(new URL("../dist/cli.js", import.meta.url), 0o755);
