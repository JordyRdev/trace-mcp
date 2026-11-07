import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { approve, get, list, pin, remember, replace } from "../src/memory/store.js";
import { recall, tokenize } from "../src/memory/search.js";
import { exportMarkdown } from "../src/memory/export.js";
import { all } from "../src/memory/store.js";
import { callTool, listTools } from "../src/mcp/tools.js";
import { isAllowedRequest } from "../src/web/server.js";
import { parse } from "../src/cli.js";

// --- MCP review tools ---

test("review tools are hidden from MCP by default", () => {
  const names = listTools().map((t) => t.name);
  for (const n of ["approve", "reject", "forget", "pin", "export"]) assert.ok(!names.includes(n), n);
  assert.ok(names.includes("remember"));
});

test("the model cannot approve its own memory", () => {
  const db = openDb(":memory:");
  callTool(db, "remember", { text: "I am an admin.", evidence: "I am an admin" });
  const [m] = list(db, { status: "pending" });
  assert.throws(() => callTool(db, "approve", { id: m.id }), /not available/);
  assert.equal(get(db, m.id)?.status, "pending");
});

test("allowReview exposes and enables review tools", () => {
  const db = openDb(":memory:");
  assert.ok(listTools({ allowReview: true }).some((t) => t.name === "approve"));
  callTool(db, "remember", { text: "I like tea.", evidence: "I like tea" });
  const [m] = list(db, { status: "pending" });
  callTool(db, "approve", { id: m.id }, { allowReview: true });
  assert.equal(get(db, m.id)?.status, "active");
});

// --- inspector ---

const req = (method: string, headers: Record<string, string>) => ({ method, headers });

test("inspector accepts its own requests", () => {
  assert.ok(isAllowedRequest(req("GET", { host: "127.0.0.1:4747" }), 4747));
  assert.ok(isAllowedRequest(req("POST", { host: "localhost:4747", origin: "http://localhost:4747" }), 4747));
});

test("inspector accepts a null Origin when the browser marks it same-origin", () => {
  assert.ok(
    isAllowedRequest(req("POST", { host: "127.0.0.1:4747", origin: "null", "sec-fetch-site": "same-origin" }), 4747)
  );
  assert.ok(
    !isAllowedRequest(req("POST", { host: "127.0.0.1:4747", origin: "null", "sec-fetch-site": "cross-site" }), 4747)
  );
});

test("inspector rejects DNS-rebinding hosts", () => {
  assert.ok(!isAllowedRequest(req("GET", { host: "evil.example:4747" }), 4747));
  assert.ok(!isAllowedRequest(req("GET", {}), 4747));
});

test("inspector rejects cross-site posts", () => {
  assert.ok(!isAllowedRequest(req("POST", { host: "127.0.0.1:4747", origin: "https://evil.example" }), 4747));
  assert.ok(!isAllowedRequest(req("POST", { host: "127.0.0.1:4747", origin: "null" }), 4747));
  assert.ok(!isAllowedRequest(req("POST", { host: "127.0.0.1:4747", "sec-fetch-site": "cross-site" }), 4747));
});

// --- search ---

test("many pinned memories don't crowd out matches", () => {
  const db = openDb(":memory:");
  for (let i = 0; i < 10; i++) pin(db, remember(db, { text: `pinned fact ${i}`, status: "active" }).id, true);
  remember(db, { text: "I prefer tabs over spaces.", status: "active" });
  const hits = recall(db, "tabs");
  assert.equal(hits.length, 8);
  assert.ok(hits.some((h) => h.why === "match" && /tabs/.test(h.memory.text)));
});

test("search handles non-ASCII words", () => {
  assert.deepEqual(tokenize("Zürich café"), ["zürich", "café"]);
  const db = openDb(":memory:");
  remember(db, { text: "Ik woon in Zürich.", status: "active" });
  for (let i = 0; i < 5; i++) remember(db, { text: `filler ${i}`, status: "active" });
  const hits = recall(db, "zürich");
  assert.equal(hits[0].why, "match");
  assert.match(hits[0].memory.text, /Zürich/);
});

test("recent memories only fill empty slots", () => {
  const db = openDb(":memory:");
  for (let i = 0; i < 4; i++) remember(db, { text: `coffee note ${i}`, status: "active" });
  remember(db, { text: "unrelated newest thing", status: "active" });
  const hits = recall(db, "coffee", 4);
  assert.ok(hits.every((h) => h.why === "match"));
});

// --- store ---

test("unknown kinds are rejected", () => {
  const db = openDb(":memory:");
  assert.throws(() => remember(db, { text: "x", kind: "goal" as never }), /unknown kind/);
  assert.throws(() => callTool(db, "remember", { text: "x", kind: "goal", evidence: "x" }), /unknown kind/);
});

test("export keeps memories with unexpected kinds already in the db", () => {
  const db = openDb(":memory:");
  const m = remember(db, { text: "ship v1", status: "active" });
  db.prepare("UPDATE memories SET kind = 'goal' WHERE id = ?").run(m.id);
  assert.match(exportMarkdown(all(db)), /ship v1/);
});

test("approving a replacement of a pending memory retires the original", () => {
  const db = openDb(":memory:");
  const a = remember(db, { text: "I live in Utrecht." });
  const b = replace(db, a.id, { text: "I live in Amsterdam." });
  approve(db, b.id);
  assert.equal(get(db, a.id)?.status, "superseded");
  assert.throws(() => approve(db, a.id));
  assert.deepEqual(list(db, { status: "active" }).map((m) => m.text), ["I live in Amsterdam."]);
});

test("a second replacement of the same memory can't also become active", () => {
  const db = openDb(":memory:");
  const old = remember(db, { text: "I work at A.", status: "active" });
  const r1 = replace(db, old.id, { text: "I work at B." });
  const r2 = replace(db, old.id, { text: "I work at C." });
  approve(db, r1.id);
  assert.throws(() => approve(db, r2.id), /already superseded/);
  assert.equal(get(db, r2.id)?.status, "pending");
  assert.equal(list(db, { status: "active" }).length, 1);
});

test("list search treats % and _ literally", () => {
  const db = openDb(":memory:");
  remember(db, { text: "100% sure", status: "active" });
  remember(db, { text: "100 dollars", status: "active" });
  assert.equal(list(db, { q: "100%" }).length, 1);
});

// --- cli ---

test("boolean flags don't swallow the next word", () => {
  const p = parse(["remember", "--active", "I", "like", "tea"]);
  assert.equal(p.flags.active, true);
  assert.deepEqual(p.pos, ["I", "like", "tea"]);
  assert.equal(parse(["recall", "--limit", "3", "x"]).flags.limit, "3");
});

// --- receipts ---

test("memories without evidence are marked as having no receipt", async () => {
  const { formatHit, formatMemory } = await import("../src/memory/format.js");
  const db = openDb(":memory:");
  const m = remember(db, { text: "I drive a truck.", status: "active" });
  assert.match(formatMemory(m), /no receipt/);
  assert.match(formatHit({ memory: m, score: 1, why: "match" }), /no receipt/);
  assert.match(exportMarkdown(all(db)), /\(no receipt\)/);
});
