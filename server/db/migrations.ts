// Ordered, append-only schema migrations. Never edit a migration that has
// shipped; add a new one instead.
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
      CREATE TABLE prompt_versions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        version       INTEGER NOT NULL UNIQUE,
        label         TEXT    NOT NULL,
        system_prompt TEXT    NOT NULL,
        user_template TEXT    NOT NULL,
        parent_id     INTEGER REFERENCES prompt_versions(id),
        created_at    TEXT    NOT NULL
      );

      -- Saving an edit creates a new version; earlier versions are never rewritten.
      CREATE TRIGGER prompt_versions_no_update BEFORE UPDATE ON prompt_versions
      BEGIN SELECT RAISE(ABORT, 'prompt versions are immutable'); END;
      CREATE TRIGGER prompt_versions_no_delete BEFORE DELETE ON prompt_versions
      BEGIN SELECT RAISE(ABORT, 'prompt versions are immutable'); END;

      CREATE TABLE runs (
        id                TEXT    PRIMARY KEY,
        prompt_version_id INTEGER NOT NULL REFERENCES prompt_versions(id),
        prompt_snapshot   TEXT    NOT NULL,
        model_settings    TEXT    NOT NULL,
        fixture_selection TEXT    NOT NULL,
        fixture_snapshot  TEXT    NOT NULL,
        fixture_hash      TEXT    NOT NULL,
        status            TEXT    NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
        status_reason     TEXT,
        created_at        TEXT    NOT NULL,
        started_at        TEXT,
        finished_at       TEXT
      );

      -- Run inputs are recorded once; only status columns may change afterwards.
      CREATE TRIGGER runs_inputs_frozen BEFORE UPDATE OF prompt_version_id, prompt_snapshot, model_settings,
        fixture_selection, fixture_snapshot, fixture_hash ON runs
      BEGIN SELECT RAISE(ABORT, 'run inputs are immutable'); END;

      CREATE TABLE case_results (
        run_id        TEXT    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        idx           INTEGER NOT NULL,
        fixture_id    TEXT    NOT NULL,
        status        TEXT    NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
        output        TEXT    NOT NULL DEFAULT '',
        interrupted   INTEGER NOT NULL DEFAULT 0,
        evaluation    TEXT,
        error         TEXT,
        attempt_log   TEXT    NOT NULL DEFAULT '[]',
        ttft_ms       REAL,
        duration_ms   REAL,
        input_tokens  INTEGER,
        output_tokens INTEGER,
        request_id    TEXT,
        message_id    TEXT,
        served_model  TEXT,
        stop_reason   TEXT,
        attempts      INTEGER NOT NULL DEFAULT 0,
        started_at    TEXT,
        finished_at   TEXT,
        PRIMARY KEY (run_id, idx)
      );

      CREATE INDEX runs_created_at ON runs(created_at DESC);
    `,
  },
  {
    version: 2,
    name: "record which process is executing a run",
    // The API server and the CLI can share one database; startup cleanup must
    // only touch runs whose executing process has actually gone away.
    sql: `ALTER TABLE runs ADD COLUMN runner_pid INTEGER;`,
  },
];
