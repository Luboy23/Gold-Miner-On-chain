use alloy::primitives::Address;
use anyhow::Result;
use sqlx::{query, Row, SqlitePool};

use crate::{
    format_address, parse_address,
    models::{
        ReadModelCampaignHistoryEntry, ReadModelCampaignLeaderboardEntry,
        ReadModelCampaignResult,
    },
};

pub async fn query_campaign_leaderboard(
    pool: &SqlitePool,
    limit: u32,
) -> Result<Vec<ReadModelCampaignLeaderboardEntry>> {
    let rows = query(
        r#"
        SELECT player, campaign_id, reached_level, completed, final_score, total_duration_ms,
               purchased_item_count, evidence_hash, submitted_at_ms
        FROM indexed_campaigns
        ORDER BY reached_level DESC, completed DESC, final_score DESC, total_duration_ms ASC, purchased_item_count ASC, submitted_at_ms ASC
        LIMIT ?
        "#,
    )
    .bind(limit as i64)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(ReadModelCampaignLeaderboardEntry {
                player: parse_address(&row.try_get::<String, _>("player")?)?,
                result: ReadModelCampaignResult {
                    campaign_id: row.try_get::<String, _>("campaign_id")?.parse()?,
                    reached_level: row.try_get::<i64, _>("reached_level")? as u8,
                    completed: row.try_get::<i64, _>("completed")? != 0,
                    final_score: row.try_get::<i64, _>("final_score")? as u32,
                    total_duration_ms: row.try_get::<i64, _>("total_duration_ms")? as u32,
                    purchased_item_count: row.try_get::<i64, _>("purchased_item_count")? as u16,
                    evidence_hash: row.try_get::<String, _>("evidence_hash")?.parse()?,
                    submitted_at: row.try_get::<i64, _>("submitted_at_ms")? as u64,
                },
            })
        })
        .collect()
}

pub async fn query_campaign_history(
    pool: &SqlitePool,
    player: Address,
    limit: u32,
    offset: u32,
) -> Result<Vec<ReadModelCampaignHistoryEntry>> {
    let rows = query(
        r#"
        SELECT player, campaign_id, reached_level, completed, final_score, total_duration_ms,
               purchased_item_count, evidence_hash, submitted_at_ms
        FROM indexed_campaigns
        WHERE player = ?
        ORDER BY submitted_at_ms DESC, block_number DESC, log_index DESC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(format_address(player))
    .bind(limit as i64)
    .bind(offset as i64)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(ReadModelCampaignHistoryEntry {
                player: parse_address(&row.try_get::<String, _>("player")?)?,
                result: ReadModelCampaignResult {
                    campaign_id: row.try_get::<String, _>("campaign_id")?.parse()?,
                    reached_level: row.try_get::<i64, _>("reached_level")? as u8,
                    completed: row.try_get::<i64, _>("completed")? != 0,
                    final_score: row.try_get::<i64, _>("final_score")? as u32,
                    total_duration_ms: row.try_get::<i64, _>("total_duration_ms")? as u32,
                    purchased_item_count: row.try_get::<i64, _>("purchased_item_count")? as u16,
                    evidence_hash: row.try_get::<String, _>("evidence_hash")?.parse()?,
                    submitted_at: row.try_get::<i64, _>("submitted_at_ms")? as u64,
                },
            })
        })
        .collect()
}
