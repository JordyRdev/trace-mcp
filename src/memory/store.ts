import type { Db } from "../db.js";
import { newId } from "../util/id.js";
import { nowIso } from "../util/time.js";

export type MemoryKind = "identity" | "fact" | "preference" | "event";
export type MemoryStatus = "pending" | "active" | "rejected" | "superseded" | "forgotten";

export interface Memory {
  seq: number;
  id: string;
  text: string;
  kind: MemoryKind;
  status: MemoryStatus;
  confidence: number;
  tags: string[];
  source: string;
  evidence: string;
  evidenceDate: string | null;
  replaces: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  validFrom: string | null;
  validTo: string | null;
  supersededBy: string | null;
}

export interface Row {
  seq: number;
  id: string;
  text: string;
  kind: string;
  status: string;
  confidence: number;
  tags: string;
  source: string;
  evidence: string;
  evidence_date: string | null;
  replaces: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
  valid_from: string | null;
  valid_to: string | null;
  superseded_by: string | null;
}

export function toMemory(row: Row): Memory {
  return {
    seq: row.seq,
    id: row.id,
    text: row.text,
    kind: row.kind as MemoryKind,
    status: row.status as MemoryStatus,
    confidence: row.confidence,
    tags: row.tags ? row.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    source: row.source,
    evidence: row.evidence,
    evidenceDate: row.evidence_date,
    replaces: row.replaces,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    supersededBy: row.superseded_by,
  };
}

export interface RememberInput {
  text: string;
  kind?: MemoryKind;
  tags?: string[];
  source?: string;
  evidence?: string;
  evidenceDate?: string;
  confidence?: number;
  status?: MemoryStatus;
  replaces?: string;
}

export function remember(db: Db, input: RememberInput): Memory {
  const text = input.text.trim();
  if (!text) throw new Error("memory text is required");
  const now = nowIso();
  const id = newId();
  const status = input.status ?? "pending";
  db.prepare(
    `INSERT INTO memories
      (id, text, kind, status, confidence, tags, source, evidence, evidence_date,
       replaces, pinned, created_at, updated_at, valid_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(
    id,
    text,
    input.kind ?? "fact",
    status,
    input.confidence ?? 0.6,
    (input.tags ?? []).join(","),
    input.source ?? "unknown",
    input.evidence ?? "",
    input.evidenceDate ?? null,
    input.replaces ?? null,
    now,
    now,
    status === "active" ? now : null
  );
  return get(db, id)!;
}

export function get(db: Db, id: string): Memory | null {
  const row = db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as Row | undefined;
  return row ? toMemory(row) : null;
}

export function approve(db: Db, id: string): Memory {
  const m = get(db, id);
  if (!m) throw new Error(`no memory ${id}`);
  if (m.status === "active") return m;
  if (m.status !== "pending") throw new Error(`cannot approve a ${m.status} memory`);
  const now = nowIso();
  if (m.replaces) {
    const old = get(db, m.replaces);
    if (old && old.status === "active") {
      db.prepare(
        `UPDATE memories
            SET status = 'superseded', valid_to = ?, updated_at = ?, superseded_by = ?
          WHERE id = ?`
      ).run(now, now, m.id, old.id);
    }
  }
  db.prepare(
    "UPDATE memories SET status = 'active', valid_from = ?, updated_at = ? WHERE id = ?"
  ).run(now, now, id);
  return get(db, id)!;
}

export function reject(db: Db, id: string): Memory {
  const m = get(db, id);
  if (!m) throw new Error(`no memory ${id}`);
  if (m.status !== "pending") throw new Error(`cannot reject a ${m.status} memory`);
  db.prepare("UPDATE memories SET status = 'rejected', updated_at = ? WHERE id = ?").run(nowIso(), id);
  return get(db, id)!;
}

export function forget(db: Db, id: string): Memory {
  const m = get(db, id);
  if (!m) throw new Error(`no memory ${id}`);
  const now = nowIso();
  db.prepare(
    "UPDATE memories SET status = 'forgotten', valid_to = ?, updated_at = ? WHERE id = ?"
  ).run(now, now, id);
  return get(db, id)!;
}

export function pin(db: Db, id: string, value = true): Memory {
  const r = db
    .prepare("UPDATE memories SET pinned = ?, updated_at = ? WHERE id = ?")
    .run(value ? 1 : 0, nowIso(), id);
  if (r.changes === 0) throw new Error(`no memory ${id}`);
  return get(db, id)!;
}

export function replace(db: Db, oldId: string, input: Omit<RememberInput, "replaces">): Memory {
  const old = get(db, oldId);
  if (!old) throw new Error(`no memory ${oldId}`);
  if (old.status !== "active" && old.status !== "pending") {
    throw new Error(`cannot replace a ${old.status} memory`);
  }
  return remember(db, { ...input, replaces: oldId });
}

export interface ListOptions {
  status?: MemoryStatus | "all";
  kind?: MemoryKind;
  q?: string;
  limit?: number;
}

export function list(db: Db, opts: ListOptions = {}): Memory[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status && opts.status !== "all") {
    where.push("status = ?");
    params.push(opts.status);
  }
  if (opts.kind) {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.q) {
    where.push("(text LIKE ? OR tags LIKE ? OR evidence LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  const sql = `SELECT * FROM memories ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY created_at DESC LIMIT ?`;
  params.push(opts.limit ?? 200);
  return (db.prepare(sql).all(...params) as Row[]).map(toMemory);
}

export function all(db: Db): Memory[] {
  return (db.prepare("SELECT * FROM memories ORDER BY created_at ASC").all() as Row[]).map(toMemory);
}

export function stats(db: Db): Record<string, number> {
  const out: Record<string, number> = {
    pending: 0,
    active: 0,
    rejected: 0,
    superseded: 0,
    forgotten: 0,
  };
  const rows = db.prepare("SELECT status, COUNT(*) AS c FROM memories GROUP BY status").all() as {
    status: string;
    c: number;
  }[];
  for (const r of rows) out[r.status] = r.c;
  return out;
}
