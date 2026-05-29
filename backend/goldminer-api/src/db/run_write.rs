use alloy::primitives::{Address, B256};
use anyhow::{anyhow, Result};
use goldminer_core::VerifiedRunRecord;
use sqlx::{query, Row, SqlitePool};

use super::{
    common::{RunStatusCounts, StoredRun, ValidatedRunInsertOutcome},
    sqlite_decode::{bytes32_level_id, map_stored_run},
};
use crate::{
    format_address, format_b256,
    models::{
        RUN_STATUS_CONFIRMED, RUN_STATUS_FAILED, RUN_STATUS_SUBMITTED, RUN_STATUS_VALIDATED,
        SESSION_STATUS_ACTIVE,
    },
};

pub async fn insert_validated_run(
    pool: &SqlitePool,
    session_id: B256,
    player: Address,
    verified: &VerifiedRunRecord,
    protocol_version: u8,
    simulation_version: u16,
    challenge_seed: B256,
    finished_tick: u32,
    payload_json: &str,
    verified_payload_json: &str,
    created_at_ms: u64,
) -> Result<bool> {
    let result = query(
        r#"
        INSERT OR IGNORE INTO runs (
            run_id, session_id, player, challenge_id, challenge_version, diamonds_caught, last_diamond_at_ms,
            evidence_hash, protocol_version, simulation_version, challenge_seed,
            finished_tick, payload_json, verified_payload_json, status, tx_hash, last_error,
            created_at_ms, updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        "#,
    )
    .bind(format_b256(verified.run_id))
    .bind(format_b256(session_id))
    .bind(format_address(player))
    .bind(bytes32_level_id(verified.challenge_id))
    .bind(i64::from(verified.challenge_version))
    .bind(i64::from(verified.diamonds_caught))
    .bind(i64::from(verified.last_diamond_at_ms))
    .bind(format_b256(verified.evidence_hash))
    .bind(i64::from(protocol_version))
    .bind(i64::from(simulation_version))
    .bind(format_b256(challenge_seed))
    .bind(i64::from(finished_tick))
    .bind(payload_json)
    .bind(verified_payload_json)
    .bind(RUN_STATUS_VALIDATED)
    .bind(created_at_ms as i64)
    .bind(created_at_ms as i64)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn insert_validated_run_for_active_session(
    pool: &SqlitePool,
    session_id: B256,
    player: Address,
    verified: &VerifiedRunRecord,
    protocol_version: u8,
    simulation_version: u16,
    challenge_seed: B256,
    finished_tick: u32,
    payload_json: &str,
    verified_payload_json: &str,
    created_at_ms: u64,
) -> Result<ValidatedRunInsertOutcome> {
    let mut tx = pool.begin().await?;
    let insert_result = query(
        r#"
        INSERT OR IGNORE INTO runs (
            run_id, session_id, player, challenge_id, challenge_version, diamonds_caught, last_diamond_at_ms,
            evidence_hash, protocol_version, simulation_version, challenge_seed,
            finished_tick, payload_json, verified_payload_json, status, tx_hash, last_error,
            created_at_ms, updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        "#,
    )
    .bind(format_b256(verified.run_id))
    .bind(format_b256(session_id))
    .bind(format_address(player))
    .bind(bytes32_level_id(verified.challenge_id))
    .bind(i64::from(verified.challenge_version))
    .bind(i64::from(verified.diamonds_caught))
    .bind(i64::from(verified.last_diamond_at_ms))
    .bind(format_b256(verified.evidence_hash))
    .bind(i64::from(protocol_version))
    .bind(i64::from(simulation_version))
    .bind(format_b256(challenge_seed))
    .bind(i64::from(finished_tick))
    .bind(payload_json)
    .bind(verified_payload_json)
    .bind(RUN_STATUS_VALIDATED)
    .bind(created_at_ms as i64)
    .bind(created_at_ms as i64)
    .execute(&mut *tx)
    .await?;

    if insert_result.rows_affected() == 0 {
        tx.commit().await?;
        return Ok(ValidatedRunInsertOutcome::Duplicate);
    }

    let update_result = query(
        r#"
        UPDATE sessions
        SET accepted_run_count = accepted_run_count + 1, updated_at_ms = ?
        WHERE session_id = ?
            AND player = ?
            AND status = ?
            AND permit_signature IS NOT NULL
            AND accepted_run_count < max_runs
        "#,
    )
    .bind(created_at_ms as i64)
    .bind(format_b256(session_id))
    .bind(format_address(player))
    .bind(SESSION_STATUS_ACTIVE)
    .execute(&mut *tx)
    .await?;

    if update_result.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(ValidatedRunInsertOutcome::Rejected);
    }

    tx.commit().await?;
    Ok(ValidatedRunInsertOutcome::Inserted)
}

pub async fn count_runs_by_status(
    pool: &SqlitePool,
    session_id: B256,
    status: &str,
) -> Result<i64> {
    let row = query("SELECT COUNT(*) AS count FROM runs WHERE session_id = ? AND status = ?")
        .bind(format_b256(session_id))
        .bind(status)
        .fetch_one(pool)
        .await?;
    Ok(row.try_get::<i64, _>("count")?)
}

pub async fn count_run_statuses(pool: &SqlitePool, session_id: B256) -> Result<RunStatusCounts> {
    let rows = query(
        r#"
        SELECT status, COUNT(*) AS count
        FROM runs
        WHERE session_id = ?
        GROUP BY status
        "#,
    )
    .bind(format_b256(session_id))
    .fetch_all(pool)
    .await?;

    let mut counts = RunStatusCounts::default();
    for row in rows {
        let status: String = row.try_get("status")?;
        let count: i64 = row.try_get("count")?;
        match status.as_str() {
            RUN_STATUS_VALIDATED => counts.validated = count,
            RUN_STATUS_SUBMITTED => counts.submitted = count,
            RUN_STATUS_CONFIRMED => counts.confirmed = count,
            RUN_STATUS_FAILED => counts.failed = count,
            _ => {}
        }
    }

    Ok(counts)
}

pub async fn session_tx_hashes(pool: &SqlitePool, session_id: B256) -> Result<Vec<String>> {
    let rows = query("SELECT DISTINCT tx_hash FROM runs WHERE session_id = ? AND tx_hash IS NOT NULL ORDER BY tx_hash ASC")
        .bind(format_b256(session_id))
        .fetch_all(pool)
        .await?;
    rows.into_iter()
        .map(|row| row.try_get::<String, _>("tx_hash").map_err(Into::into))
        .collect()
}

pub async fn load_runs_for_relay(
    pool: &SqlitePool,
    session_id: B256,
    limit: usize,
) -> Result<Vec<StoredRun>> {
    let rows = query(
        r#"
        SELECT r.*, s.permit_signature
        FROM runs r
        JOIN sessions s ON s.session_id = r.session_id
        WHERE r.session_id = ? AND r.status = ?
        ORDER BY r.created_at_ms ASC
        LIMIT ?
        "#,
    )
    .bind(format_b256(session_id))
    .bind(RUN_STATUS_VALIDATED)
    .bind(limit as i64)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(map_stored_run).collect()
}

pub async fn update_run_status_for_session(
    pool: &SqlitePool,
    session_id: B256,
    from_status: &str,
    to_status: &str,
    tx_hash: Option<B256>,
    last_error: Option<&str>,
    updated_at_ms: u64,
) -> Result<()> {
    query(
        r#"
        UPDATE runs
        SET status = ?, tx_hash = ?, last_error = ?, updated_at_ms = ?
        WHERE session_id = ? AND status = ?
        "#,
    )
    .bind(to_status)
    .bind(tx_hash.map(format_b256))
    .bind(last_error)
    .bind(updated_at_ms as i64)
    .bind(format_b256(session_id))
    .bind(from_status)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_run_status_for_tx_hash(
    pool: &SqlitePool,
    tx_hash: B256,
    to_status: &str,
    last_error: Option<&str>,
    updated_at_ms: u64,
) -> Result<()> {
    query("UPDATE runs SET status = ?, last_error = ?, updated_at_ms = ? WHERE tx_hash = ?")
        .bind(to_status)
        .bind(last_error)
        .bind(updated_at_ms as i64)
        .bind(format_b256(tx_hash))
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn load_submitted_transactions(pool: &SqlitePool) -> Result<Vec<B256>> {
    let rows = query("SELECT DISTINCT tx_hash FROM runs WHERE status = ? AND tx_hash IS NOT NULL")
        .bind(RUN_STATUS_SUBMITTED)
        .fetch_all(pool)
        .await?;
    rows.into_iter()
        .map(|row| {
            let value: String = row.try_get("tx_hash")?;
            value
                .parse()
                .map_err(|error| anyhow!("parse tx hash {value}: {error}"))
        })
        .collect()
}
