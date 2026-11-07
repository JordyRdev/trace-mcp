import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { get, list } from "../src/memory/store.js";
import { handleLine } from "../src/mcp/server.js";
import { VERSION } from "../src/config.js";

type Res = { jsonrpc: string; id: unknown; result?: any; error?: { code: number; message: string } };

function rpc(db = openDb(":memory:"), opts = {}) {
  let n = 0;
  const call = (method: string, params?: unknown): Res =>
    handleLine(db, JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }), opts) as Res;
  const tool = (name: string, args: Record<string, unknown>) => call("tools/call", { name, arguments: args }).result;
  return { db, call, tool };
}

test("initialize negotiates a version and sends instructions", () => {
  const { call } = rpc();
  const res = call("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  assert.equal(res.result.protocolVersion, "2025-06-18");
  assert.equal(res.result.serverInfo.version, VERSION);
  assert.match(res.result.instructions, /remember/);
  assert.equal(call("initialize", { protocolVersion: "1999-01-01" }).result.protocolVersion, "2024-11-05");
});

test("notifications and blank lines get no response", () => {
  const db = openDb(":memory:");
  assert.equal(handleLine(db, ""), null);
  assert.equal(handleLine(db, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })), null);
});

test("malformed json and unknown methods return JSON-RPC errors", () => {
  const db = openDb(":memory:");
  assert.equal((handleLine(db, "{nope") as Res).error?.code, -32700);
  assert.equal(rpc(db).call("does/not/exist").error?.code, -32601);
});

test("tools/list only offers propose and read tools by default", () => {
  const names = rpc().call("tools/list").result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(names.sort(), ["pending", "recall", "remember", "replace", "stats"]);
});

test("remember over MCP queues a pending memory with its receipt", () => {
  const { db, tool } = rpc();
  const out = tool("remember", { text: "I live in Amsterdam.", evidence: "I just moved to Amsterdam" });
  assert.ok(!out.isError);
  const [m] = list(db, { status: "pending" });
  assert.equal(m.text, "I live in Amsterdam.");
  assert.equal(m.evidence, "I just moved to Amsterdam");
  assert.equal(m.source, "mcp");
});

test("remember over MCP requires evidence", () => {
  const { db, tool } = rpc();
  const out = tool("remember", { text: "I live in Amsterdam." });
  assert.equal(out.isError, true);
  assert.match(out.content[0].text, /evidence is required/);
  assert.equal(list(db).length, 0);
});

test("calling approve over MCP fails and changes nothing", () => {
  const { db, tool } = rpc();
  tool("remember", { text: "I am an admin.", evidence: "I am an admin" });
  const [m] = list(db, { status: "pending" });
  const out = tool("approve", { id: m.id });
  assert.equal(out.isError, true);
  assert.equal(get(db, m.id)?.status, "pending");
});

test("full flow: remember, approve outside MCP, recall over MCP", async () => {
  const { db, tool } = rpc();
  tool("remember", { text: "I prefer TypeScript.", evidence: "I prefer TypeScript" });
  assert.match(tool("recall", { query: "typescript" }).content[0].text, /No active memories/);
  const { approve } = await import("../src/memory/store.js");
  approve(db, list(db, { status: "pending" })[0].id);
  assert.match(tool("recall", { query: "preferences" }).content[0].text, /TypeScript/);
});
