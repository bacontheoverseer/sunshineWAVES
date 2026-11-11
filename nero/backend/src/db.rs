use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use anyhow::Result;

pub fn init(pool: &Pool<SqliteConnectionManager>) -> Result<()> {
    let conn = pool.get()?;
    conn.execute_batch("
        PRAGMA journal_mode=WAL;

        CREATE TABLE IF NOT EXISTS users (
            id          TEXT PRIMARY KEY,
            username    TEXT NOT NULL UNIQUE,
            password    TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS favorites (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            game_id     TEXT NOT NULL,
            game_name   TEXT NOT NULL,
            game_url    TEXT NOT NULL,
            cover_url   TEXT,
            source_key  TEXT NOT NULL,
            added_at    TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, game_id)
        );
    ")?;
    Ok(())
}
