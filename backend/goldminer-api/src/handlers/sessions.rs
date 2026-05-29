//! sessions.rs 负责 ranked session 的 HTTP 生命周期：
//! - 创建 session permit
//! - 激活 session
//! - 请求 finalize
//! - 查询 session 状态
//!
//! 它只编排 permit/session 这一层，不负责 run evidence 校验；run 上传与 replay 校验
//! 在独立的 handler/core 链路里完成。

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use goldminer_core::{
    build_session_id, build_session_permit_typed_data, deployment_id_hash, session_permit_digest,
    verify_signature, ActiveSessionPermit,
};

use crate::{
    app_state::AppState,
    db,
    models::{
        ActivateSessionRequest, ActivateSessionResponse, CreateSessionRequest,
        CreateSessionResponse, FinalizeSessionResponse, SessionStatusResponse,
    },
    now_ms, ApiError,
};

pub async fn create_session(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateSessionRequest>,
) -> Result<Json<CreateSessionResponse>, ApiError> {
    let created_at_ms = now_ms();
    let now_seconds = created_at_ms / 1_000;
    // session permit 在创建时就固定 player、delegate、nonce、deadline 和 maxRuns。
    // 后续激活、上传、relay 都必须围绕这份 permit 窗口工作。
    let permit = db::create_game_session(
        &state.db,
        request.player,
        &state.config.deployment_id,
        created_at_ms,
        |nonce| ActiveSessionPermit {
            player: request.player,
            delegate: state.relayer_address,
            session_id: build_session_id(
                request.player,
                nonce,
                created_at_ms,
                &state.config.deployment_id,
            ),
            deployment_id_hash: deployment_id_hash(&state.config.deployment_id),
            issued_at: now_seconds,
            deadline: now_seconds + state.config.session_ttl_seconds,
            nonce,
            max_runs: state.config.session_max_runs,
        },
    )
    .await
    .map_err(ApiError::internal)?;
    let typed_data = build_session_permit_typed_data(
        &permit,
        state.config.chain_id,
        state.config.scoreboard_address,
    );

    Ok(Json(CreateSessionResponse {
        session_id: permit.session_id,
        deadline: permit.deadline,
        max_runs: permit.max_runs,
        permit,
        typed_data,
    }))
}

pub async fn activate_session(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ActivateSessionRequest>,
) -> Result<Json<ActivateSessionResponse>, ApiError> {
    let permit = db::load_session_row(
        &state.db,
        request.session_id,
        request.player,
        &state.config.deployment_id,
    )
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::bad_request("session not found"))?;

    // 激活阶段只验证“玩家是否真的签了这份 permit”，不触碰 run 或 replay 内容。
    let digest = session_permit_digest(
        &permit.permit,
        state.config.chain_id,
        state.config.scoreboard_address,
    );
    verify_signature(digest, &request.signature, request.player)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;

    db::activate_game_session(
        &state.db,
        request.session_id,
        request.player,
        &request.signature,
        now_ms(),
    )
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(ActivateSessionResponse { ok: true }))
}

pub async fn finalize_session(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> Result<Json<FinalizeSessionResponse>, ApiError> {
    let session_id = session_id
        .parse()
        .map_err(|error| ApiError::bad_request(format!("parse session id: {error}")))?;
    let session = db::load_session_row_by_id(&state.db, session_id, &state.config.deployment_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("session not found"))?;

    // 没有任何已接受 run 的 session 不允许 finalize；否则会把空会话错误推进到 relay worker。
    if session.accepted_run_count <= 0 {
        return Err(ApiError::bad_request(
            "cannot finalize session before uploading runs",
        ));
    }

    db::queue_session_for_finalize(&state.db, session_id, now_ms())
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(FinalizeSessionResponse {
        ok: true,
        status: "queued".to_string(),
    }))
}

pub async fn session_status(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionStatusResponse>, ApiError> {
    // session status 是 relay/database 视角的状态汇总，不重新解释每个 run 的 replay 真值。
    let session_id = session_id
        .parse()
        .map_err(|error| ApiError::bad_request(format!("parse session id: {error}")))?;
    let session = db::load_session_row_by_id(&state.db, session_id, &state.config.deployment_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("session not found"))?;
    let tx_hashes = db::session_tx_hashes(&state.db, session_id)
        .await
        .map_err(ApiError::internal)?;
    let run_counts = db::count_run_statuses(&state.db, session_id)
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(SessionStatusResponse {
        session_id,
        status: session.status,
        validated_runs: run_counts.validated,
        submitted_runs: run_counts.submitted,
        confirmed_runs: run_counts.confirmed,
        failed_runs: run_counts.failed,
        tx_hashes,
        last_error: session.last_error,
    }))
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, str::FromStr, sync::Arc};

    use alloy::{
        primitives::{Address, B256},
        rpc::types::{Filter, Log},
        signers::local::PrivateKeySigner,
    };
    use async_trait::async_trait;
    use axum::extract::{Path, State};
    use goldminer_core::{
        deployment_id_hash, ActiveSessionPermit, RankedChallengeManifest, RankedManifest,
        VerifiedCampaignRecord, VerifiedRunRecord,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    use super::finalize_session;
    use crate::{
        app_state::AppState,
        chain_client::{ChainClient, ChainReceipt, LevelCatalogEntry, RankedChallengePointer},
        config::AppConfig,
        db::{activate_game_session, init_db, insert_game_session, load_session_row_by_id},
        models::{RelayDispatchOutcome, SESSION_STATUS_ACTIVE},
        ApiError,
    };

    const TEST_PRIVATE_KEY: &str =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    #[derive(Clone)]
    struct TestChainClient;

    #[async_trait]
    impl ChainClient for TestChainClient {
        async fn fetch_level_catalog_entry(
            &self,
            _level_id: &str,
            _level_version: u32,
        ) -> anyhow::Result<LevelCatalogEntry> {
            unreachable!("fetch_level_catalog_entry is not used in finalize handler tests")
        }

        async fn fetch_current_ranked_challenge(
            &self,
        ) -> anyhow::Result<Option<RankedChallengePointer>> {
            Ok(None)
        }

        async fn submit_verified_batch(
            &self,
            _permit: &ActiveSessionPermit,
            _player_permit_sig: &str,
            _runs: &[VerifiedRunRecord],
            _batch_id: B256,
            _verifier_sig: &str,
        ) -> anyhow::Result<RelayDispatchOutcome> {
            unreachable!("submit_verified_batch is not used in finalize handler tests")
        }

        async fn submit_verified_campaign(
            &self,
            _permit: &ActiveSessionPermit,
            _player_permit_sig: &str,
            _campaign: &VerifiedCampaignRecord,
            _verifier_sig: &str,
        ) -> anyhow::Result<RelayDispatchOutcome> {
            unreachable!("submit_verified_campaign is not used in finalize handler tests")
        }

        async fn get_transaction_receipt(
            &self,
            _tx_hash: B256,
        ) -> anyhow::Result<Option<ChainReceipt>> {
            Ok(None)
        }

        async fn get_latest_block_number(&self) -> anyhow::Result<u64> {
            Ok(0)
        }

        async fn get_logs(&self, _filter: Filter) -> anyhow::Result<Vec<Log>> {
            Ok(Vec::new())
        }

        async fn get_block_timestamp(&self, _block_number: u64) -> anyhow::Result<u64> {
            Ok(0)
        }
    }

    async fn create_test_pool() -> anyhow::Result<sqlx::SqlitePool> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        init_db(&pool).await?;
        Ok(pool)
    }

    fn build_test_state(pool: sqlx::SqlitePool) -> Arc<AppState> {
        let relayer_signer =
            PrivateKeySigner::from_str(TEST_PRIVATE_KEY).expect("parse relayer signer");
        let verifier_signer =
            PrivateKeySigner::from_str(TEST_PRIVATE_KEY).expect("parse verifier signer");

        Arc::new(AppState {
            config: AppConfig {
                bind: "127.0.0.1:8788".parse().expect("parse bind"),
                database_url: "sqlite::memory:".to_string(),
                rpc_url: "http://127.0.0.1:8545".to_string(),
                chain_id: 31337,
                deployment_id: "test-deployment".to_string(),
                scoreboard_address: Address::from([0x11; 20]),
                level_catalog_address: Address::from([0x22; 20]),
                session_ttl_seconds: 7200,
                session_max_runs: 10,
                max_batch_runs: 8,
                auto_finalize_idle_seconds: 45,
                indexer_poll_interval_ms: 3000,
                indexer_confirmations: 0,
                ranked_manifest_path: "unused.json".into(),
                adventure_manifest_path: "unused.json".into(),
            },
            db: pool,
            chain_client: Arc::new(TestChainClient),
            relayer_address: relayer_signer.address(),
            verifier_signer,
            ranked_manifest: RankedChallengeManifest {
                version: 1,
                generated_at: "test".to_string(),
                board_id: "diamond_rush_60".to_string(),
                simulation_version: 1,
                logic_fps: 60,
                challenges: Vec::new(),
            },
            ranked_challenges: Vec::new(),
            ranked_challenge_lookup: BTreeMap::new(),
            adventure_manifest: RankedManifest {
                version: 1,
                generated_at: "test".to_string(),
                simulation_version: 1,
                logic_fps: 60,
                levels: Vec::new(),
            },
            adventure_levels: Vec::new(),
            adventure_level_lookup: BTreeMap::new(),
        })
    }

    fn build_test_permit(player: Address, session_id: B256) -> ActiveSessionPermit {
        ActiveSessionPermit {
            player,
            delegate: Address::from([0xaa; 20]),
            session_id,
            deployment_id_hash: deployment_id_hash("test-deployment"),
            issued_at: 1,
            deadline: 9_999_999_999,
            nonce: 1,
            max_runs: 10,
        }
    }

    #[tokio::test]
    async fn reject_finalize_for_active_session_without_uploaded_runs() -> anyhow::Result<()> {
        let pool = create_test_pool().await?;
        let state = build_test_state(pool.clone());
        let player = Address::from([0x03; 20]);
        let session_id = B256::from([0x43; 32]);
        let permit = build_test_permit(player, session_id);
        let now = crate::now_ms();

        insert_game_session(&pool, &permit, &state.config.deployment_id, now).await?;
        activate_game_session(&pool, session_id, player, "0x9999", now).await?;

        let error =
            match finalize_session(State(state.clone()), Path(format!("{session_id:#x}"))).await {
                Ok(_) => panic!("finalize should reject zero-run sessions"),
                Err(error) => error,
            };
        let ApiError { status, message } = error;
        assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
        assert_eq!(message, "cannot finalize session before uploading runs");

        let session = load_session_row_by_id(&pool, session_id, &state.config.deployment_id)
            .await?
            .expect("session should exist");
        assert_eq!(session.status, SESSION_STATUS_ACTIVE);
        assert!(session.finalize_requested_at_ms.is_none());

        Ok(())
    }
}
