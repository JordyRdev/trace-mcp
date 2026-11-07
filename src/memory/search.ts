import type { Db } from "../db.js";
import { type Memory, type Row, toMemory } from "./store.js";

export interface Hit {
  memory: Memory;
  score: number;
  why: string;
}

/**
 * Recall active memories for a query.
 *
 * Order of priority:
 *   1. pinned memories, capped at half the limit so they can't crowd out matches
 *   2. full-text matches, best first
 *   3. remaining pinned memories
 *   4. the most recent memories, only to fill slots that are still empty
 */
export function recall(db: Db, query: string, limit = 8): Hit[] {
  limit = Math.max(1, Math.floor(limit));
  const out: Hit[] = [];
  const seen = new Set<string>();

  const take = (rows: Row[], why: string, max: number, base: number) => {
    let n = 0;
    for (const row of rows) {
      if (out.length >= limit || n >= max) break;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ memory: toMemory(row), score: base - n, why });
      n += 1;
    }
  };

  const pinned = db
    .prepare(
      "SELECT * FROM memories WHERE status = 'active' AND pinned = 1 ORDER BY created_at DESC LIMIT ?"
    )
    .all(limit) as Row[];

  let matches: Row[] = [];
  const terms = tokenize(query);
  if (terms.length) {
    const match = terms.map((t) => `"${t}"`).join(" OR ");
    try {
      matches = db
        .prepare(
          `SELECT m.*
             FROM memories_fts
             JOIN memories m ON m.seq = memories_fts.rowid
            WHERE memories_fts MATCH ? AND m.status = 'active'
            ORDER BY bm25(memories_fts)
            LIMIT ?`
        )
        .all(match, limit) as Row[];
    } catch {
      // a bad query should not break recall
    }
  }

  const pinnedShare = matches.length ? Math.ceil(limit / 2) : limit;
  take(pinned, "pinned", pinnedShare, 100);
  take(matches, "match", limit, 50);
  take(pinned, "pinned", limit, 90);

  if (out.length < limit) {
    const recent = db
      .prepare("SELECT * FROM memories WHERE status = 'active' ORDER BY created_at DESC LIMIT 3")
      .all() as Row[];
    take(recent, "recent", 3, 20);
  }

  return out;
}

/** Split a query into search terms. Unicode-aware, so "Zürich" and "café" stay whole. */
export function tokenize(query: string): string[] {
  const words = query.toLowerCase().normalize("NFC").match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return [...new Set(words.map((w) => w.replace(/"/g, "")))]
    .filter((w) => w.length > 1)
    .slice(0, 12);
}
