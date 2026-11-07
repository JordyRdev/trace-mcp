import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { openDb } from "../src/db.js";
import { get, remember } from "../src/memory/store.js";
import { startInspector } from "../src/web/server.js";

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(port: number, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<Res>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: opts.headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function setup() {
  const db = openDb(":memory:");
  const m = remember(db, { text: "I like <b>tea</b>.", evidence: "tea please" });
  const inspector = await startInspector(db, 0);
  const host = `127.0.0.1:${inspector.port}`;
  const post = (headers: Record<string, string>) =>
    send(inspector.port, "/action", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Host: host, ...headers },
      body: `id=${m.id}&action=approve&back=/`,
    });
  return { db, m, inspector, host, post };
}

test("serves the page with security headers and escaped content", async () => {
  const { inspector, host } = await setup();
  try {
    const res = await send(inspector.port, "/?status=pending", { headers: { Host: host } });
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-security-policy"]), /frame-ancestors 'none'/);
    assert.equal(res.headers["referrer-policy"], "same-origin");
    assert.ok(res.body.includes("&lt;b&gt;tea&lt;/b&gt;"));
    assert.ok(!res.body.includes("<b>tea</b>"));
  } finally {
    await inspector.close();
  }
});

test("rejects a foreign Host header (DNS rebinding)", async () => {
  const { inspector } = await setup();
  try {
    const res = await send(inspector.port, "/export.jsonl", { headers: { Host: `evil.example:${inspector.port}` } });
    assert.equal(res.status, 403);
    assert.ok(!res.body.includes("tea"));
  } finally {
    await inspector.close();
  }
});

test("rejects a cross-site form post", async () => {
  const { db, m, inspector, post } = await setup();
  try {
    const res = await post({ Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
    assert.equal(res.status, 403);
    assert.equal(get(db, m.id)?.status, "pending");
  } finally {
    await inspector.close();
  }
});

test("accepts its own form post, including a null Origin marked same-origin", async () => {
  const { db, m, inspector, host, post } = await setup();
  try {
    const res = await post({ Origin: "null", "Sec-Fetch-Site": "same-origin" });
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, "/");
    assert.equal(get(db, m.id)?.status, "active");
    const again = await post({ Origin: `http://${host}` });
    assert.equal(again.status, 303);
  } finally {
    await inspector.close();
  }
});

test("redirects only to local paths after an action", async () => {
  const { inspector, host, m } = await setup();
  try {
    const res = await send(inspector.port, "/action", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Host: host, Origin: `http://${host}` },
      body: `id=${m.id}&action=approve&back=//evil.example/`,
    });
    assert.equal(res.headers.location, "/");
  } finally {
    await inspector.close();
  }
});

test("a busy port gives a helpful error", async () => {
  const { inspector } = await setup();
  try {
    await assert.rejects(startInspector(openDb(":memory:"), inspector.port), /in use/);
  } finally {
    await inspector.close();
  }
});
