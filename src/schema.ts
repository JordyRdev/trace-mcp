export const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  status TEXT NOT NULL DEFAULT 'pending',
  confidence REAL NOT NULL DEFAULT 0.6,
  tags TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'unknown',
  evidence TEXT NOT NULL DEFAULT '',
  evidence_date TEXT,
  replaces TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  superseded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(pinned, status);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  text,
  tags,
  content='memories',
  content_rowid='seq',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text, tags) VALUES (new.seq, new.text, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text, tags)
  VALUES ('delete', old.seq, old.text, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text, tags)
  VALUES ('delete', old.seq, old.text, old.tags);
  INSERT INTO memories_fts(rowid, text, tags) VALUES (new.seq, new.text, new.tags);
END;
`;
