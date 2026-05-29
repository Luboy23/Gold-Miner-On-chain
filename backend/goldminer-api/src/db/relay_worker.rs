//! relay_worker 负责把数据库里“已验证但尚未上链”的 session runs 推送到链上。
//!
//! 这层的职责是事务编排与状态推进：
//! - 读取待确认 receipt
//! - 读取达到 finalize 条件的 session
//! - 调用 chain_client 提交批次
//! - 把 relay 结果写回 run/session 状态
//!
//! 它不负责 replay 校验，也不重新解释 evidence 真值；进入 relay worker 之前，
//! run 已经被视为链下验证通过。

use std::sync::Arc;

use anyhow::Result;
use tokio::time::Duration;
use tracing::error;

use crate::{app_state::AppState, models::{RUN_STATUS_CONFIRMED, RUN_STATUS_FAILED, RUN_STATUS_SUBMITTED, RUN_STATUS_VALIDATED, SESSION_STATUS_CONFIRMED, SESSION_STATUS_FAILED, SESSION_STATUS_SUBMITTED}, now_ms};

use super::session_write_model;

pub fn spawn_relay_worker(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            // relay worker 是常驻后台轮询器。单次 tick 失败只记录日志，不能让后台任务退出，
            // 否则已验证 run 会永远停留在待提交状态。
            if let Err(error) = process_relay_worker_tick(state.clone()).await {
                error!("relay worker tick failed: {error:#}");
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });
}

pub async fn process_relay_worker_tick(state: Arc<AppState>) -> Result<()> {
    // 第一阶段先处理“已提交、待确认”的 tx hash；这一步只根据链上 receipt 推进状态。
    let pending_receipts = session_write_model::load_submitted_transactions(&state.db).await?;
    for tx_hash in pending_receipts {
        if let Some(receipt) = state.chain_client.get_transaction_receipt(tx_hash).await? {
            if receipt.success {
                session_write_model::update_run_status_for_tx_hash(
                    &state.db,
                    tx_hash,
                    RUN_STATUS_CONFIRMED,
                    None,
                    now_ms(),
                )
                .await?;
            } else {
                session_write_model::update_run_status_for_tx_hash(
                    &state.db,
                    tx_hash,
                    RUN_STATUS_FAILED,
                    Some("relay transaction reverted"),
                    now_ms(),
                )
                .await?;
            }
        }
    }

    // 第二阶段再挑出达到自动 finalize 条件的 session，把其 validated runs 组装成批次 relay。
    let ready_sessions = session_write_model::load_sessions_ready_for_finalize(
        &state.db,
        now_ms().saturating_sub(state.config.auto_finalize_idle_seconds * 1_000),
    )
    .await?;
    for session in ready_sessions {
        let runs = session_write_model::load_runs_for_relay(
            &state.db,
            session.permit.session_id,
            state.config.max_batch_runs,
        )
        .await?;
        if runs.is_empty() {
            // accepted_run_count > 0 但当前没有待 relay runs，说明该 session 的链上状态
            // 已经在更早批次里封存完毕；这里只补全 session 最终态，不再重复提交空批次。
            if session.accepted_run_count <= 0 {
                continue;
            }
            session_write_model::set_session_status(
                &state.db,
                session.permit.session_id,
                SESSION_STATUS_CONFIRMED,
                None,
                now_ms(),
            )
            .await?;
            continue;
        }

        let permit_signature = runs[0].permit_signature.clone();
        let verified_runs = runs
            .iter()
            .map(|value| value.verified_run.clone())
            .collect::<Vec<_>>();
        let batch_id = goldminer_core::build_batch_id(
            session.permit.session_id,
            session.permit.nonce,
            verified_runs[0].run_id,
            verified_runs.len(),
        );
        let digest = goldminer_core::verifier_batch_digest(
            &session.permit,
            batch_id,
            &verified_runs,
            state.config.chain_id,
            state.config.scoreboard_address,
        );
        let verifier_signature = goldminer_core::sign_batch_digest(&state.verifier_signer, digest).await?;

        match state
            .chain_client
            .submit_verified_batch(
                &session.permit,
                &permit_signature,
                &verified_runs,
                batch_id,
                &verifier_signature,
            )
            .await?
        {
            crate::models::RelayDispatchOutcome::Confirmed(tx_hash) => {
                // confirmed 表示链上 receipt 已成功落块；此时 run/session 一并进入 confirmed。
                session_write_model::update_run_status_for_session(
                    &state.db,
                    session.permit.session_id,
                    RUN_STATUS_VALIDATED,
                    RUN_STATUS_CONFIRMED,
                    Some(tx_hash),
                    None,
                    now_ms(),
                )
                .await?;
                session_write_model::set_session_status(
                    &state.db,
                    session.permit.session_id,
                    SESSION_STATUS_CONFIRMED,
                    None,
                    now_ms(),
                )
                .await?;
            }
            crate::models::RelayDispatchOutcome::Submitted(tx_hash, message) => {
                // submitted 表示交易已发出但尚未拿到成功 receipt；后续由下一轮 receipt polling 接手。
                session_write_model::update_run_status_for_session(
                    &state.db,
                    session.permit.session_id,
                    RUN_STATUS_VALIDATED,
                    RUN_STATUS_SUBMITTED,
                    Some(tx_hash),
                    Some(&message),
                    now_ms(),
                )
                .await?;
                session_write_model::set_session_status(
                    &state.db,
                    session.permit.session_id,
                    SESSION_STATUS_SUBMITTED,
                    Some(&message),
                    now_ms(),
                )
                .await?;
            }
            crate::models::RelayDispatchOutcome::Reverted(tx_hash) => {
                // reverted 是链上最终失败态，不能再保留在 validated/submitted 等中间态。
                session_write_model::update_run_status_for_session(
                    &state.db,
                    session.permit.session_id,
                    RUN_STATUS_VALIDATED,
                    RUN_STATUS_FAILED,
                    Some(tx_hash),
                    Some("relay transaction reverted"),
                    now_ms(),
                )
                .await?;
                session_write_model::set_session_status(
                    &state.db,
                    session.permit.session_id,
                    SESSION_STATUS_FAILED,
                    Some("relay transaction reverted"),
                    now_ms(),
                )
                .await?;
            }
        }
    }

    Ok(())
}
