import { createServer, type IncomingMessage } from "node:http";
import type { Db } from "../db.js";
import {
  approve,
  forget,
  list,
  pin,
  reject,
  stats,
  type Memory,
  type MemoryStatus,
} from "../memory/store.js";
import { exportJsonl, exportMarkdown } from "../memory/export.js";
import { all } from "../memory/store.js";
import { shortDate } from "../util/time.js";

const TABS: (MemoryStatus | "all")[] = ["active", "pending", "superseded", "forgotten", "all"];

/**
 * The inspector binds to 127.0.0.1, but that alone does not stop a web page in
 * your browser from talking to it. Two checks close that gap:
 *  - Host must be our own loopback address, which defeats DNS rebinding
 *    (a hostile domain re-pointed at 127.0.0.1 still sends its own Host).
 *  - Requests that change state must come from our own Origin, which defeats
 *    cross-site form posts (CSRF).
 */
export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

export function isAllowedRequest(
  req: Pick<IncomingMessage, "method" | "headers">,
  port: number
): boolean {
  const hosts = allowedHosts(port);
  const host = (req.headers.host ?? "").toLowerCase();
  if (!hosts.has(host)) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (origin === "null") {
      // Some browsers send a null Origin for same-origin posts (privacy settings,
      // referrer policies). Sec-Fetch-Site can't be forged by a web page, so trust it.
      if (site !== "same-origin") return false;
    } else if (origin !== undefined) {
      let originHost = "";
      try {
        originHost = new URL(String(origin)).host.toLowerCase();
      } catch {
        return false;
      }
      if (!hosts.has(originHost)) return false;
    } else if (site !== undefined && site !== "same-origin" && site !== "none") {
      return false;
    }
  }
  return true;
}

export function startInspector(db: Db, port = 4747): Promise<string> {
  return new Promise((resolve, rejectPromise) => {
    const server = createServer(async (req, res) => {
      if (!isAllowedRequest(req, port)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("forbidden");
        return;
      }
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
      // not "no-referrer": that makes browsers send `Origin: null` on our own form posts
      res.setHeader("Referrer-Policy", "same-origin");
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "POST" && url.pathname === "/action") {
        const form = new URLSearchParams(await readBody(req));
        const id = form.get("id") ?? "";
        const action = form.get("action");
        try {
          if (action === "approve") approve(db, id);
          if (action === "reject") reject(db, id);
          if (action === "forget") forget(db, id);
          if (action === "pin") pin(db, id, true);
          if (action === "unpin") pin(db, id, false);
        } catch {
          // keep the page usable
        }
        const back = form.get("back") ?? "/";
        res.writeHead(303, { Location: back.startsWith("/") && !back.startsWith("//") ? back : "/" });
        res.end();
        return;
      }

      if (url.pathname === "/export.md") {
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        res.end(exportMarkdown(all(db)));
        return;
      }

      if (url.pathname === "/export.jsonl") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
        res.end(exportJsonl(all(db)));
        return;
      }

      const status = (url.searchParams.get("status") ?? "active") as MemoryStatus | "all";
      const q = url.searchParams.get("q") ?? "";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page(db, status, q));
    });

    server.on("error", rejectPromise);
    server.listen(port, "127.0.0.1", () => resolve(`http://127.0.0.1:${port}`));
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}

function actions(m: Memory, back: string): string {
  const hidden = `<input type="hidden" name="id" value="${esc(m.id)}"><input type="hidden" name="back" value="${esc(back)}">`;
  const buttons: string[] = [];
  if (m.status === "pending") {
    buttons.push(`<form method="post" action="/action">${hidden}<button name="action" value="approve">approve</button></form>`);
    buttons.push(`<form method="post" action="/action">${hidden}<button name="action" value="reject">reject</button></form>`);
  }
  if (m.status === "active") {
    buttons.push(
      `<form method="post" action="/action">${hidden}<button name="action" value="${m.pinned ? "unpin" : "pin"}">${m.pinned ? "unpin" : "pin"}</button></form>`
    );
    buttons.push(`<form method="post" action="/action">${hidden}<button name="action" value="forget">forget</button></form>`);
  }
  return `<div class="actions">${buttons.join("")}</div>`;
}

function page(db: Db, status: MemoryStatus | "all", q: string): string {
  const counts = stats(db);
  const items = list(db, { status, q: q || undefined, limit: 500 });
  const back = `/?status=${encodeURIComponent(status)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const rows = items
    .map((m) => {
      const date = shortDate(m.validFrom ?? m.createdAt);
      const quote = m.evidence ? `<div class="quote">${esc(m.evidence)}</div>` : "";
      return `<li class="row">
        <div class="text">${esc(m.text)}</div>
        <div class="meta"><code>${esc(m.id)}</code> · ${esc(m.kind)} · ${esc(m.status)} · ${date} · ${esc(m.source)}</div>
        ${quote}
        ${actions(m, back)}
      </li>`;
    })
    .join("\n");

  const tabs = TABS.map((t) => {
    const n = t === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[t] ?? 0;
    const cls = t === status ? "tab on" : "tab";
    return `<a class="${cls}" href="/?status=${t}">${t} <span>${n}</span></a>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>trace</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.55 system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
  header p { margin: 0; opacity: 0.6; font-size: 13px; }
  nav { display: flex; flex-wrap: wrap; gap: 6px; margin: 24px 0 12px; }
  .tab { text-decoration: none; color: inherit; padding: 4px 10px; border-radius: 999px; font-size: 13px; opacity: 0.7; }
  .tab.on { background: rgba(127,127,127,0.18); opacity: 1; }
  .tab span { opacity: 0.5; margin-left: 4px; }
  form.search { display: flex; gap: 8px; margin-bottom: 20px; }
  form.search input { flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(127,127,127,0.35); background: transparent; color: inherit; }
  button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(127,127,127,0.35); background: transparent; color: inherit; cursor: pointer; }
  ul { list-style: none; padding: 0; margin: 0; }
  .row { padding: 14px 0; border-top: 1px solid rgba(127,127,127,0.18); }
  .text { font-size: 15px; }
  .meta { font-size: 12px; opacity: 0.55; margin-top: 4px; }
  .quote { font-size: 13px; opacity: 0.75; border-left: 2px solid rgba(127,127,127,0.35); padding-left: 10px; margin-top: 8px; }
  .actions { display: flex; gap: 6px; margin-top: 10px; }
  .actions form { margin: 0; }
  footer { margin-top: 40px; font-size: 12px; opacity: 0.5; }
</style>
</head>
<body>
<header>
  <h1>trace</h1>
  <p>local memory · one sqlite file</p>
</header>
<nav>${tabs}</nav>
<form class="search" method="get">
  <input type="hidden" name="status" value="${esc(status)}">
  <input name="q" value="${esc(q)}" placeholder="search text, tags, evidence">
  <button type="submit">search</button>
</form>
<ul>${rows || "<li class='row'><div class='text'>nothing here</div></li>"}</ul>
<footer>
  <a href="/export.md">export markdown</a> · <a href="/export.jsonl">export jsonl</a>
</footer>
</body>
</html>`;
}
