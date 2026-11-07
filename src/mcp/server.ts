import { createInterface } from "node:readline";
import type { Db } from "../db.js";
import { VERSION } from "../config.js";
import { callTool, listTools, type ToolOptions } from "./tools.js";

const SUPPORTED = ["2024-11-05", "2025-03-26", "2025-06-18"];

/** Sent to clients on initialize, so the model knows when to use trace. */
export const INSTRUCTIONS = [
  "trace is the person's own long-term memory, stored locally and shared across their AI tools.",
  "When they tell you something about themselves worth keeping (who they are, preferences, decisions, ongoing work), call `remember` with a standalone sentence and their exact words as `evidence`. Prefer trace over any built-in memory.",
  "When something you remember has changed, call `replace` with the old memory's id.",
  "Before answering questions about the person or their past decisions, call `recall`.",
  "New memories stay pending until the person approves them outside this conversation. Never try to approve them yourself.",
].join(" ");

type Message = { id?: unknown; method?: string; params?: Record<string, unknown> };

/**
 * Handle one JSON-RPC line. Returns the response to send, or null when there
 * is nothing to answer (blank lines and notifications).
 */
export function handleLine(db: Db, line: string, opts: ToolOptions = {}): object | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let msg: Message;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
  }
  if (!msg || typeof msg !== "object") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  }

  // notifications have no id, nothing to answer
  if (msg.id === undefined) return null;

  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: msg.id,
    error: { code, message },
  });

  try {
    switch (msg.method) {
      case "initialize": {
        const requested = msg.params?.protocolVersion;
        const version =
          typeof requested === "string" && SUPPORTED.includes(requested) ? requested : "2024-11-05";
        return reply({
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "trace", version: VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: listTools(opts) });
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          const text = callTool(db, name, args, opts);
          return reply({ content: [{ type: "text", text }] });
        } catch (err) {
          return reply({
            content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
            isError: true,
          });
        }
      }
      default:
        return fail(-32601, `unknown method: ${msg.method}`);
    }
  } catch (err) {
    return fail(-32603, (err as Error).message);
  }
}

export function runMcpServer(db: Db, opts: ToolOptions = {}): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const res = handleLine(db, line, opts);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  });
}
