use alloy::primitives::{Address, B256};
use anyhow::{anyhow, Result};
use goldminer_core::ActiveSessionPermit;
use sqlx::{query, Row, SqlitePool};

use super::{common::is_unique_violation, sqlite_decode::map_session_row};
use crate::{
    format_address, format_b256,
    models::{
        SessionRow, SESSION_STATUS_ACTIVE, SESSION_STATUS_CREATED, SESSION_STATUS_QUEUED,
    },
};

pub async fn create_game_session<F>(
    pool: &SqlitePool,
    player: Address,
    deployment_id: &str,
    created_at_ms: u64,
    build_permit: F,
) -> Result<ActiveSessionPermit>
where
    F: Fn(u32) -> ActiveSessionPermit,
{
    let mut last_unique_error = None;

    for _ in 0..3 {
        let mut tx = pool.begin().await?;
        let row = query(
            "SELECT COALESCE(MAX(nonce), -1) AS nonce FROM sessions WHERE player = ? AND deployment_id = ?",
        )
        .bind(format_address(player))
        .bind(deployment_id)
        .fetch_one(&mut *tx)
        .await?;
        let nonce = row.try_get::<i64, _>("nonce")?;
        let permit = build_permit((nonce + 1) as u32);
        let insert_result = query(
            r#"
            INSERT INTO sessions (
                session_id, player, delegate, deployment_id, nonce, issued_at, deadline, max_runs,
                permit_signature, status, finalize_requested_at_ms, accepted_run_count, last_error, created_at_ms, updated_at_ms
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, NULL, ?, ?)
            "#,
        )
        .bind(format_b256(permit.session_id))
        .bind(format_address(permit.player))
        .bind(format_address(permit.delegate))
        .bind(deployment_id)
        .bind(i64::from(permit.nonce))
        .bind(permit.issued_at as i64)
        .bind(permit.deadline as i64)
        .bind(i64::from(permit.max_runs))
        .bind(SESSION_STATUS_CREATED)
        .bind(created_at_ms as i64)
        .bind(created_at_ms as i64)
        .execute(&mut *tx)
        .await;

        match insert_result {
            Ok(_) => {
                tx.commit().await?;
                return Ok(permit);
            }
            Err(error) if is_unique_violation(&error) => {
                tx.rollback().await?;
                last_unique_error = Some(error);
            }
            Err(error) => return Err(error.into()),
        }
    }

    Err(anyhow!(
        "failed to allocate a unique session nonce after retries: {}",
        last_unique_error
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "unique constraint conflict".to_string())
    ))
}

pub async fn allocate_session_nonce(pool: &SqlitePool, player: Address) -> Result<u32> {
    let row = query("SELECT COALESCE(MAX(nonce), -1) AS nonce FROM sessions WHERE player = ?")
        .bind(format_address(player))
        .fetch_one(pool)
        .await?;
    let nonce = row.try_get::<i64, _>("nonce")?;
    Ok((nonce + 1) as u32)
}

pub async fn insert_game_session(
    pool: &SqlitePool,
    permit: &ActiveSessionPermit,
    deployment_id: &str,
    created_at_ms: u64,
) -> Result<()> {
    query(
        r#"
        INSERT INTO sessions (
            session_id, player, delegate, deployment_id, nonce, issued_at, deadline, max_runs,
            permit_signature, status, finalize_requested_at_ms, accepted_run_count, last_error, created_at_ms, updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, NULL, ?, ?)
        "#,
    )
    .bind(format_b256(permit.session_id))
    .bind(format_address(permit.player))
    .bind(format_address(permit.delegate))
    .bind(deployment_id)
    .bind(i64::from(permit.nonce))
    .bind(permit.issued_at as i64)
    .bind(permit.deadline as i64)
    .bind(i64::from(permit.max_runs))
    .bind(SESSION_STATUS_CREATED)
    .bind(created_at_ms as i64)
    .bind(created_at_ms as i64)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_session_row(
    pool: &SqlitePool,
    session_id: B256,
    player: Address,
    deployment_id: &str,
) -> Result<Option<SessionRow>> {
    let row = query(
        r#"
        SELECT *
        FROM sessions
        WHERE session_id = ? AND player = ? AND deployment_id = ?
        "#,
    )
    .bind(format_b256(session_id))
    .bind(format_address(player))
    .bind(deployment_id)
    .fetch_optional(pool)
    .await?;

    row.map(map_session_row).transpose()
}

pub async fn load_session_row_by_id(
    pool: &SqlitePool,
    session_id: B256,
    deployment_id: &str,
) -> Result<Option<SessionRow>> {
    let row = query(
        r#"
        SELECT *
        FROM sessions
        WHERE session_id = ? AND deployment_id = ?
        "#,
    )
    .bind(format_b256(session_id))
    .bind(deployment_id)
    .fetch_optional(pool)
    .await?;

    row.map(map_session_row).transpose()
}

pub async fn activate_game_session(
    pool: &SqlitePool,
    session_id: B256,
    player: Address,
    signature: &str,
    activated_at_ms: u64,
) -> Result<()> {
    query(
        r#"
        UPDATE sessions
        SET permit_signature = ?, status = ?, updated_at_ms = ?
        WHERE session_id = ? AND player = ?
        "#,
    )
    .bind(signature)
    .bind(SESSION_STATUS_ACTIVE)
    .bind(activated_at_ms as i64)
    .bind(format_b256(session_id))
    .bind(format_address(player))
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn increment_accepted_run_count(
    pool: &SqlitePool,
    session_id: B256,
    accepted_run_count: i64,
    updated_at_ms: u64,
) -> Result<()> {
    query("UPDATE sessions SET accepted_run_count = ?, updated_at_ms = ? WHERE session_id = ?")
        .bind(accepted_run_count)
        .bind(updated_at_ms as i64)
        .bind(format_b256(session_id))
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn queue_session_for_finalize(
    pool: &SqlitePool,
    session_id: B256,
    now_ms_value: u64,
) -> Result<()> {
    query(
        "UPDATE sessions SET status = ?, finalize_requested_at_ms = ?, updated_at_ms = ? WHERE session_id = ?",
    )
    .bind(SESSION_STATUS_QUEUED)
    .bind(now_ms_value as i64)
    .bind(now_ms_value as i64)
    .bind(format_b256(session_id))
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_sessions_ready_for_finalize(
    pool: &SqlitePool,
    idle_before_ms: u64,
) -> Result<Vec<SessionRow>> {
    let rows = query(
        r#"
        SELECT *
        FROM sessions
        WHERE status = ? OR (
            status = ? AND accepted_run_count > 0 AND finalize_requested_at_ms IS NULL AND updated_at_ms <= ?
        )
        ORDER BY updated_at_ms ASC
        "#,
    )
    .bind(SESSION_STATUS_QUEUED)
    .bind(SESSION_STATUS_ACTIVE)
    .bind(idle_before_ms as i64)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(map_session_row).collect()
}

pub async fn set_session_status(
    pool: &SqlitePool,
    session_id: B256,
    status: &str,
    last_error: Option<&str>,
    updated_at_ms: u64,
) -> Result<()> {
    query("UPDATE sessions SET status = ?, last_error = ?, updated_at_ms = ? WHERE session_id = ?")
        .bind(status)
        .bind(last_error)
        .bind(updated_at_ms as i64)
        .bind(format_b256(session_id))
        .execute(pool)
        .await?;
    Ok(())
}
