const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS day_entries (
  day_key TEXT PRIMARY KEY, ext TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS photo_items (
  id TEXT PRIMARY KEY, day_key TEXT NOT NULL REFERENCES day_entries(day_key),
  original_path TEXT NOT NULL, thumb_path TEXT NOT NULL,
  captured_at TEXT NOT NULL, source_asset_id TEXT,
  sort_index INTEGER NOT NULL, ext TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS photo_day ON photo_items(day_key, sort_index);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS capture_sessions (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ext TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL,
  executed_at TEXT NOT NULL, migration_hash TEXT NOT NULL
);`;

/** 新版本只追加迁移；每条在独立事务中执行，绝不删库重建。 */
const migrations = [
  {
    version: 1,
    name: "initial_schema",
    sql: INITIAL_SCHEMA,
  },
  {
    version: 2,
    name: "meal_groups",
    sql: `
      CREATE TABLE meal_groups (
        id TEXT PRIMARY KEY, started_at TEXT NOT NULL,
        cost_cents INTEGER CHECK(cost_cents IS NULL OR (cost_cents >= 0 AND cost_cents <= 999999999)),
        rating REAL CHECK(rating IS NULL OR (rating >= 0.5 AND rating <= 5 AND rating * 2 = CAST(rating * 2 AS INTEGER))),
        location_json TEXT, ext TEXT NOT NULL DEFAULT '{}'
      );
      ALTER TABLE photo_items ADD COLUMN group_id TEXT REFERENCES meal_groups(id);
      CREATE INDEX photo_group ON photo_items(group_id, captured_at);
      INSERT INTO meal_groups(id, started_at)
        SELECT 'legacy-' || day_key, MIN(captured_at) FROM photo_items GROUP BY day_key;
      UPDATE photo_items SET group_id = 'legacy-' || day_key;
    `,
  },
];

export { migrations, INITIAL_SCHEMA };
