import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const VERSION = "0.1.0";

export function resolveDbPath(flag?: string): string {
  const p = flag || process.env.TRACE_DB || join(homedir(), ".trace", "trace.db");
  return p === ":memory:" ? p : resolve(p);
}
