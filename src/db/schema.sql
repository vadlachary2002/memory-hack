-- Sessions are the time axis. idx is the 1-based session number from the harness.
CREATE TABLE IF NOT EXISTS sessions (
  idx INTEGER PRIMARY KEY,
  started_at TEXT
);

-- Raw chat turns. text is nulled on redaction; redacted_at holds the session that asked.
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY,
  session_idx INTEGER NOT NULL REFERENCES sessions(idx),
  idx INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT,
  redacted_at INTEGER,
  UNIQUE (session_idx, idx)
);

-- People, pets and the user. Name and aliases are nulled on erase.
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  canonical_name TEXT,
  type TEXT NOT NULL CHECK (type IN ('user', 'person', 'pet', 'org', 'place', 'thing')),
  aliases_json TEXT NOT NULL DEFAULT '[]',
  roles_json TEXT NOT NULL DEFAULT '[]',
  first_session_idx INTEGER,
  erased_at INTEGER
);

-- The ledger. object_text, object_entity_id and quote are nulled on erase;
-- id, predicate and erased_at remain for lineage.
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY,
  subject_entity_id INTEGER NOT NULL REFERENCES entities(id),
  predicate TEXT NOT NULL,
  attr_key TEXT,
  object_text TEXT,
  object_entity_id INTEGER REFERENCES entities(id),
  quote TEXT,
  source_turn_id INTEGER REFERENCES turns(id),
  session_idx INTEGER NOT NULL REFERENCES sessions(idx),
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  domains_json TEXT NOT NULL DEFAULT '[]',
  tier TEXT NOT NULL CHECK (tier IN ('durable', 'scratch')),
  erased_at INTEGER
);

CREATE INDEX IF NOT EXISTS facts_open_idx ON facts (subject_entity_id, predicate, valid_to);
CREATE INDEX IF NOT EXISTS facts_object_entity_idx ON facts (object_entity_id);

-- Audit trail of forget requests. report_json holds ids only, never names.
CREATE TABLE IF NOT EXISTS deletions (
  id INTEGER PRIMARY KEY,
  target_json TEXT NOT NULL,
  request_turn_id INTEGER REFERENCES turns(id),
  requested_at INTEGER NOT NULL,
  report_json TEXT NOT NULL
);

-- Every model call with its cost.
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('extract', 'classify', 'answer')),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL,
  session_idx INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
