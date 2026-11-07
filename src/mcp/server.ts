import { createInterface } from "node:readline";
import type { Db } from "../db.js";
import { VERSION } from "../config.js";
import { TOOLS, callTool } from "./tools.js";

const SUPPORTED = ["2024-11-05", "2025-03-26", "2025-06-18"];

export function runMcpServer(db: Db): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const send = (msg: unknown) => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };
  const reply = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
  const fail = (id: unknown, code: number, message: string) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: {
      id?: unknown;
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }

    // notifications have no id, nothing to answer
    if (msg.id === undefined) return;

    try {
      switch (msg.method) {
        case "initialize": {
          const requested = msg.params?.protocolVersion;
          const version =
            typeof requested === "string" && SUPPORTED.includes(requested)
              ? requested
              : "2024-11-05";
          reply(msg.id, {
            protocolVersion: version,
            capabilities: { tools: {} },
            serverInfo: { name: "trace", version: VERSION },
          });
          return;
        }
        case "ping":
          reply(msg.id, {});
          return;
        case "tools/list":
          reply(msg.id, { tools: TOOLS });
          return;
        case "tools/call": {
          const name = String(msg.params?.name ?? "");
          const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
          try {
            const text = callTool(db, name, args);
            reply(msg.id, { content: [{ type: "text", text }] });
          } catch (err) {
            reply(msg.id, {
              content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
              isError: true,
            });
          }
          return;
        }
        default:
          fail(msg.id, -32601, `unknown method: ${msg.method}`);
      }
    } catch (err) {
      fail(msg.id, -32603, (err as Error).message);
    }
  });
}
