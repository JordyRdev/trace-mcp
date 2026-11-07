import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { pin, remember } from "../src/memory/store.js";
import { recall } from "../src/memory/search.js";

test("recall finds a matching active memory", () => {
  const db = openDb(":memory:");
  remember(db, { text: "I am training for a half marathon in May.", status: "active" });
  remember(db, { text: "My daughter's name is Cristel.", status: "active" });
  const hits = recall(db, "marathon");
  assert.ok(hits.length > 0);
  assert.match(hits[0].memory.text, /marathon/);
});

test("pending memories stay out of recall", () => {
  const db = openDb(":memory:");
  remember(db, { text: "I am learning to sail." });
  const hits = recall(db, "sail");
  assert.equal(hits.length, 0);
});

test("pinned memories come back first", () => {
  const db = openDb(":memory:");
  const pinned = remember(db, { text: "I go by Sam.", status: "active" });
  remember(db, { text: "I like coffee.", status: "active" });
  pin(db, pinned.id, true);
  const hits = recall(db, "coffee");
  assert.equal(hits[0].memory.id, pinned.id);
});
