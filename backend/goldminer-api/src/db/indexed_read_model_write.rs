use alloy::primitives::{Address, B256};
use anyhow::Result;
use sqlx::{query, Row, SqlitePool};

use crate::{
    format_address, format_b256,
    models::{IndexerCursorRow, INDEXER_CURSOR_KEY, IndexerStatusResponse},
    now_ms,
};

pub async fn load_indexer_cursor(pool: &SqlitePool) -> Result<IndexerCursorRow> {
    let row = query(
        r#"
        SELECT status, last_processed_block, last_processed_log_index, last_error
        FROM indexer_cursors
        WHERE cursor_key = ?
        "#,
    )
    .bind(INDEXER_CURSOR_KEY)
    .fetch_one(pool)
    .await?;

    Ok(IndexerCursorRow {
        status: row.try_get("status")?,
        last_processed_block: row.try_get::<i64, _>("last_processed_block")? as u64,
        last_processed_log_index: row.try_get("last_processed_log_index")?,
        last_error: row.try_get("last_error")?,
    })
}

pub async fn update_indexer_status(
    pool: &SqlitePool,
    status: &str,
    last_processed_block: u64,
    last_processed_log_index: i64,
    last_error: Option<&str>,
) -> Result<()> {
    query(
        r#"
        UPDATE indexer_cursors
        SET status = ?, last_processed_block = ?, last_processed_log_index = ?, last_error = ?, updated_at_ms = ?
        WHERE cursor_key = ?
        "#,
    )
    .bind(status)
    .bind(last_processed_block as i64)
    .bind(last_processed_log_index)
    .bind(last_error)
    .bind(now_ms() as i64)
    .bind(INDEXER_CURSOR_KEY)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn insert_indexed_run(
    pool: &SqlitePool,
    tx_hash: B256,
    log_index: u64,
    player: Address,
    challenge_id: String,
    challenge_version: u32,
    diamonds_caught: u32,
    last_diamond_at_ms: u32,
    evidence_hash: B256,
    submitted_at_ms: u64,
    block_number: u64,
) -> Result<()> {
    query(
        r#"
        INSERT INTO indexed_verified_runs (
            tx_hash, log_index, player, challenge_id, challenge_version, diamonds_caught, last_diamond_at_ms,
            evidence_hash, submitted_at_ms, block_number
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tx_hash, log_index) DO NOTHING
        "#,
    )
    .bind(format_b256(tx_hash))
    .bind(log_index as i64)
    .bind(format_address(player))
    .bind(challenge_id)
    .bind(i64::from(challenge_version))
    .bind(i64::from(diamonds_caught))
    .bind(i64::from(last_diamond_at_ms))
    .bind(format_b256(evidence_hash))
    .bind(submitted_at_ms as i64)
    .bind(block_number as i64)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn insert_indexed_campaign(
    pool: &SqlitePool,
    tx_hash: B256,
    log_index: u64,
    player: Address,
    campaign_id: B256,
    reached_level: u8,
    completed: bool,
    final_score: u32,
    total_duration_ms: u32,
    purchased_item_count: u16,
    evidence_hash: B256,
    submitted_at_ms: u64,
    block_number: u64,
) -> Result<()> {
    query(
        r#"
        INSERT INTO indexed_campaigns (
            tx_hash, log_index, player, campaign_id, reached_level, completed, final_score,
            total_duration_ms, purchased_item_count, evidence_hash, submitted_at_ms, block_number
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tx_hash, log_index) DO NOTHING
        "#,
    )
    .bind(format_b256(tx_hash))
    .bind(log_index as i64)
    .bind(format_address(player))
    .bind(format_b256(campaign_id))
    .bind(i64::from(reached_level))
    .bind(if completed { 1 } else { 0 })
    .bind(i64::from(final_score))
    .bind(i64::from(total_duration_ms))
    .bind(i64::from(purchased_item_count))
    .bind(format_b256(evidence_hash))
    .bind(submitted_at_ms as i64)
    .bind(block_number as i64)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn query_indexer_status(pool: &SqlitePool) -> Result<IndexerStatusResponse> {
    let cursor = load_indexer_cursor(pool).await?;
    Ok(IndexerStatusResponse {
        ok: true,
        status: cursor.status,
        last_processed_block: cursor.last_processed_block,
        last_processed_log_index: cursor.last_processed_log_index,
        last_error: cursor.last_error,
    })
}
