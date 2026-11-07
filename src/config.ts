import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Read from package.json so `trace --help` and the MCP server always match the published version.
export const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

export function resolveDbPath(flag?: string): string {
  const p = flag || process.env.TRACE_DB || join(homedir(), ".trace", "trace.db");
  return p === ":memory:" ? p : resolve(p);
}
