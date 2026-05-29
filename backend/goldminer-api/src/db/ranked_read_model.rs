use alloy::primitives::Address;
use anyhow::Result;
use sqlx::{query, Row, SqlitePool};

use crate::{
    format_address, parse_address,
    models::{
        ReadModelGapSummary, ReadModelHistoryEntry, ReadModelLeaderboardEntry, ReadModelRunResult,
        RankedOverviewLatestRun, RankedOverviewPersonalBest, RankedOverviewResponse,
    },
};

pub async fn query_leaderboard(
    pool: &SqlitePool,
    challenge_id: &str,
    challenge_version: u32,
    limit: u32,
) -> Result<Vec<ReadModelLeaderboardEntry>> {
    let rows = query(
        r#"
        SELECT player, challenge_id, challenge_version, diamonds_caught, last_diamond_at_ms, evidence_hash, submitted_at_ms
        FROM indexed_verified_runs
        WHERE challenge_id = ? AND challenge_version = ?
        ORDER BY diamonds_caught DESC, last_diamond_at_ms ASC, submitted_at_ms ASC
        LIMIT ?
        "#,
    )
    .bind(challenge_id)
    .bind(i64::from(challenge_version))
    .bind(limit as i64)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(ReadModelLeaderboardEntry {
                player: parse_address(&row.try_get::<String, _>("player")?)?,
                result: ReadModelRunResult {
                    challenge_id: row.try_get("challenge_id")?,
                    challenge_version: row.try_get::<i64, _>("challenge_version")? as u32,
                    diamonds_caught: row.try_get::<i64, _>("diamonds_caught")? as u32,
                    last_diamond_at_ms: row.try_get::<i64, _>("last_diamond_at_ms")? as u32,
                    evidence_hash: row.try_get::<String, _>("evidence_hash")?.parse()?,
                    submitted_at: row.try_get::<i64, _>("submitted_at_ms")? as u64,
                },
            })
        })
        .collect()
}

pub async fn query_history(
    pool: &SqlitePool,
    player: Address,
    limit: u32,
    offset: u32,
) -> Result<Vec<ReadModelHistoryEntry>> {
    let rows = query(
        r#"
        SELECT player, challenge_id, challenge_version, diamonds_caught, last_diamond_at_ms, evidence_hash, submitted_at_ms
        FROM indexed_verified_runs
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
            Ok(ReadModelHistoryEntry {
                player: parse_address(&row.try_get::<String, _>("player")?)?,
                result: ReadModelRunResult {
                    challenge_id: row.try_get("challenge_id")?,
                    challenge_version: row.try_get::<i64, _>("challenge_version")? as u32,
                    diamonds_caught: row.try_get::<i64, _>("diamonds_caught")? as u32,
                    last_diamond_at_ms: row.try_get::<i64, _>("last_diamond_at_ms")? as u32,
                    evidence_hash: row.try_get::<String, _>("evidence_hash")?.parse()?,
                    submitted_at: row.try_get::<i64, _>("submitted_at_ms")? as u64,
                },
            })
        })
        .collect()
}

pub async fn query_overview(
    pool: &SqlitePool,
    player: Address,
    challenge_id: &str,
    challenge_version: u32,
) -> Result<RankedOverviewResponse> {
    let player_value = format_address(player);

    let personal_best_row = query(
        r#"
        SELECT diamonds_caught, last_diamond_at_ms
        FROM indexed_verified_runs
        WHERE player = ? AND challenge_id = ? AND challenge_version = ?
        ORDER BY diamonds_caught DESC, last_diamond_at_ms ASC, submitted_at_ms ASC
        LIMIT 1
        "#,
    )
    .bind(&player_value)
    .bind(challenge_id)
    .bind(i64::from(challenge_version))
    .fetch_optional(pool)
    .await?;

    let latest_run_row = query(
        r#"
        SELECT diamonds_caught, last_diamond_at_ms, submitted_at_ms
        FROM indexed_verified_runs
        WHERE player = ? AND challenge_id = ? AND challenge_version = ?
        ORDER BY submitted_at_ms DESC, block_number DESC, log_index DESC
        LIMIT 1
        "#,
    )
    .bind(&player_value)
    .bind(challenge_id)
    .bind(i64::from(challenge_version))
    .fetch_optional(pool)
    .await?;

    let count_row = query(
        r#"
        SELECT COUNT(*) AS run_count
        FROM indexed_verified_runs
        WHERE player = ? AND challenge_id = ? AND challenge_version = ?
        "#,
    )
    .bind(&player_value)
    .bind(challenge_id)
    .bind(i64::from(challenge_version))
    .fetch_one(pool)
    .await?;

    let leader_row = query(
        r#"
        SELECT player, diamonds_caught, last_diamond_at_ms
        FROM indexed_verified_runs
        WHERE challenge_id = ? AND challenge_version = ?
        ORDER BY diamonds_caught DESC, last_diamond_at_ms ASC, submitted_at_ms ASC
        LIMIT 1
        "#,
    )
    .bind(challenge_id)
    .bind(i64::from(challenge_version))
    .fetch_optional(pool)
    .await?;

    let personal_best = personal_best_row.map(|row| RankedOverviewPersonalBest {
        best_diamonds_caught: row.try_get::<i64, _>("diamonds_caught").unwrap_or_default() as u32,
        best_last_diamond_at_ms: Some(
            row.try_get::<i64, _>("last_diamond_at_ms").unwrap_or_default() as u32,
        ),
    });

    let latest_run = latest_run_row.map(|row| RankedOverviewLatestRun {
        diamonds_caught: row.try_get::<i64, _>("diamonds_caught").unwrap_or_default() as u32,
        last_diamond_at_ms: row.try_get::<i64, _>("last_diamond_at_ms").unwrap_or_default() as u32,
        submitted_at: row.try_get::<i64, _>("submitted_at_ms").unwrap_or_default() as u64,
    });

    let run_count = count_row.try_get::<i64, _>("run_count").unwrap_or_default() as u32;

    let current_best_rank = if let Some(best) = &personal_best {
        let rank_row = query(
            r#"
            SELECT COUNT(*) + 1 AS rank
            FROM (
                SELECT player, diamonds_caught, last_diamond_at_ms
                FROM indexed_verified_runs
                WHERE challenge_id = ? AND challenge_version = ?
                GROUP BY player
                HAVING
                    MAX(diamonds_caught) > ?
                    OR (
                        MAX(diamonds_caught) = ?
                        AND MIN(
                            CASE
                                WHEN diamonds_caught = ? THEN last_diamond_at_ms
                                ELSE NULL
                            END
                        ) < ?
                    )
            )
            "#,
        )
        .bind(challenge_id)
        .bind(i64::from(challenge_version))
        .bind(i64::from(best.best_diamonds_caught))
        .bind(i64::from(best.best_diamonds_caught))
        .bind(i64::from(best.best_diamonds_caught))
        .bind(i64::from(best.best_last_diamond_at_ms.unwrap_or_default()))
        .fetch_one(pool)
        .await?;

        Some(rank_row.try_get::<i64, _>("rank").unwrap_or(1) as u32)
    } else {
        None
    };

    let leader_gap = match (&personal_best, leader_row) {
        (Some(best), Some(row)) => {
            let leader_player = row.try_get::<String, _>("player")?;
            let leader_diamonds = row.try_get::<i64, _>("diamonds_caught")? as u32;
            let leader_time = row.try_get::<i64, _>("last_diamond_at_ms")? as u32;
            if leader_player == player_value {
                None
            } else {
                Some(ReadModelGapSummary {
                    diamonds_delta: leader_diamonds.saturating_sub(best.best_diamonds_caught),
                    time_delta_ms: if leader_diamonds == best.best_diamonds_caught {
                        Some(best.best_last_diamond_at_ms.unwrap_or_default().saturating_sub(leader_time))
                    } else {
                        None
                    },
                })
            }
        }
        _ => None,
    };

    let next_beat_gap = if let Some(best) = &personal_best {
        let row = query(
            r#"
            SELECT diamonds_caught, last_diamond_at_ms
            FROM (
                SELECT player, diamonds_caught, last_diamond_at_ms, submitted_at_ms
                FROM indexed_verified_runs
                WHERE challenge_id = ? AND challenge_version = ?
                ORDER BY diamonds_caught DESC, last_diamond_at_ms ASC, submitted_at_ms ASC
            )
            WHERE
                diamonds_caught > ?
                OR (diamonds_caught = ? AND last_diamond_at_ms < ?)
            LIMIT 1
            "#,
        )
        .bind(challenge_id)
        .bind(i64::from(challenge_version))
        .bind(i64::from(best.best_diamonds_caught))
        .bind(i64::from(best.best_diamonds_caught))
        .bind(i64::from(best.best_last_diamond_at_ms.unwrap_or_default()))
        .fetch_optional(pool)
        .await?;

        row.map(|entry| {
            let target_diamonds = entry.try_get::<i64, _>("diamonds_caught").unwrap_or_default() as u32;
            let target_time = entry.try_get::<i64, _>("last_diamond_at_ms").unwrap_or_default() as u32;
            ReadModelGapSummary {
                diamonds_delta: target_diamonds.saturating_sub(best.best_diamonds_caught),
                time_delta_ms: if target_diamonds == best.best_diamonds_caught {
                    Some(best.best_last_diamond_at_ms.unwrap_or_default().saturating_sub(target_time))
                } else {
                    None
                },
            }
        })
    } else {
        None
    };

    Ok(RankedOverviewResponse {
        challenge_id: challenge_id.to_string(),
        challenge_version,
        personal_best,
        latest_run,
        run_count,
        current_best_rank,
        leader_gap,
        next_beat_gap,
    })
}
