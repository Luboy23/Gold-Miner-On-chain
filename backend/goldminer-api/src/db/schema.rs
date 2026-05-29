use anyhow::Result;
use sqlx::{query, SqlitePool};

use crate::{models::{INDEXER_CURSOR_KEY, INDEXER_STATUS_IDLE}, now_ms};

pub async fn init_db(pool: &SqlitePool) -> Result<()> {
    for statement in [
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            player TEXT NOT NULL,
            delegate TEXT NOT NULL,
            deployment_id TEXT NOT NULL,
            nonce INTEGER NOT NULL,
            issued_at INTEGER NOT NULL,
            deadline INTEGER NOT NULL,
            max_runs INTEGER NOT NULL,
            permit_signature TEXT,
            status TEXT NOT NULL,
            finalize_requested_at_ms INTEGER,
            accepted_run_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS runs (
            run_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            player TEXT NOT NULL,
            challenge_id TEXT NOT NULL,
            challenge_version INTEGER NOT NULL,
            diamonds_caught INTEGER NOT NULL,
            last_diamond_at_ms INTEGER NOT NULL,
            evidence_hash TEXT NOT NULL,
            protocol_version INTEGER,
            simulation_version INTEGER,
            challenge_seed TEXT,
            finished_tick INTEGER,
            payload_json TEXT NOT NULL,
            verified_payload_json TEXT,
            status TEXT NOT NULL,
            tx_hash TEXT,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS campaigns (
            campaign_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL UNIQUE,
            player TEXT NOT NULL,
            campaign_seed TEXT NOT NULL,
            permit_signature TEXT,
            payload_json TEXT,
            verified_payload_json TEXT,
            status TEXT NOT NULL,
            tx_hash TEXT,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS indexed_verified_runs (
            tx_hash TEXT NOT NULL,
            log_index INTEGER NOT NULL,
            player TEXT NOT NULL,
            challenge_id TEXT NOT NULL,
            challenge_version INTEGER NOT NULL,
            diamonds_caught INTEGER NOT NULL,
            last_diamond_at_ms INTEGER NOT NULL,
            evidence_hash TEXT NOT NULL,
            submitted_at_ms INTEGER NOT NULL,
            block_number INTEGER NOT NULL,
            PRIMARY KEY (tx_hash, log_index)
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS indexed_campaigns (
            tx_hash TEXT NOT NULL,
            log_index INTEGER NOT NULL,
            player TEXT NOT NULL,
            campaign_id TEXT NOT NULL,
            reached_level INTEGER NOT NULL,
            completed INTEGER NOT NULL,
            final_score INTEGER NOT NULL,
            total_duration_ms INTEGER NOT NULL,
            purchased_item_count INTEGER NOT NULL,
            evidence_hash TEXT NOT NULL,
            submitted_at_ms INTEGER NOT NULL,
            block_number INTEGER NOT NULL,
            PRIMARY KEY (tx_hash, log_index)
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS indexer_cursors (
            cursor_key TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            last_processed_block INTEGER NOT NULL,
            last_processed_log_index INTEGER NOT NULL,
            last_error TEXT,
            updated_at_ms INTEGER NOT NULL
        )
        "#,
    ] {
        query(statement).execute(pool).await?;
    }

    for statement in [
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_player_deployment_nonce ON sessions(player, deployment_id, nonce)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_status_updated_at ON sessions(status, updated_at_ms)",
        "CREATE INDEX IF NOT EXISTS idx_runs_session_status_created_at ON runs(session_id, status, created_at_ms)",
        "CREATE INDEX IF NOT EXISTS idx_runs_tx_hash ON runs(tx_hash) WHERE tx_hash IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_campaigns_player_status_updated_at ON campaigns(player, status, updated_at_ms)",
        "CREATE INDEX IF NOT EXISTS idx_campaigns_tx_hash ON campaigns(tx_hash) WHERE tx_hash IS NOT NULL",
        r#"
        CREATE INDEX IF NOT EXISTS idx_indexed_runs_leaderboard
        ON indexed_verified_runs(
            challenge_id,
            challenge_version,
            diamonds_caught DESC,
            last_diamond_at_ms ASC,
            submitted_at_ms ASC
        )
        "#,
        r#"
        CREATE INDEX IF NOT EXISTS idx_indexed_runs_player_history
        ON indexed_verified_runs(player, submitted_at_ms DESC, block_number DESC, log_index DESC)
        "#,
        r#"
        CREATE INDEX IF NOT EXISTS idx_indexed_campaigns_leaderboard
        ON indexed_campaigns(
            reached_level DESC,
            completed DESC,
            final_score DESC,
            total_duration_ms ASC,
            purchased_item_count ASC,
            submitted_at_ms ASC
        )
        "#,
    ] {
        query(statement).execute(pool).await?;
    }

    query(
        r#"
        INSERT INTO indexer_cursors (cursor_key, status, last_processed_block, last_processed_log_index, last_error, updated_at_ms)
        VALUES (?, ?, 0, -1, NULL, ?)
        ON CONFLICT(cursor_key) DO NOTHING
        "#,
    )
    .bind(INDEXER_CURSOR_KEY)
    .bind(INDEXER_STATUS_IDLE)
    .bind(now_ms() as i64)
    .execute(pool)
    .await?;

    for column in [
        "protocol_version INTEGER",
        "simulation_version INTEGER",
        "challenge_seed TEXT",
        "finished_tick INTEGER",
        "verified_payload_json TEXT",
    ] {
        add_column_if_missing(pool, "runs", column).await?;
    }

    Ok(())
}

pub async fn add_column_if_missing(
    pool: &SqlitePool,
    table: &str,
    column_definition: &str,
) -> Result<()> {
    let statement = format!("ALTER TABLE {table} ADD COLUMN {column_definition}");
    match query(&statement).execute(pool).await {
        Ok(_) => Ok(()),
        Err(error) => {
            let message = error.to_string();
            if message.contains("duplicate column name") {
                Ok(())
            } else {
                Err(error.into())
            }
        }
    }
}
