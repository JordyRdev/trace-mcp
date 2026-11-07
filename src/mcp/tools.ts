import type { Db } from "../db.js";
import {
  all,
  approve,
  forget,
  list,
  pin,
  reject,
  remember,
  replace,
  stats,
  parseKind,
  KINDS,
} from "../memory/store.js";
import { exportJsonl, exportMarkdown } from "../memory/export.js";
import { recall } from "../memory/search.js";
import { formatHit, formatMemory } from "../memory/format.js";

export interface ToolOptions {
  /**
   * Expose review tools (approve, reject, forget, pin, export) over MCP.
   * Off by default: the model proposes, the person approves. Turn it on only
   * if you trust every client and every piece of text that reaches the model.
   */
  allowReview?: boolean;
}

const idOnly = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
};

const PROPOSE_TOOLS = [
  {
    name: "remember",
    description:
      "Propose a memory. It lands in the review queue as pending until the person approves it outside the model (CLI or inspector).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The memory as a standalone sentence." },
        kind: { type: "string", enum: [...KINDS] },
        tags: { type: "array", items: { type: "string" } },
        source: { type: "string" },
        evidence: { type: "string", description: "Short quote that supports this memory." },
        evidence_date: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "recall",
    description: "Search active memories. Returns matching memories with dates and receipts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "pending",
    description: "List memories waiting for review.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "replace",
    description:
      "Propose a replacement for an existing memory. It is queued as pending; the old one is retired when the person approves it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        evidence: { type: "string" },
        evidence_date: { type: "string" },
      },
      required: ["id", "text"],
    },
  },
  {
    name: "stats",
    description: "Counts by status.",
    inputSchema: { type: "object", properties: {} },
  },
];

const REVIEW_TOOLS = [
  {
    name: "approve",
    description: "Approve a pending memory. If it replaces an older one, the older one is retired.",
    inputSchema: idOnly,
  },
  {
    name: "reject",
    description: "Reject a pending memory.",
    inputSchema: idOnly,
  },
  {
    name: "forget",
    description: "Retire an active memory without deleting its history.",
    inputSchema: idOnly,
  },
  {
    name: "pin",
    description: "Pin or unpin a memory so recall always includes it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, pinned: { type: "boolean" } },
      required: ["id"],
    },
  },
  {
    name: "export",
    description: "Export all memories as markdown or jsonl.",
    inputSchema: {
      type: "object",
      properties: { format: { type: "string", enum: ["md", "jsonl"] } },
    },
  },
];

const REVIEW_NAMES = new Set(REVIEW_TOOLS.map((t) => t.name));

export function listTools(opts: ToolOptions = {}) {
  return opts.allowReview ? [...PROPOSE_TOOLS, ...REVIEW_TOOLS] : PROPOSE_TOOLS;
}

const opt = (v: unknown): string | undefined =>
  v === undefined || v === null || v === "" ? undefined : String(v);

export function callTool(
  db: Db,
  name: string,
  args: Record<string, unknown>,
  opts: ToolOptions = {}
): string {
  if (REVIEW_NAMES.has(name) && !opts.allowReview) {
    throw new Error(
      `${name} is not available to the model. Review happens with the trace CLI or inspector.`
    );
  }
  switch (name) {
    case "remember": {
      const m = remember(db, {
        text: String(args.text ?? ""),
        kind: parseKind(args.kind),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        source: opt(args.source) ?? "mcp",
        evidence: opt(args.evidence) ?? "",
        evidenceDate: opt(args.evidence_date),
      });
      return `Queued ${m.id}. Status: pending. The person can approve it with \`trace approve ${m.id}\` or in the inspector.`;
    }
    case "recall": {
      const hits = recall(db, String(args.query ?? ""), Number(args.limit) || 8);
      if (!hits.length) return "No active memories match that.";
      return hits.map(formatHit).join("\n");
    }
    case "pending": {
      const items = list(db, { status: "pending", limit: 200 });
      if (!items.length) return "The queue is empty.";
      return items.map(formatMemory).join("\n");
    }
    case "replace": {
      const m = replace(db, String(args.id ?? ""), {
        text: String(args.text ?? ""),
        source: "mcp",
        evidence: opt(args.evidence) ?? "",
        evidenceDate: opt(args.evidence_date),
      });
      return `Queued replacement ${m.id}. The old memory is retired once the person approves it.`;
    }
    case "stats":
      return JSON.stringify(stats(db), null, 2);
    case "approve": {
      const m = approve(db, String(args.id ?? ""));
      return `${m.id} is now ${m.status}.`;
    }
    case "reject": {
      const m = reject(db, String(args.id ?? ""));
      return `${m.id} is now ${m.status}.`;
    }
    case "forget": {
      const m = forget(db, String(args.id ?? ""));
      return `${m.id} is now ${m.status}.`;
    }
    case "pin": {
      const m = pin(db, String(args.id ?? ""), args.pinned !== false);
      return `${m.id} pinned: ${m.pinned}.`;
    }
    case "export": {
      const items = all(db);
      return args.format === "jsonl" ? exportJsonl(items) : exportMarkdown(items);
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
