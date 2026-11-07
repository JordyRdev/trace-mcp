import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { approve, forget, get, list, pin, remember, replace } from "../src/memory/store.js";

test("new memories wait for review", () => {
  const db = openDb(":memory:");
  const m = remember(db, { text: "I live in Las Vegas." });
  assert.equal(m.status, "pending");
  assert.equal(list(db, { status: "active" }).length, 0);
  approve(db, m.id);
  assert.equal(get(db, m.id)?.status, "active");
});

test("replacement retires the old memory and keeps history", () => {
  const db = openDb(":memory:");
  const old = remember(db, { text: "I make $55,000 a year.", status: "active" });
  const next = replace(db, old.id, { text: "I make $165,000 a year." });
  assert.equal(next.status, "pending");
  approve(db, next.id);
  const after = get(db, old.id);
  assert.equal(after?.status, "superseded");
  assert.equal(after?.supersededBy, next.id);
  assert.ok(after?.validTo);
});

test("forget keeps the row", () => {
  const db = openDb(":memory:");
  const m = remember(db, { text: "I drive a truck.", status: "active" });
  forget(db, m.id);
  assert.equal(get(db, m.id)?.status, "forgotten");
});

test("pin survives a status check", () => {
  const db = openDb(":memory:");
  const m = remember(db, { text: "My name is Sam.", status: "active" });
  pin(db, m.id, true);
  assert.equal(get(db, m.id)?.pinned, true);
});
