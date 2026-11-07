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
  type MemoryKind,
} from "../memory/store.js";
import { exportJsonl, exportMarkdown } from "../memory/export.js";
import { recall } from "../memory/search.js";
import { formatHit, formatMemory } from "../memory/format.js";

export const TOOLS = [
  {
    name: "remember",
    description:
      "Propose a memory. It lands in the review queue as pending until a person approves it.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The memory as a standalone sentence." },
        kind: { type: "string", enum: ["identity", "fact", "preference", "event"] },
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
    name: "approve",
    description: "Approve a pending memory. If it replaces an older one, the older one is retired.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "reject",
    description: "Reject a pending memory.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "forget",
    description: "Retire an active memory without deleting its history.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
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
    name: "replace",
    description: "Propose a replacement for an existing memory. The old one is retired on approval.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        evidence: { type: "string" },
      },
      required: ["id", "text"],
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
  {
    name: "stats",
    description: "Counts by status.",
    inputSchema: { type: "object", properties: {} },
  },
];

export function callTool(db: Db, name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "remember": {
      const m = remember(db, {
        text: String(args.text ?? ""),
        kind: args.kind as MemoryKind | undefined,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        source: args.source ? String(args.source) : "mcp",
        evidence: args.evidence ? String(args.evidence) : "",
        evidenceDate: args.evidence_date ? String(args.evidence_date) : undefined,
      });
      return `Queued ${m.id}. Status: pending. Approve it with approve { id: "${m.id}" } or in the inspector.`;
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
    case "replace": {
      const m = replace(db, String(args.id ?? ""), {
        text: String(args.text ?? ""),
        source: "mcp",
        evidence: args.evidence ? String(args.evidence) : "",
      });
      return `Queued replacement ${m.id}. Approve it to retire the old memory.`;
    }
    case "export": {
      const items = all(db);
      return args.format === "jsonl" ? exportJsonl(items) : exportMarkdown(items);
    }
    case "stats":
      return JSON.stringify(stats(db), null, 2);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
