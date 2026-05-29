use std::{collections::BTreeMap, str::FromStr, sync::Arc};

use alloy::{
    primitives::{Address, B256},
    rpc::types::{Filter, Log},
    signers::local::PrivateKeySigner,
};
use anyhow::Result;
use async_trait::async_trait;
use goldminer_core::{
    build_session_id, deployment_id_hash, ActiveSessionPermit, RankedChallengeManifest,
    RankedManifest, VerifiedCampaignRecord, VerifiedRunRecord,
};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{query, Row, SqlitePool};

use super::*;
use crate::db::relay_worker::process_relay_worker_tick;
use crate::{
    app_state::AppState,
    chain_client::{ChainClient, ChainReceipt, LevelCatalogEntry, RankedChallengePointer},
    config::AppConfig,
    format_b256,
    models::{RelayDispatchOutcome, RUN_STATUS_CONFIRMED, SESSION_STATUS_ACTIVE, SESSION_STATUS_CONFIRMED},
    now_ms,
};

const TEST_PRIVATE_KEY: &str =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

#[derive(Clone)]
struct TestChainClient {
    tx_hash: B256,
}

#[async_trait]
impl ChainClient for TestChainClient {
    async fn fetch_level_catalog_entry(
        &self,
        _level_id: &str,
        _level_version: u32,
    ) -> Result<LevelCatalogEntry> {
        unreachable!("fetch_level_catalog_entry is not used in relay worker tests")
    }

    async fn fetch_current_ranked_challenge(&self) -> Result<Option<RankedChallengePointer>> {
        Ok(None)
    }

    async fn submit_verified_batch(
        &self,
        _permit: &ActiveSessionPermit,
        _player_permit_sig: &str,
        _runs: &[VerifiedRunRecord],
        _batch_id: B256,
        _verifier_sig: &str,
    ) -> Result<RelayDispatchOutcome> {
        Ok(RelayDispatchOutcome::Confirmed(self.tx_hash))
    }

    async fn submit_verified_campaign(
        &self,
        _permit: &ActiveSessionPermit,
        _player_permit_sig: &str,
        _campaign: &VerifiedCampaignRecord,
        _verifier_sig: &str,
    ) -> Result<RelayDispatchOutcome> {
        Ok(RelayDispatchOutcome::Confirmed(self.tx_hash))
    }

    async fn get_transaction_receipt(&self, _tx_hash: B256) -> Result<Option<ChainReceipt>> {
        Ok(None)
    }

    async fn get_latest_block_number(&self) -> Result<u64> {
        Ok(0)
    }

    async fn get_logs(&self, _filter: Filter) -> Result<Vec<Log>> {
        Ok(Vec::new())
    }

    async fn get_block_timestamp(&self, _block_number: u64) -> Result<u64> {
        Ok(0)
    }
}

async fn create_test_pool() -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    init_db(&pool).await?;
    Ok(pool)
}

fn build_test_config() -> AppConfig {
    AppConfig {
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
    }
}

fn build_test_state(pool: SqlitePool, tx_hash: B256) -> Arc<AppState> {
    let relayer_signer =
        PrivateKeySigner::from_str(TEST_PRIVATE_KEY).expect("parse relayer signer");
    let verifier_signer =
        PrivateKeySigner::from_str(TEST_PRIVATE_KEY).expect("parse verifier signer");
    let config = build_test_config();

    Arc::new(AppState {
        config,
        db: pool,
        chain_client: Arc::new(TestChainClient { tx_hash }),
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
    build_test_permit_with_max_runs(player, session_id, 10)
}

fn build_test_permit_with_max_runs(
    player: Address,
    session_id: B256,
    max_runs: u16,
) -> ActiveSessionPermit {
    ActiveSessionPermit {
        player,
        delegate: Address::from([0xaa; 20]),
        session_id,
        deployment_id_hash: deployment_id_hash("test-deployment"),
        issued_at: 1,
        deadline: 9_999_999_999,
        nonce: 1,
        max_runs,
    }
}

fn build_test_run_record(_session_id: B256) -> VerifiedRunRecord {
    build_test_run_record_with_id(B256::from([0x61; 32]))
}

fn build_test_run_record_with_id(run_id: B256) -> VerifiedRunRecord {
    VerifiedRunRecord {
        run_id,
        challenge_id: B256::from([0x62; 32]),
        challenge_version: 1,
        diamonds_caught: 7,
        last_diamond_at_ms: 31_000,
        evidence_hash: B256::from([0x63; 32]),
    }
}

#[tokio::test]
async fn create_game_session_allocates_nonce_inside_transaction() -> Result<()> {
    let pool = create_test_pool().await?;
    let player = Address::from([0x10; 20]);
    let created_at_ms = now_ms();

    let first = create_game_session(&pool, player, "test-deployment", created_at_ms, |nonce| {
        ActiveSessionPermit {
            player,
            delegate: Address::from([0xaa; 20]),
            session_id: build_session_id(player, nonce, created_at_ms, "test-deployment"),
            deployment_id_hash: deployment_id_hash("test-deployment"),
            issued_at: 1,
            deadline: 9_999_999_999,
            nonce,
            max_runs: 10,
        }
    })
    .await?;
    let second = create_game_session(&pool, player, "test-deployment", created_at_ms + 1, |nonce| {
        ActiveSessionPermit {
            player,
            delegate: Address::from([0xaa; 20]),
            session_id: build_session_id(player, nonce, created_at_ms + 1, "test-deployment"),
            deployment_id_hash: deployment_id_hash("test-deployment"),
            issued_at: 1,
            deadline: 9_999_999_999,
            nonce,
            max_runs: 10,
        }
    })
    .await?;

    assert_eq!(first.nonce, 0);
    assert_eq!(second.nonce, 1);
    assert_ne!(first.session_id, second.session_id);

    Ok(())
}

#[tokio::test]
async fn insert_validated_run_atomically_enforces_max_runs() -> Result<()> {
    let pool = create_test_pool().await?;
    let player = Address::from([0x11; 20]);
    let session_id = B256::from([0x44; 32]);
    let permit = build_test_permit_with_max_runs(player, session_id, 1);
    let now = now_ms();

    insert_game_session(&pool, &permit, "test-deployment", now).await?;
    activate_game_session(&pool, session_id, player, "0xbeef", now).await?;

    let first_run = build_test_run_record_with_id(B256::from([0x64; 32]));
    let first_outcome = insert_validated_run_for_active_session(
        &pool,
        session_id,
        player,
        &first_run,
        2,
        1,
        B256::from([0x71; 32]),
        360,
        "{}",
        "{}",
        now,
    )
    .await?;
    assert_eq!(first_outcome, ValidatedRunInsertOutcome::Inserted);

    let duplicate_outcome = insert_validated_run_for_active_session(
        &pool,
        session_id,
        player,
        &first_run,
        2,
        1,
        B256::from([0x71; 32]),
        360,
        "{}",
        "{}",
        now + 1,
    )
    .await?;
    assert_eq!(duplicate_outcome, ValidatedRunInsertOutcome::Duplicate);

    let second_run = build_test_run_record_with_id(B256::from([0x65; 32]));
    let rejected_outcome = insert_validated_run_for_active_session(
        &pool,
        session_id,
        player,
        &second_run,
        2,
        1,
        B256::from([0x71; 32]),
        361,
        "{}",
        "{}",
        now + 2,
    )
    .await?;
    assert_eq!(rejected_outcome, ValidatedRunInsertOutcome::Rejected);

    let session = load_session_row_by_id(&pool, session_id, "test-deployment")
        .await?
        .expect("session should exist");
    assert_eq!(session.accepted_run_count, 1);

    let counts = count_run_statuses(&pool, session_id).await?;
    assert_eq!(counts.validated, 1);
    assert_eq!(counts.submitted, 0);
    assert_eq!(counts.confirmed, 0);
    assert_eq!(counts.failed, 0);

    let run_count: i64 = query("SELECT COUNT(*) AS count FROM runs WHERE session_id = ?")
        .bind(format_b256(session_id))
        .fetch_one(&pool)
        .await?
        .try_get("count")?;
    assert_eq!(run_count, 1);

    Ok(())
}

#[tokio::test]
async fn keeps_zero_run_active_sessions_active_after_idle_timeout() -> Result<()> {
    let pool = create_test_pool().await?;
    let state = build_test_state(pool.clone(), B256::from([0x91; 32]));
    let player = Address::from([0x01; 20]);
    let session_id = B256::from([0x41; 32]);
    let permit = build_test_permit(player, session_id);
    let stale_ms = now_ms().saturating_sub(
        state
            .config
            .auto_finalize_idle_seconds
            .saturating_mul(1_000)
            + 5_000,
    );

    insert_game_session(&pool, &permit, &state.config.deployment_id, stale_ms).await?;
    activate_game_session(&pool, session_id, player, "0x1234", stale_ms).await?;

    process_relay_worker_tick(state).await?;

    let session = load_session_row_by_id(&pool, session_id, "test-deployment")
        .await?
        .expect("session should exist");
    assert_eq!(session.status, SESSION_STATUS_ACTIVE);
    assert_eq!(session.accepted_run_count, 0);

    Ok(())
}

#[tokio::test]
async fn finalizes_sessions_with_validated_runs_via_relay_worker() -> Result<()> {
    let pool = create_test_pool().await?;
    let tx_hash = B256::from([0x92; 32]);
    let state = build_test_state(pool.clone(), tx_hash);
    let player = Address::from([0x02; 20]);
    let session_id = B256::from([0x42; 32]);
    let permit = build_test_permit(player, session_id);
    let stale_ms = now_ms().saturating_sub(
        state
            .config
            .auto_finalize_idle_seconds
            .saturating_mul(1_000)
            + 5_000,
    );

    insert_game_session(&pool, &permit, &state.config.deployment_id, stale_ms).await?;
    activate_game_session(&pool, session_id, player, "0x5678", stale_ms).await?;
    let verified = build_test_run_record(session_id);
    let inserted = insert_validated_run(
        &pool,
        session_id,
        player,
        &verified,
        2,
        1,
        B256::from([0x71; 32]),
        3660,
        "{}",
        "{}",
        stale_ms,
    )
    .await?;
    assert!(inserted);
    increment_accepted_run_count(&pool, session_id, 1, stale_ms).await?;

    process_relay_worker_tick(state).await?;

    let session = load_session_row_by_id(&pool, session_id, "test-deployment")
        .await?
        .expect("session should exist");
    assert_eq!(session.status, SESSION_STATUS_CONFIRMED);
    assert_eq!(session.accepted_run_count, 1);

    let row = query("SELECT status, tx_hash FROM runs WHERE session_id = ?")
        .bind(format_b256(session_id))
        .fetch_one(&pool)
        .await?;
    let run_status: String = row.try_get("status")?;
    let stored_tx_hash: String = row.try_get("tx_hash")?;
    assert_eq!(run_status, RUN_STATUS_CONFIRMED);
    assert_eq!(stored_tx_hash, format_b256(tx_hash));

    Ok(())
}
