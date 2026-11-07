import type { Db } from "../db.js";
import { type Memory, type Row, toMemory } from "./store.js";

export interface Hit {
  memory: Memory;
  score: number;
  why: string;
}

export function recall(db: Db, query: string, limit = 8): Hit[] {
  const hits = new Map<string, Hit>();

  const add = (m: Memory, score: number, why: string) => {
    const prev = hits.get(m.id);
    if (!prev || score > prev.score) hits.set(m.id, { memory: m, score, why });
  };

  const pinned = db
    .prepare("SELECT * FROM memories WHERE status = 'active' AND pinned = 1 ORDER BY created_at DESC LIMIT 20")
    .all() as Row[];
  for (const row of pinned) add(toMemory(row), 100, "pinned");

  const terms = tokenize(query);
  if (terms.length) {
    const match = terms.map((t) => `"${t}"`).join(" OR ");
    try {
      const rows = db
        .prepare(
          `SELECT m.*, bm25(memories_fts) AS rank
             FROM memories_fts
             JOIN memories m ON m.seq = memories_fts.rowid
            WHERE memories_fts MATCH ? AND m.status = 'active'
            ORDER BY rank
            LIMIT ?`
        )
        .all(match, limit * 3) as (Row & { rank: number })[];
      rows.forEach((row, i) => add(toMemory(row), 50 - i, "match"));
    } catch {
      // a bad query should not break recall
    }
  }

  const recent = db
    .prepare("SELECT * FROM memories WHERE status = 'active' ORDER BY created_at DESC LIMIT 3")
    .all() as Row[];
  recent.forEach((row, i) => add(toMemory(row), 20 - i, "recent"));

  return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function tokenize(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
  return [...new Set(words)].filter((w) => w.length > 1).slice(0, 12);
}
