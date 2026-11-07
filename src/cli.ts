import { resolveDbPath, VERSION } from "./config.js";
import { openDb } from "./db.js";
import {
  approve,
  forget,
  get,
  list,
  pin,
  reject,
  remember,
  replace,
  stats,
  parseKind,
  type MemoryStatus,
} from "./memory/store.js";

/** Flags that never take a value, so `--active I like tea` keeps "I" in the text. */
const BOOLEAN_FLAGS = new Set(["active", "json", "off", "help", "allow-review"]);
const STATUSES: (MemoryStatus | "all")[] = ["pending", "active", "rejected", "superseded", "forgotten", "all"];

const HELP = `trace ${VERSION} - a memory layer for AI tools

Usage:
  trace <command> [options]

Commands:
  init                     Create the database
  remember <text>          Queue a memory for review
  recall <query>           Look up active memories
  pending                  Show the review queue
  list                     List memories (--status, --kind, --q)
  approve <id>             Approve a pending memory
  reject <id>              Reject a pending memory
  forget <id>              Retire an active memory
  pin <id> [--off]         Pin or unpin a memory
  replace <id> <text>      Propose a replacement for a memory
  export                   Export everything (--format md|jsonl)
  serve                    Run the MCP server on stdio (--allow-review)
  inspect                  Start the local inspector
  stats                    Counts by status
  doctor                   Check the database

Options:
  --db <path>              Database file (default ~/.trace/trace.db)
  --json                   Machine readable output
  --evidence <quote>       Supporting quote for a memory
  --evidence-date <date>   When the quote was said or written
  --source <name>          Where the memory came from
  --kind <kind>            identity | fact | preference | event
  --tags <a,b>             Comma separated tags
  --active                 Skip the queue and store as active
  --limit <n>              Max results
  --format <md|jsonl>      Export format
  --port <n>               Inspector port
  --allow-review           Let MCP clients approve, reject, forget, pin and export.
                           Off by default: the model proposes, you approve.

Environment:
  TRACE_DB                 Same as --db
  TRACE_MCP_ALLOW_REVIEW=1 Same as serve --allow-review
`;

export interface Parsed {
  cmd: string;
  pos: string[];
  flags: Record<string, string | boolean>;
}

export function parse(argv: string[]): Parsed {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        i += 1;
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      pos.push(a);
      i += 1;
    }
  }
  return { cmd: pos.shift() ?? "help", pos, flags };
}

function out(s: string): void {
  process.stdout.write(s + "\n");
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function main(argv: string[]): Promise<void> {
  const { cmd, pos, flags } = parse(argv);
  if (cmd === "help" || cmd === "--help" || flags.help) {
    out(HELP);
    return;
  }

  const dbPath = resolveDbPath(str(flags.db));
  const db = openDb(dbPath);

  switch (cmd) {
    case "init": {
      out(`database ready at ${dbPath}`);
      return;
    }

    case "remember": {
      const text = pos.join(" ").trim();
      if (!text) throw new Error("say what you want to remember");
      const m = remember(db, {
        text,
        kind: parseKind(str(flags.kind)),
        tags: str(flags.tags)?.split(",").map((s) => s.trim()).filter(Boolean),
        source: str(flags.source) ?? "cli",
        evidence: str(flags.evidence) ?? "",
        evidenceDate: str(flags["evidence-date"]),
        status: flags.active ? "active" : "pending",
      });
      out(`${m.status === "active" ? "saved" : "queued"} ${m.id}`);
      return;
    }

    case "recall": {
      const query = pos.join(" ").trim();
      if (!query) throw new Error("give me something to search for");
      const { recall } = await import("./memory/search.js");
      const hits = recall(db, query, Number(str(flags.limit)) || 8);
      if (flags.json) {
        out(JSON.stringify(hits.map((h) => ({ ...h.memory, why: h.why })), null, 2));
        return;
      }
      if (!hits.length) {
        out("nothing yet");
        return;
      }
      const { formatHit } = await import("./memory/format.js");
      out(`${hits.length} ${hits.length === 1 ? "memory" : "memories"} for "${query}"`);
      out("");
      for (const h of hits) out(formatHit(h));
      return;
    }

    case "pending": {
      const items = list(db, { status: "pending", limit: 500 });
      if (!items.length) {
        out("queue is empty");
        return;
      }
      const { formatMemory } = await import("./memory/format.js");
      out(`${items.length} pending`);
      out("");
      for (const m of items) out(formatMemory(m));
      return;
    }

    case "list": {
      const status = (str(flags.status) ?? "all") as MemoryStatus | "all";
      if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}". use one of: ${STATUSES.join(", ")}`);
      const items = list(db, {
        status,
        kind: parseKind(str(flags.kind)),
        q: str(flags.q),
        limit: Number(str(flags.limit)) || 200,
      });
      if (flags.json) {
        out(JSON.stringify(items, null, 2));
        return;
      }
      const { formatMemory } = await import("./memory/format.js");
      for (const m of items) out(formatMemory(m));
      if (!items.length) out("nothing here");
      return;
    }

    case "approve":
    case "reject":
    case "forget": {
      const id = pos[0];
      if (!id) throw new Error(`which memory? pass an id`);
      const fn = cmd === "approve" ? approve : cmd === "reject" ? reject : forget;
      const m = fn(db, id);
      out(`${m.id} is now ${m.status}`);
      return;
    }

    case "pin": {
      const id = pos[0];
      if (!id) throw new Error("which memory? pass an id");
      const m = pin(db, id, !flags.off);
      out(`${m.id} pinned: ${m.pinned}`);
      return;
    }

    case "replace": {
      const oldId = pos[0];
      const text = pos.slice(1).join(" ").trim();
      if (!oldId || !text) throw new Error("usage: trace replace <id> <new text>");
      const m = replace(db, oldId, {
        text,
        source: str(flags.source) ?? "cli",
        evidence: str(flags.evidence) ?? "",
        evidenceDate: str(flags["evidence-date"]),
      });
      out(`queued replacement ${m.id} for ${oldId}`);
      return;
    }

    case "export": {
      const { all } = await import("./memory/store.js");
      const { exportJsonl, exportMarkdown } = await import("./memory/export.js");
      const format = str(flags.format) ?? "md";
      const items = all(db);
      out(format === "jsonl" ? exportJsonl(items) : exportMarkdown(items));
      return;
    }

    case "stats": {
      const s = stats(db);
      if (flags.json) {
        out(JSON.stringify(s, null, 2));
        return;
      }
      for (const [k, v] of Object.entries(s)) out(`${k}: ${v}`);
      return;
    }

    case "doctor": {
      out(`database: ${dbPath}`);
      const fts = db.prepare("SELECT name FROM sqlite_master WHERE name = 'memories_fts'").get();
      out(`fts5: ${fts ? "ok" : "missing"}`);
      const s = stats(db);
      out(`memories: ${Object.values(s).reduce((a, b) => a + b, 0)}`);
      out(`pending: ${s.pending}`);
      return;
    }

    case "serve": {
      const { runMcpServer } = await import("./mcp/server.js");
      const allowReview = Boolean(flags["allow-review"]) || process.env.TRACE_MCP_ALLOW_REVIEW === "1";
      if (allowReview) {
        process.stderr.write("trace: review tools are exposed over MCP. the model can approve its own memories.\n");
      }
      runMcpServer(db, { allowReview });
      return;
    }

    case "inspect": {
      const { startInspector } = await import("./web/server.js");
      const url = await startInspector(db, Number(str(flags.port)) || 4747);
      out(`inspector at ${url}`);
      await new Promise(() => {});
      return;
    }

    default:
      throw new Error(`unknown command: ${cmd}. run trace help`);
  }
}
